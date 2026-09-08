//! Faction standing, as the log states it — and only as far as the log states it.
//!
//! THE TWO SENTENCES ARE NOT THE SAME KIND OF FACT, and this module never blurs them (law 1).
//! `has been adjusted by -3.` states a MAGNITUDE and is summed into `delta`. `could not possibly
//! get any worse.` states a RAIL and carries no number at all; it is COUNTED (`bottomed` /
//! `maxed`) and enters no sum. A saturation folded in as a zero would be a lie a chart would draw;
//! folded in as "the usual hit" it would be an invention.
//!
//! AND `delta` IS NOT YOUR STANDING. The log never prints an absolute standing, so this is the sum
//! of the moves THIS FOLD WATCHED — nothing more. A reader that calls it a standing is claiming a
//! number the game did not say.
//!
//! Keys are lowercased (law 2), and `display` is the FIRST spelling the log used for that key, so
//! the surface prints what the game printed rather than what this module normalized.

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// The published shape's version.
const SHAPE_VERSION: i64 = 1;

/// How many individual hits are kept for the recent strip.
const MAX_RECENT: usize = 100;

/// One faction's whole history, as far as this fold watched it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FactionTotals {
    /// The first spelling the log used — display, never a key.
    display: String,
    /// Σ of every stated adjustment. NOT your standing; see the header.
    delta: i64,
    /// How many lines stated a magnitude.
    hits: i64,
    /// How many said the standing could not get any BETTER.
    maxed: i64,
    /// How many said it could not get any WORSE.
    bottomed: i64,
    first_ts: i64,
    last_ts: i64,
}

/// One line, kept for the recent strip. `delta` and `cap` are mutually exclusive — the parser
/// guarantees it, and this row preserves the distinction rather than collapsing it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactionHitRow {
    faction: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    delta: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cap: Option<String>,
    ts: i64,
}

#[derive(Default, Serialize, Deserialize)]
pub struct FactionModule {
    factions: BTreeMap<String, FactionTotals>,
    recent: Vec<FactionHitRow>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`].
    announce: crate::announce::Announce,
}

impl FactionModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fold one line into the named faction's totals, minting the entry on first sight.
    fn record(&mut self, name: &str, ts: i64, delta: Option<i64>, cap: Option<&str>) {
        let key = name.trim().to_lowercase();
        let row = self.factions.entry(key).or_insert_with(|| FactionTotals {
            display: name.to_string(),
            delta: 0,
            hits: 0,
            maxed: 0,
            bottomed: 0,
            first_ts: ts,
            last_ts: ts,
        });
        row.last_ts = ts;
        match (delta, cap) {
            (Some(d), _) => {
                row.delta += d;
                row.hits += 1;
            }
            (None, Some("max")) => row.maxed += 1,
            (None, Some("min")) => row.bottomed += 1,
            // A rail this build does not know is counted nowhere rather than guessed into a bucket.
            (None, _) => {}
        }
        self.recent.push(FactionHitRow {
            faction: name.to_string(),
            delta,
            cap: cap.map(str::to_string),
            ts,
        });
        if self.recent.len() > MAX_RECENT {
            self.recent.remove(0);
        }
    }
}

impl EqModule for FactionModule {
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
        "faction"
    }

    fn reset(&mut self) {
        self.factions.clear();
        self.recent.clear();
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth: standing is a fact about a character, and this is a new one.
            "epoch" => {
                if !self.factions.is_empty() || !self.recent.is_empty() {
                    self.factions.clear();
                    self.recent.clear();
                    self.announce.changed(self.seq);
                }
            }
            "factionHit" => {
                let Some(name) = ev.str("faction").filter(|s| !s.trim().is_empty()) else {
                    return;
                };
                let name = name.to_string();
                let delta = ev.int("delta");
                let cap = ev.str("cap").map(str::to_string);
                self.record(&name, ev.ts(), delta, cap.as_deref());
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
            "state": {
                "v": SHAPE_VERSION,
                "factions": self.factions,
                "recent": self.recent,
            },
        })
    }
}
