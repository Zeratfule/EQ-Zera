//! Spell lockouts: a spell the game will not let land on the same target again for a while.
//!
//! The game prints nothing when a locked target shrugs a spell off, so the clock starts on YOUR
//! landing: every hit of yours inside one cast burst is one lockout. Live tail only — a replayed
//! landing says nothing about now — and any zone line, new session or epoch drops them all.
//!
//! Assumptions the patch text does not settle: a resist is not a landing and starts nothing;
//! another bard's hits are not counted (whether the lock is shared between casters is unknown).

use crate::event::{Event, Key, Kind};
use eqlog::names::spell_canon_key;
use serde::{Deserialize, Serialize};

/// One spell's lockout window, measured from the landing's log stamp.
pub struct LockoutRule {
    /// The base name, without a rank suffix.
    pub spell: &'static str,
    /// Before this the target is certainly still locked.
    pub earliest_ms: i64,
    /// After this the target is certainly free again.
    pub certain_ms: i64,
}

/// One row per spell. Denon's Desperate Dirge: EverQuest Legends patch of 2026-11-10 as quoted by
/// players (no official notes found) — "can now only land on the same target once every 2 ticks
/// (12-17 seconds)"; a blogger says 12 to 18. 18 s covers 17 s plus the log's 1 s stamp resolution.
pub const RULES: &[LockoutRule] = &[LockoutRule {
    spell: "Denon's Desperate Dirge",
    earliest_ms: 12_000,
    certain_ms: 18_000,
}];

/// One cast's landing lines share a stamp, or straddle one second boundary; casts are ~2 s apart.
pub const BURST_MS: i64 = 1_000;
/// A lockout this long past certain is history, and is pruned at the next landing.
const KEEP_MS: i64 = 60_000;
/// The most lockouts held at once.
const MAX_HELD: usize = 8;

/// One target name a landing hit, and how many times (EQ names are duplicated within one pull).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LockoutTarget {
    pub name: String,
    pub count: i64,
}

/// `shared/spellLockouts.ts SpellLockout` — one landing, and the window it locks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellLockout {
    /// The rule's base name.
    pub spell: String,
    /// The name as the landing line spelled it, rank included.
    pub cast_name: String,
    /// LOG stamp of the first landing line of the burst.
    pub started_ts: i64,
    pub earliest_ms: i64,
    pub certain_ms: i64,
    /// Landing lines in the burst.
    pub count: i64,
    /// In first-landed order.
    pub targets: Vec<LockoutTarget>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct Lockouts {
    /// Live-only, so never checkpointed.
    #[serde(skip)]
    held: Vec<SpellLockout>,
    /// The newest stamp folded. A live line older than it is a re-read of a truncated log.
    #[serde(default)]
    newest_ts: i64,
}

impl Lockouts {
    /// Fold one event; `true` when the published rows changed.
    pub fn on_event(&mut self, ev: &Event, live: bool) -> bool {
        let fresh = live && ev.ts() >= self.newest_ts;
        self.newest_ts = self.newest_ts.max(ev.ts());
        match ev.kind_of() {
            Kind::Zone | Kind::SessionStart | Kind::Epoch => self.clear(),
            Kind::Damage if fresh => self.land(ev),
            _ => false,
        }
    }

    pub fn clear(&mut self) -> bool {
        let had = !self.held.is_empty();
        self.held.clear();
        had
    }

    pub fn rows(&self) -> &[SpellLockout] {
        &self.held
    }

    /// What the snapshot publishes: the rule table (the overlay's idle rows) and the live timers.
    pub fn view(&self) -> serde_json::Value {
        let rules: Vec<serde_json::Value> = RULES
            .iter()
            .map(|r| {
                serde_json::json!({
                    "spell": r.spell, "earliestMs": r.earliest_ms, "certainMs": r.certain_ms,
                })
            })
            .collect();
        serde_json::json!({ "rules": rules, "active": self.held })
    }

    fn land(&mut self, ev: &Event) -> bool {
        let Some(rule) = own_landing(ev) else {
            return false;
        };
        let ts = ev.ts();
        let target = ev.str(Key::Target).unwrap_or_default();
        let open = self
            .held
            .iter_mut()
            .rev()
            .find(|h| h.spell == rule.spell)
            .filter(|h| ts - h.started_ts <= BURST_MS);
        if let Some(open) = open {
            add_target(open, target);
            return true;
        }
        self.held
            .retain(|h| ts - h.started_ts - h.certain_ms <= KEEP_MS);
        let mut lockout = SpellLockout {
            spell: rule.spell.to_string(),
            cast_name: ev.str(Key::Skill).unwrap_or_default().to_string(),
            started_ts: ts,
            earliest_ms: rule.earliest_ms,
            certain_ms: rule.certain_ms,
            count: 0,
            targets: Vec::new(),
        };
        add_target(&mut lockout, target);
        self.held.push(lockout);
        if self.held.len() > MAX_HELD {
            self.held.remove(0);
        }
        true
    }
}

/// The rule a damage line is YOUR landing of, if any. Rank-blind.
fn own_landing(ev: &Event) -> Option<&'static LockoutRule> {
    if ev.str(Key::Attacker) != Some("You") || ev.str(Key::Dtype) != Some("spell") {
        return None;
    }
    let key = spell_canon_key(ev.str(Key::Skill)?);
    RULES.iter().find(|r| spell_canon_key(r.spell) == key)
}

fn add_target(lockout: &mut SpellLockout, name: &str) {
    lockout.count += 1;
    match lockout.targets.iter_mut().find(|t| t.name == name) {
        Some(t) => t.count += 1,
        None => lockout.targets.push(LockoutTarget {
            name: name.to_string(),
            count: 1,
        }),
    }
}
