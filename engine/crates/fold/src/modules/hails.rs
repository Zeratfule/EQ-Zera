//! The hails you typed, newest last — the quest tracker's spine.
//!
//! A hail opens every NPC dialogue tree in EverQuest, so the sequence of them IS the sequence of
//! quest steps a session attempted. This module takes no position on which quest any of them
//! belongs to: that is a join against the quest catalog, and it is the renderer's, made against
//! names this module keeps EXACTLY as the log spelled them (law 2 — canonicalize at boundaries,
//! display raw; there is no counting boundary here, so nothing is folded).
//!
//! CAPPED AT 200, DROP-OLDEST. A hail is a step you took, not a ledger entry — the only reason to
//! read one is to see what you were just doing, and 200 covers several sessions of questing. The
//! uncapped ledgers in this crate (`loot`, `turnins`) are uncapped because a total is computed over
//! them; nothing is summed here.

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The published shape's version. Bumped when a reader could misread the old rows as new ones.
const SHAPE_VERSION: i64 = 1;

/// How many hails are kept. See the header.
const MAX_HAILS: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HailRow {
    /// The NPC, as the line spelled it.
    npc: String,
    /// The log's clock, in epoch millis.
    ts: i64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct HailsModule {
    recent: Vec<HailRow>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`].
    announce: crate::announce::Announce,
}

impl HailsModule {
    pub fn new() -> Self {
        Self::default()
    }
}

impl EqModule for HailsModule {
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
        "hails"
    }

    fn reset(&mut self) {
        self.recent.clear();
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth: a dead same-name character's quest steps are not yours.
            "epoch" => {
                if !self.recent.is_empty() {
                    self.recent.clear();
                    self.announce.changed(self.seq);
                }
            }
            "hail" => {
                let Some(npc) = ev.str("npc") else { return };
                self.recent.push(HailRow {
                    npc: npc.to_string(),
                    ts: ev.ts(),
                });
                if self.recent.len() > MAX_HAILS {
                    self.recent.remove(0);
                }
                self.announce.changed(self.seq);
            }
            _ => {}
        }
    }

    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({
            "seq": self.seq,
            "state": { "v": SHAPE_VERSION, "recent": self.recent },
        })
    }
}
