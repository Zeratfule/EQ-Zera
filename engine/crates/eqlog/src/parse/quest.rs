//! The two sentences a quest run is made of: the greeting you type, and the standing it moves.
//!
//! Both were `unknown` before this file existed, and both are STATEMENTS BY THE SERVER ABOUT YOU
//! rather than combat — which is why they live beside each other and not in `world.rs`.
//!
//! THE HAIL IS THE ONLY `You say` LINE THAT IS CLAIMED. A hail opens every NPC dialogue tree in
//! EverQuest, so it is the one piece of your own chat that carries world meaning; the rest of what
//! you type is conversation and stays `unknown`. No generic `say` kind is minted for it — a kind
//! whose only reader would be a chat log is a kind this fold has no use for, and the awaiting-sample
//! law says an unread shape is not evidence of anything.
//!
//! THE SATURATION FORMS CARRY NO MAGNITUDE, AND MUST NEVER BE SUMMED (law 1). `… could not possibly
//! get any worse.` says the standing did not move, because it is already at the floor. Filing it as
//! a delta of 0 would be a lie a chart would draw, and filing it as the "usual" hit would be an
//! invention. So one kind carries two mutually exclusive fields: `delta` when the line stated a
//! number, `cap` when it stated a rail. A reader COUNTS the caps and SUMS the deltas.
//!
//! `Key::Faction` is reused rather than a `factionName` key minted beside it. It is safe because a
//! key is only ever read on the kind that wrote it: `consider` writes a faction RUNG there
//! (`amiably`, `dubiously` — the CON ladder), `factionHit` writes a faction NAME, and no reader can
//! see both, since every consumer dispatches on `kind` first. The JSON word `faction` is the honest
//! name for both halves, and a second key would only make the wire uglier.

use crate::event::{Ev, Key, Kind};
use crate::jsstr::js_trim;
use regex::Regex;

use super::Ctx;

/// The cheap gate for each family: the exact prefix, tested before any regex runs.
const HAIL_PREFIX: &str = "You say, 'Hail";
const FACTION_PREFIX: &str = "Your faction standing with ";

pub struct QuestRes {
    hail: Regex,
    faction_adjust: Regex,
    faction_cap: Regex,
}

impl Default for QuestRes {
    fn default() -> Self {
        Self::new()
    }
}

impl QuestRes {
    pub fn new() -> Self {
        QuestRes {
            // The comma is optional: both `Hail, Beur Tenlah` and `Hail Nicholas` are real
            // spellings, and which one you get is the player's own typing.
            hail: Regex::new(r"^You say, 'Hail,? (.+?)'$").unwrap(),
            faction_adjust: Regex::new(
                r"^Your faction standing with (.+?) has been adjusted by (-?[0-9]+)\.$",
            )
            .unwrap(),
            faction_cap: Regex::new(
                r"^Your faction standing with (.+?) could not possibly get any (better|worse)\.$",
            )
            .unwrap(),
        }
    }
}

/// `You say, 'Hail, <NPC>'` — the greeting that opens a dialogue.
///
/// It must run AFTER every pet-say rule, which claim the six phrases a pet speaks; those are
/// `<Name> says, '…'` and this is `You say, '…'`, so the two cannot collide today. The ordering is
/// kept anyway, because the cascade's rule is that a narrower claim goes first.
pub fn classify_hail(r: &QuestRes, c: &Ctx, out: &mut Ev) -> bool {
    if !c.text.starts_with(HAIL_PREFIX) {
        return false;
    }
    let Some(m) = r.hail.captures(c.text) else {
        return false;
    };
    let npc = js_trim(&m[1]);
    if npc.is_empty() {
        return false;
    }
    out.begin(Kind::Hail);
    out.envelope(c.seq, c.ts, c.raw);
    out.s(Key::Npc, npc);
    true
}

/// The two faction sentences. `delta` and `cap` are mutually exclusive by construction: each arm
/// writes exactly one of them.
pub fn classify_faction_hit(r: &QuestRes, c: &Ctx, out: &mut Ev) -> bool {
    if !c.text.starts_with(FACTION_PREFIX) {
        return false;
    }
    if let Some(m) = r.faction_adjust.captures(c.text) {
        let Ok(delta) = m[2].parse::<i64>() else {
            return false;
        };
        out.begin(Kind::FactionHit);
        out.envelope(c.seq, c.ts, c.raw);
        out.s(Key::Faction, js_trim(&m[1]));
        out.i(Key::Delta, delta);
        return true;
    }
    let Some(m) = r.faction_cap.captures(c.text) else {
        return false;
    };
    // `max` and `min` rather than the log's `better`/`worse`: the line says which rail was hit, and
    // a reader asking "is this maxed" should not have to know English comparatives.
    let cap = if &m[2] == "better" { "max" } else { "min" };
    out.begin(Kind::FactionHit);
    out.envelope(c.seq, c.ts, c.raw);
    out.s(Key::Faction, js_trim(&m[1]));
    out.s(Key::Cap, cap);
    true
}
