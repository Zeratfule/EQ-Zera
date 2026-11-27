//! `src/main/modules/character.ts` — the active CharacterRef, the current zone and the current
//! level, on one transport.
//!
//! The ref is pushed in, not folded: a construction input (`ClusterDeps::character`) derived from
//! the log's filename, so it states a fact about the RUN rather than about the log's contents.
//! `reset()` keeps it; everything log-derived clears.
//!
//! The level is the latest statement with `/who` breaking a tie, and it never enters the ding
//! series — a `/who` row is not a level-up, and the chart, the per-level history and the projection
//! are all anchored on that series.
//!
//! `seq` is this module's own revision, monotonic and never reset: state here moves without a log
//! event (`set_character`), and `useModule` dedupes with `d.seq <= knownSeq`.
//!
//! The `/loc` position is LIVE-ONLY, never older than the newest line already folded (a truncated
//! log re-emits survivors as live), and never checkpointed: a replayed `Your Location is` is where
//! the character stood when it was typed, not where it stands now. It is filed under the zone held
//! at that moment (none held ⇒ nothing filed) and any zone line or new session drops it.

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// `shared/currentLevel.ts LevelStatement`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LevelStatement {
    level: i64,
    /// LOG timestamp of the line that stated it (not a wall clock).
    ts: i64,
    #[serde(deserialize_with = "crate::checkpoint::interned")]
    source: crate::checkpoint::Static,
}

/// `laterStatement` — latest wins, `/who` breaks a tie. Total, so the winner is decided by the rule
/// rather than by arrival order.
fn next_wins(held: &LevelStatement, next: &LevelStatement) -> bool {
    if next.ts > held.ts {
        return true;
    }
    if next.ts < held.ts {
        return false;
    }
    next.source == "who"
}

/// `shared/characterTypes.ts LoggedLoc` — a live `/loc` answer and the zone it was read in.
#[derive(Debug, Clone, Serialize)]
pub struct LoggedLoc {
    ns: f64,
    ew: f64,
    z: f64,
    /// LOG timestamp of the line.
    ts: i64,
    zone: String,
}

#[derive(Default, Serialize, Deserialize)]
pub struct CharacterModule {
    /// The `CharacterRef` as JSON, or `None` for the null the snapshot publishes.
    character: Option<Value>,
    zone: Option<String>,
    /// The newest log stamp folded so far. A live line older than it is a re-read (a truncated or
    /// replaced log re-emits its surviving lines as live), never a /loc typed now.
    #[serde(default)]
    newest_ts: i64,
    /// Skipped by the checkpoint on purpose: a restored position would be a stale one.
    #[serde(skip)]
    loc: Option<LoggedLoc>,
    level: Option<LevelStatement>,
    /// The module's own revision, monotonic for the life of the process. See the header.
    rev: i64,
    /// The ref waiting for the first reset. The double option is the point: the outer is "has
    /// `set_character` been called yet", the inner is the ref it was called with — and the call
    /// itself moves the revision, so a `None` ref and no call at all publish different seqs.
    pending: Option<Option<Value>>,
    /// A reincarnation states level 1 at its first grant line (`reincarnation.rs`), so the level
    /// is not left at the cap until the next ding.
    #[serde(default)]
    rebirths: super::reincarnation::GrantTracker,
}

impl CharacterModule {
    pub fn new(character: Option<Value>) -> Self {
        CharacterModule {
            character: None,
            zone: None,
            newest_ts: 0,
            loc: None,
            level: None,
            rev: 0,
            pending: Some(character),
            rebirths: Default::default(),
        }
    }

    /// `setCharacter` — called by index.ts when the tailed character changes.
    pub fn set_character(&mut self, character: Option<Value>) {
        self.character = character;
        self.rev += 1;
    }

    /// Fold one statement in. A row restating a level you already dinged to still moves the
    /// revision: the age of the statement is part of the fact, and the surfaces hedge on it.
    fn state_level(&mut self, next: LevelStatement) {
        if let Some(held) = &self.level {
            if !next_wins(held, &next) {
                return;
            }
        }
        self.level = Some(next);
        self.rev += 1;
    }

    /// A live `/loc` replaces the last one. Historical lines, re-read lines and a zone not yet
    /// stated file nothing.
    fn state_loc(&mut self, ev: &Event, fresh: bool) {
        let Some(zone) = self.zone.clone().filter(|_| fresh) else {
            return;
        };
        let (Some(ns), Some(ew), Some(z)) = (ev.f64("ns"), ev.f64("ew"), ev.f64("z")) else {
            return;
        };
        self.loc = Some(LoggedLoc {
            ns,
            ew,
            z,
            ts: ev.ts(),
            zone,
        });
        self.rev += 1;
    }

    fn drop_loc(&mut self) {
        if self.loc.take().is_some() {
            self.rev += 1;
        }
    }
}

impl EqModule for CharacterModule {
    fn checkpoint(&self) -> Option<Vec<u8>> {
        serde_json::to_vec(self).ok()
    }

    fn restore(&mut self, bytes: &[u8]) -> bool {
        let Some(fresh) = crate::checkpoint::parse::<Self>(bytes) else {
            return false;
        };
        *self = fresh;
        true
    }

    fn id(&self) -> &'static str {
        "character"
    }

    fn reset(&mut self) {
        // The ref survives; see the header.
        self.zone = None;
        self.newest_ts = 0;
        self.loc = None;
        self.level = None;
        self.rebirths.reset();
        self.rev += 1;
        // The construction ref lands here, once: `rev` IS the published `seq`, so the ORDER of the
        // two bumps is observable, and the composition root spends them as reset-then-setCharacter.
        // A cluster built before `Fold::new` resets it would spend them the other way round.
        if let Some(character) = self.pending.take() {
            self.set_character(character);
        }
    }

    fn on_event(&mut self, ev: &Event, live: bool) {
        let fresh = live && ev.ts() >= self.newest_ts;
        self.newest_ts = self.newest_ts.max(ev.ts());
        match ev.kind() {
            "epoch" => {
                // Character rebirth: the wiped character's level and zone say nothing about this
                // one. The ref is pushed in and stays.
                self.zone = None;
                self.loc = None;
                self.level = None;
                self.rebirths.reset();
                self.rev += 1;
            }
            "aaSpend" => {
                if let Some(a) = self.rebirths.admit(ev).filter(|a| a.opens) {
                    self.state_level(LevelStatement {
                        level: 1,
                        ts: a.ts,
                        source: "reincarnation",
                    });
                }
            }
            "zone" => {
                // Every zone line moves the character, even back into the zone it left.
                self.drop_loc();
                let zone = ev.str("zone").map(str::to_string);
                if zone != self.zone {
                    self.zone = zone;
                    self.rev += 1;
                }
            }
            "sessionStart" => self.drop_loc(),
            "loc" => self.state_loc(ev, fresh),
            "level" => self.state_level(LevelStatement {
                level: ev.int("level").unwrap_or(0),
                ts: ev.ts(),
                source: "ding",
            }),
            "selfWho" => self.state_level(LevelStatement {
                level: ev.int("level").unwrap_or(0),
                ts: ev.ts(),
                source: "who",
            }),
            _ => {}
        }
    }

    /// The same cursor `snapshot` publishes, without building the state to read it.
    fn published_seq(&self) -> Option<i64> {
        Some(self.rev)
    }

    fn snapshot(&self) -> Value {
        // Two different absences: `character` publishes null (the TS field is
        // `CharacterRef | null`) while `zone`/`loc`/`level` are `undefined` and are left out.
        let mut state = serde_json::Map::new();
        state.insert(
            "character".to_string(),
            self.character.clone().unwrap_or(Value::Null),
        );
        if let Some(zone) = &self.zone {
            state.insert("zone".to_string(), json!(zone));
        }
        if let Some(loc) = &self.loc {
            state.insert("loc".to_string(), serde_json::to_value(loc).expect("a"));
        }
        if let Some(level) = &self.level {
            state.insert("level".to_string(), serde_json::to_value(level).expect("a"));
        }
        json!({ "seq": self.rev, "state": Value::Object(state) })
    }
}
