//! The skill ticks, per skill — what the client says each of your skills is now worth.
//!
//! `You have become better at Meditate! (57)` states BOTH that a skill rose and what it rose TO.
//! The value is the client's own number, not a count of ticks: a fold that started mid-log has
//! missed ticks it can never see, so `ups` (what this fold watched) and `value` (what the game last
//! said) are separate facts and neither is derived from the other.
//!
//! `value` IS 0 UNTIL A LINE STATES ONE. The trailing `(n)` is optional in the event's shape, and a
//! skill known only from a value-less tick honestly has no number — 0 is the absence, and `ups`
//! beside it says the skill is real. Nothing here ever invents a value from a neighbouring one.
//!
//! Keys are lowercased (law 2); `display` is the CLIENT's spelling, kept verbatim, because
//! `classes.json`'s skill table is keyed by exactly that string and a pre-translated name would
//! drift from it (`SkillUpEvent`'s own law).

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;

/// The published shape's version.
const SHAPE_VERSION: i64 = 1;

/// How many `[ts, value]` pairs one skill keeps. A curve, not a ledger: nothing is summed over it,
/// and 200 points draw a session's worth of a skill's climb.
const MAX_HISTORY: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillRow {
    /// The client's spelling, verbatim.
    display: String,
    /// The last value a line STATED. 0 means no line has ever stated one — see the header.
    value: i64,
    /// How many ticks THIS FOLD watched. Not the skill's history.
    ups: i64,
    first_ts: i64,
    last_ts: i64,
    /// `[ts, value]` pairs, oldest first, for the climb curve. Only ticks that stated a value.
    history: Vec<(i64, i64)>,
}

#[derive(Default, Serialize, Deserialize)]
pub struct SkillsModule {
    skills: BTreeMap<String, SkillRow>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`].
    announce: crate::announce::Announce,
}

impl SkillsModule {
    pub fn new() -> Self {
        Self::default()
    }

    fn record(&mut self, skill: &str, ts: i64, value: Option<i64>) {
        let key = skill.trim().to_lowercase();
        let row = self.skills.entry(key).or_insert_with(|| SkillRow {
            display: skill.to_string(),
            value: 0,
            ups: 0,
            first_ts: ts,
            last_ts: ts,
            history: Vec::new(),
        });
        row.ups += 1;
        row.last_ts = ts;
        if let Some(v) = value {
            row.value = v;
            row.history.push((ts, v));
            if row.history.len() > MAX_HISTORY {
                row.history.remove(0);
            }
        }
    }
}

impl EqModule for SkillsModule {
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
        "skills"
    }

    fn reset(&mut self) {
        self.skills.clear();
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth: skills belong to a character, and this is a new one.
            "epoch" => {
                if !self.skills.is_empty() {
                    self.skills.clear();
                    self.announce.changed(self.seq);
                }
            }
            "skillUp" => {
                let Some(skill) = ev.str("skill").filter(|s| !s.trim().is_empty()) else {
                    return;
                };
                let skill = skill.to_string();
                self.record(&skill, ev.ts(), ev.int("value"));
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
            "state": { "v": SHAPE_VERSION, "skills": self.skills },
        })
    }
}
