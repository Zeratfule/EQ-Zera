//! THE FOLD CHECKPOINT (Z Engine, 2026-09-07): the whole fold state at a line boundary, so the next
//! launch continues from there instead of folding the log from byte zero.
//!
//! THE LAW IT RESTS ON is `docs/plans/data-server.md`'s: the fold is a pure function of the log's
//! bytes and its versioned inputs, so a checkpoint at byte offset N restored into a fresh fold and
//! continued over the bytes after N must answer exactly what a fold of all the bytes answers.
//! `tests/checkpoint_parity.rs` holds every fixture to that, at several cut points.
//!
//! ALL OR NOTHING. A checkpoint exists only when EVERY module and the combat engine can serialize
//! their state (`EqModule::checkpoint` answers `Some`). One module that cannot makes `Fold::checkpoint`
//! answer `None`, and the engine cold-folds as it always has - never a partial restore, never a
//! module started from empty beside twenty started from the middle.
//!
//! WHAT IS NOT IN IT. The registry's wiring (which modules, in what order, with what dependencies)
//! is rebuilt by `registered()` from the same inputs, and the checkpoint is applied onto it by
//! module id. Shared corpora (`Arc<dyn Knowledge>`, the spell facts) are inputs, re-installed by
//! the caller, and part of the checkpoint's KEY on the engine side rather than of its body.
//!
//! The body is JSON per module part (self-describing, so a row whose optional fields are omitted
//! when absent reads back exactly), and every state type is a serde derive.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Mutex;

use super::{Fold, Registry};

/// A module part, parsed - `None` for bytes this build does not read.
pub fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Option<T> {
    serde_json::from_slice(bytes).ok()
}

/// A `&'static str` field of a checkpointed type is spelled through this alias, because serde's
/// derive treats a field written literally as `&str` as borrowed from the input (which would
/// demand `'de: 'static`), while a path type is not - and the alias is the same type to every
/// other line of code.
pub type Static = &'static str;

/// `deserialize_with` for a `&'static str` field: the text is interned, leaking each DISTINCT
/// string once for the process's life. The fields this serves hold taxonomy names (`"enemy"`,
/// `"melee"`), so the set is small and the leak is bounded by it, never by the number of records.
pub fn interned<'de, D: serde::Deserializer<'de>>(d: D) -> Result<&'static str, D::Error> {
    let text = String::deserialize(d)?;
    Ok(intern(&text))
}

/// `Option<&'static str>`, spelled through an alias for the same reason as `Static`.
pub type StaticOpt = Option<&'static str>;

/// `deserialize_with` for a `StaticOpt` field.
pub fn interned_opt<'de, D: serde::Deserializer<'de>>(d: D) -> Result<StaticOpt, D::Error> {
    Ok(Option::<String>::deserialize(d)?.map(|s| intern(&s)))
}

/// `deserialize_with` for a `Vec<&'static str>` field (a path-typed alias such as `ClassAbbr`).
pub fn interned_vec<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<&'static str>, D::Error> {
    Ok(Vec::<String>::deserialize(d)?
        .iter()
        .map(|s| intern(s))
        .collect())
}

/// `deserialize_with` for a `HashMap<String, &'static str>` field.
pub fn interned_map<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<std::collections::HashMap<String, &'static str>, D::Error> {
    Ok(std::collections::HashMap::<String, String>::deserialize(d)?
        .into_iter()
        .map(|(k, v)| (k, intern(&v)))
        .collect())
}

pub fn intern(text: &str) -> &'static str {
    static POOL: Mutex<Option<HashSet<&'static str>>> = Mutex::new(None);
    let mut guard = POOL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let pool = guard.get_or_insert_with(HashSet::new);
    if let Some(s) = pool.get(text) {
        return s;
    }
    let leaked: &'static str = Box::leak(text.to_owned().into_boxed_str());
    pool.insert(leaked);
    leaked
}

/// The format. Bumped whenever a state type's shape changes in a way `serde` would misread rather
/// than refuse; a mismatch is a cold fold, never a repair.
pub const FORMAT: u32 = 1;

/// One module's part, by id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModulePart {
    pub id: String,
    pub bytes: Vec<u8>,
}

/// Everything a fold is, at a boundary between two primary events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoldCheckpoint {
    pub format: u32,
    pub modules: Vec<ModulePart>,
    /// The combat engine's state; absent when the fold ran without one.
    pub combat: Option<Vec<u8>>,
    pub epoch_fired: bool,
    pub session: (i64, i64),
    pub events: u64,
    pub last_ts: i64,
}

impl Registry {
    /// Every module's state, in registration order - or `None` when any module cannot yet.
    pub fn checkpoint(&self) -> Option<Vec<ModulePart>> {
        let mut out = Vec::with_capacity(self.mods.len());
        for m in &self.mods {
            out.push(ModulePart {
                id: m.id().to_owned(),
                bytes: m.checkpoint()?,
            });
        }
        Some(out)
    }

    /// The module ids that cannot checkpoint yet - the program's own to-do list, and empty when
    /// the checkpoint is complete.
    pub fn not_checkpointable(&self) -> Vec<&'static str> {
        self.mods
            .iter()
            .filter(|m| m.checkpoint().is_none())
            .map(|m| m.id())
            .collect()
    }

    /// Apply every part onto the registered module of the same id. The error names what refused:
    /// a part that names no module, a module missing its part, or a module refusing its bytes -
    /// and the registry is then in an undefined mix, so the caller must discard it.
    pub fn restore(&mut self, parts: &[ModulePart]) -> Result<(), String> {
        if parts.len() != self.mods.len() {
            return Err(format!(
                "{} parts for {} modules",
                parts.len(),
                self.mods.len()
            ));
        }
        for (m, part) in self.mods.iter_mut().zip(parts) {
            if m.id() != part.id {
                return Err(format!(
                    "part '{}' where module '{}' is registered",
                    part.id,
                    m.id()
                ));
            }
            if !m.restore(&part.bytes) {
                return Err(format!("module '{}' refused its part", part.id));
            }
        }
        Ok(())
    }
}

impl Fold {
    /// The fold at this boundary, or `None` when it cannot be taken: a module that does not
    /// checkpoint, a derived event still queued (a tick can leave one; the next primary drains it),
    /// or a combat engine that cannot serialize.
    pub fn checkpoint(&self) -> Option<FoldCheckpoint> {
        if !self.derived.is_empty() {
            return None;
        }
        let modules = self.registry.checkpoint()?;
        let combat = match (&self.combat, &self.lane) {
            (Some(c), _) => Some(c.checkpoint()?),
            (None, Some(l)) => Some(l.with(|engine, _| engine.checkpoint())?),
            (None, None) => None,
        };
        Some(FoldCheckpoint {
            format: FORMAT,
            modules,
            combat,
            epoch_fired: self.epoch.fired(),
            session: self.sessions.state(),
            events: self.events,
            last_ts: self.last_ts,
        })
    }

    /// Put a checkpoint onto a FRESH fold (built by `Fold::new` on the same inputs, with the same
    /// combat arrangement). An error leaves the fold in an undefined mix: discard it.
    pub fn restore(&mut self, ck: &FoldCheckpoint) -> Result<(), String> {
        if ck.format != FORMAT {
            return Err(format!(
                "format {} where this build reads {FORMAT}",
                ck.format
            ));
        }
        self.registry.restore(&ck.modules)?;
        let combat_ok = match (&mut self.combat, &self.lane, &ck.combat) {
            (Some(c), _, Some(bytes)) => c.restore(bytes),
            (None, Some(l), Some(bytes)) => l.restore(bytes, roster_part(&ck.modules)),
            (None, None, None) => true,
            _ => false,
        };
        if !combat_ok {
            return Err("the combat engine refused its part".to_owned());
        }
        self.epoch.set_fired(ck.epoch_fired);
        self.sessions.set_state(ck.session);
        self.derived.clear();
        self.events = ck.events;
        self.last_ts = ck.last_ts;
        Ok(())
    }
}

impl Fold {
    /// [`Fold::fold_bytes`] continuing a RESTORED fold: the first event is numbered where the
    /// checkpoint left off (`events()`), as a whole scan would have numbered it.
    pub fn fold_bytes_from(&mut self, parser: &eqlog::Parser, bytes: &[u8]) {
        let first_seq = i64::try_from(self.events).unwrap_or(i64::MAX);
        eqlog::scan::scan_bytes_from(parser, bytes, first_seq, |_json, payload| {
            self.on_primary(&super::Event::typed(payload), false);
        });
    }
}

/// The roster module's part, which the combat lane's private roster restores from.
fn roster_part(parts: &[ModulePart]) -> Option<&[u8]> {
    parts
        .iter()
        .find(|p| p.id == "roster")
        .map(|p| p.bytes.as_slice())
}
