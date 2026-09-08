//! THE DEATH RECAP: the last seconds of incoming damage, by attacker, at the moment you died.
//!
//! ── WHY THIS IS A MODULE AND NOT A COMBAT-ENGINE QUERY ────────────────────────────────────────
//!
//! The combat engine's timeline ring already holds every instant of a fight, and it would be the
//! obvious place to ask "what killed me". It is the wrong place, twice over. Its incoming rows
//! carry `target: None` — the engine files a hit by SOURCE, so an incoming swing is attributed to
//! the mob's lane and the fact that YOU were the one hit is not a field on the row. And law 8's
//! tripwire says every damage total must stay byte-identical across a change; reaching into the
//! engine to add a dimension is exactly the kind of edit that moves one.
//!
//! So the recap is folded HERE, off the same events the engine sees, in a module that adds no
//! number to any total. Nothing in `fold/src/combat/**` is touched.
//!
//! ── WHAT IT KEEPS, AND FOR HOW LONG ───────────────────────────────────────────────────────────
//!
//! A ring of incoming instants — damage aimed at `You`, and spells you resisted — trimmed on every
//! event to the last [`RING_MS`] by LOG timestamp and to [`RING_MAX`] entries. No wall clock is
//! read (the fold-determinism law): the ring ages off the stream's own instants, so a replay of the
//! same bytes builds the same recaps.
//!
//! On a `playerDeath` the last [`WINDOW_MS`] of that ring becomes a recap row. Every recap is
//! folded, historical ones included — a fold has no way to tell a death it is replaying from one
//! that just happened, and a renderer gating a celebration on a LIVE transition already knows the
//! difference. Guessing here would be the fold reading a clock.
//!
//! `taken` IS THE WINDOW'S SUM AND NOTHING ELSE. It is not "the damage that killed you" — the log
//! does not print your hit points, so the fraction of that window you were actually alive for is
//! unknowable (law 6). The window length is published beside it so a reader can say what it means.

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// The published shape's version.
const SHAPE_VERSION: i64 = 1;

/// How far back the ring keeps instants, in log milliseconds.
const RING_MS: i64 = 60_000;

/// The ring's hard ceiling, whichever comes first. A dense fight is ~5 instants a second, so 500
/// covers the whole window with room to spare and bounds the memory regardless of density.
const RING_MAX: usize = 500;

/// How much of the ring a recap quotes: the last fifteen seconds before the death line.
const WINDOW_MS: i64 = 15_000;

/// How many recaps are published, newest last.
const MAX_RECAPS: usize = 50;

/// One incoming hit, as the ring keeps it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingHit {
    ts: i64,
    /// The attacker's display name, as the line spelled it. A caster-less DoT tick has none.
    attacker: String,
    skill: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dtype: Option<String>,
    amount: i64,
    crit: bool,
}

/// One spell you resisted. It carries no amount, by law 8 — a resist is damage-free.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingResist {
    ts: i64,
    caster: String,
    spell: String,
}

/// One attacker's or one skill's share of a window.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Share {
    /// The attacker name or the skill name — whichever list this row is in.
    name: String,
    amount: i64,
    hits: i64,
}

/// What the last seconds looked like.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recap {
    ts: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    killer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    zone: Option<String>,
    /// How far back `taken`, `hits` and `resisted` reach. Published so the number can be read.
    window_ms: i64,
    /// Σ of the window's amounts. NOT "what killed you" — see the header.
    taken: i64,
    /// The window, ascending.
    hits: Vec<IncomingHit>,
    /// Largest share first.
    by_attacker: Vec<Share>,
    /// Largest share first.
    by_skill: Vec<Share>,
    resisted: Vec<IncomingResist>,
}

/// Group the window's hits by one of their names, largest total first.
///
/// Ties break on the name so the order is a function of the bytes and not of a hash seed — the same
/// log must publish the same list every time it is folded.
fn shares(hits: &[IncomingHit], of: impl Fn(&IncomingHit) -> &str) -> Vec<Share> {
    let mut totals: HashMap<&str, (i64, i64)> = HashMap::new();
    for h in hits {
        let e = totals.entry(of(h)).or_insert((0, 0));
        e.0 += h.amount;
        e.1 += 1;
    }
    let mut out: Vec<Share> = totals
        .into_iter()
        .map(|(name, (amount, hits))| Share {
            name: name.to_string(),
            amount,
            hits,
        })
        .collect();
    out.sort_by(|a, b| b.amount.cmp(&a.amount).then_with(|| a.name.cmp(&b.name)));
    out
}

#[derive(Default, Serialize, Deserialize)]
pub struct DeathsModule {
    recaps: Vec<Recap>,
    /// The incoming ring. Not published — a recap is.
    hits: Vec<IncomingHit>,
    resists: Vec<IncomingResist>,
    /// The label the next recap will carry.
    zone: Option<String>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`]. It moves on a DEATH, never on the incoming
    /// hits the ring absorbs: the ring is not published state.
    announce: crate::announce::Announce,
}

impl DeathsModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// Age the ring off the stream's own clock, then off its ceiling. Called on every instant the
    /// ring absorbs, so an idle stretch cannot leave a stale hit in a later recap.
    fn trim(&mut self, now: i64) {
        let floor = now - RING_MS;
        self.hits.retain(|h| h.ts >= floor);
        self.resists.retain(|r| r.ts >= floor);
        if self.hits.len() > RING_MAX {
            self.hits.drain(..self.hits.len() - RING_MAX);
        }
        if self.resists.len() > RING_MAX {
            self.resists.drain(..self.resists.len() - RING_MAX);
        }
    }

    /// An incoming swing, tick or nuke — anything the log aimed at `You` with a number on it.
    fn take_hit(&mut self, ev: &Event) {
        if ev.str("target") != Some("You") {
            return;
        }
        let Some(amount) = ev.int("amount") else {
            return;
        };
        let ts = ev.ts();
        self.hits.push(IncomingHit {
            ts,
            // A caster-less DoT writes `attacker: null`; the tick still happened, and the honest
            // name for who did it is the empty one rather than a mob picked from context.
            attacker: ev.str("attacker").unwrap_or_default().to_string(),
            skill: ev.str("skill").unwrap_or_default().to_string(),
            dtype: ev.str("dtype").map(str::to_string),
            amount,
            crit: ev.bool("crit"),
        });
        self.trim(ts);
    }

    /// A spell you resisted. `incoming` is the parser's own flag for the `You resist <mob>'s …`
    /// shape, so no name comparison is needed here.
    fn take_resist(&mut self, ev: &Event) {
        if !ev.bool("incoming") {
            return;
        }
        let ts = ev.ts();
        self.resists.push(IncomingResist {
            ts,
            caster: ev.str("caster").unwrap_or_default().to_string(),
            spell: ev.str("spell").unwrap_or_default().to_string(),
        });
        self.trim(ts);
    }

    /// The death line: quote the window and publish it.
    fn recap(&mut self, ev: &Event) {
        let ts = ev.ts();
        let floor = ts - WINDOW_MS;
        let hits: Vec<IncomingHit> = self
            .hits
            .iter()
            .filter(|h| h.ts >= floor && h.ts <= ts)
            .cloned()
            .collect();
        let resisted: Vec<IncomingResist> = self
            .resists
            .iter()
            .filter(|r| r.ts >= floor && r.ts <= ts)
            .cloned()
            .collect();
        self.recaps.push(Recap {
            ts,
            killer: ev.str("killer").map(str::to_string),
            zone: self.zone.clone(),
            window_ms: WINDOW_MS,
            taken: hits.iter().map(|h| h.amount).sum(),
            by_attacker: shares(&hits, |h| h.attacker.as_str()),
            by_skill: shares(&hits, |h| h.skill.as_str()),
            hits,
            resisted,
        });
        if self.recaps.len() > MAX_RECAPS {
            self.recaps.remove(0);
        }
        self.announce.changed(self.seq);
    }
}

impl EqModule for DeathsModule {
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
        "deaths"
    }

    fn reset(&mut self) {
        self.recaps.clear();
        self.hits.clear();
        self.resists.clear();
        self.zone = None;
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth. The ring goes too: a dead same-name character's last seconds are
            // not the evidence for anything this character does next.
            "epoch" => {
                self.hits.clear();
                self.resists.clear();
                if !self.recaps.is_empty() {
                    self.recaps.clear();
                    self.announce.changed(self.seq);
                }
            }
            "zone" => self.zone = ev.str("zone").map(str::to_string),
            "damage" => self.take_hit(ev),
            "resist" => self.take_resist(ev),
            "playerDeath" => self.recap(ev),
            _ => {}
        }
    }

    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({
            "seq": self.seq,
            "state": { "v": SHAPE_VERSION, "recaps": self.recaps },
        })
    }
}
