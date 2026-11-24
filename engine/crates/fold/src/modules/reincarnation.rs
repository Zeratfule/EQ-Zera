//! Reincarnation (EQ Legends, Rulers of Kunark, 2026-11-10): a capped three-class loadout and its
//! race go back to level 1, and each of the four gains one rank of its reincarnation AA —
//! `Class Reincarnation: <Class>`, `Race Reincarnation: <Race>` (client dbstr names).
//!
//! ASSUMED SHAPE — no real reincarnation is in any log yet. The grants are expected as ordinary
//! cost-0 AA lines (`You have gained the ability "Class Reincarnation: Warrior" at a cost of 0 ability
//! points.`, then `You have improved Class Reincarnation: Warrior 2 ...`), about four in a few
//! seconds; a burst inside `GROUP_MS` is ONE reincarnation. A rank already held is a re-print.
//!
//! INFERRED (labelled, never counted): a level falling from the cap to <= 2 between two `/who` rows
//! naming the same classes (a 4th+ reincarnation grants no rank), and an unclaimed non-chat line
//! containing "reincarnat" (the game may yet print an explicit message).
//!
//! One derivation, several holders: leveling publishes the events, combo reads their instants, and
//! progression/character read the confirmed instants through `GrantTracker`.

use super::combo::evidence::abbr_by_wiki_name;
use crate::event::Event;
use eqlog::jsstr::js_trim;
use serde::{Deserialize, Serialize};

/// The level cap a loadout must reach before it can reincarnate.
pub const LEVEL_CAP: i64 = 50;
/// Grants this close to the first one of a burst belong to the same reincarnation.
pub const GROUP_MS: i64 = 30_000;
/// The highest level a fresh life can state before its trio is "the same life" for inference.
const FRESH_LEVEL: i64 = 2;

/// Which reincarnation AA a grant names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Component {
    Class,
    Race,
    Completionist,
}

/// One reincarnation AA rank, as the log printed it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub component: Component,
    /// The class or race as printed (`Shadow Knight`, `Dark Elf`); `Completionist` for that AA.
    pub name: String,
    /// The `/who` code, for a class.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub code: Option<String>,
    pub rank: i64,
}

/// `name 3` → (`name`, Some(3)).
fn split_rank(ability: &str) -> (&str, Option<i64>) {
    let trimmed = js_trim(ability);
    match trimmed.rsplit_once(' ') {
        Some((head, tail)) if !tail.is_empty() && tail.bytes().all(|b| b.is_ascii_digit()) => {
            (js_trim(head), tail.parse().ok())
        }
        _ => (trimmed, None),
    }
}

/// An `aaSpend` ability (+ its stated rank) read as a reincarnation grant, or `None`.
pub fn parse_grant(ability: &str, rank: Option<i64>) -> Option<Grant> {
    let (name, printed) = split_rank(ability);
    let rank = rank.or(printed).unwrap_or(1);
    let lower = name.to_lowercase();
    let (component, rest) = if let Some(rest) = strip(&lower, name, "class reincarnation:") {
        (Component::Class, rest)
    } else if let Some(rest) = strip(&lower, name, "race reincarnation:") {
        (Component::Race, rest)
    } else if lower == "reincarnation: completionist" {
        (Component::Completionist, "Completionist")
    } else {
        return None;
    };
    // Tolerant: a class this build cannot code still counts by its printed name.
    let code = match component {
        Component::Class => abbr_by_wiki_name(&rest.to_lowercase()).map(str::to_string),
        _ => None,
    };
    if rest.is_empty() {
        return None;
    }
    Some(Grant {
        component,
        name: rest.to_string(),
        code,
        rank,
    })
}

/// The printed remainder after a case-insensitive prefix.
fn strip<'a>(lower: &str, name: &'a str, prefix: &str) -> Option<&'a str> {
    lower
        .starts_with(prefix)
        .then(|| js_trim(name.get(prefix.len()..).unwrap_or("")))
}

/// What one admitted grant means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Admitted {
    pub ts: i64,
    pub grant: Grant,
    /// This grant starts a new reincarnation (false: it joins the burst in progress).
    pub opens: bool,
}

/// The per-component rank memory and the burst clock. Holds no events.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GrantTracker {
    held: Vec<(Component, String, i64)>,
    burst_ts: Option<i64>,
}

impl GrantTracker {
    /// Read an `aaSpend`. `None` for anything that is not a NEW reincarnation rank.
    pub fn admit(&mut self, ev: &Event) -> Option<Admitted> {
        if ev.kind() != "aaSpend" || ev.int("cost").unwrap_or(0) != 0 {
            return None;
        }
        let grant = parse_grant(ev.str("ability")?, ev.int("rank"))?;
        let key = grant.name.to_lowercase();
        let held = self
            .held
            .iter_mut()
            .find(|(c, n, _)| *c == grant.component && *n == key);
        match held {
            Some((_, _, rank)) if *rank >= grant.rank => return None,
            Some((_, _, rank)) => *rank = grant.rank,
            None => self.held.push((grant.component, key, grant.rank)),
        }
        let ts = ev.ts();
        let joins = self.burst_ts.is_some_and(|b| ts - b <= GROUP_MS);
        let opens = !joins && grant.component != Component::Completionist;
        if opens {
            self.burst_ts = Some(ts);
        }
        Some(Admitted { ts, grant, opens })
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// One reincarnation, confirmed or possible.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReincarnationEvent {
    /// The instant the new life began (the first grant), or the first statement proving it.
    pub ts: i64,
    /// `[lo, hi]` brackets an inferred one; both equal `ts` for a confirmed one.
    pub lo: i64,
    pub hi: i64,
    /// `aa` (the grant lines), `levelDrop` (inferred from levels), `message` (an unclaimed line).
    pub source: String,
    pub inferred: bool,
    /// The ranks granted in this burst, classes and race (and Completionist when it rose).
    pub grants: Vec<Grant>,
    /// For `levelDrop`: the classes both `/who` rows named.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub who_classes: Vec<String>,
    /// For `message`, or a burst that also printed one: the line as printed.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub message: Option<String>,
}

/// A level statement, for inference: a ding (`classes` empty) or your own `/who` row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Stated {
    pub ts: i64,
    pub level: i64,
    pub classes: Vec<String>,
}

/// Everything a module needs to publish the events: grants, unclaimed lines, level statements.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReincarnationLog {
    tracker: GrantTracker,
    events: Vec<ReincarnationEvent>,
    stated: Vec<Stated>,
}

/// An unclaimed line that might be the game announcing a reincarnation. Chat (`, '`) is never it.
fn notice_text(ev: &Event) -> Option<String> {
    if ev.kind() != "unknown" {
        return None;
    }
    let raw = ev.raw();
    // A cheap case-split probe first: this runs on every unclaimed line.
    if !(raw.contains("eincarnat") || raw.contains("EINCARNAT")) {
        return None;
    }
    (!raw.contains(", '")).then(|| raw.to_string())
}

impl ReincarnationLog {
    /// Fold one event. True when the published events may have moved.
    pub fn on_event(&mut self, ev: &Event) -> bool {
        match ev.kind() {
            "epoch" => {
                *self = Self::default();
                true
            }
            "level" => self.state(ev.ts(), ev.int("level").unwrap_or(0), Vec::new()),
            "selfWho" => {
                let classes = sorted_codes(&ev.arr_str("classes"));
                self.state(ev.ts(), ev.int("level").unwrap_or(0), classes)
            }
            "aaSpend" => self.tracker.admit(ev).is_some_and(|a| self.grant(a)),
            _ => notice_text(ev).is_some_and(|text| self.notice(ev.ts(), text)),
        }
    }

    fn state(&mut self, ts: i64, level: i64, classes: Vec<String>) -> bool {
        self.stated.push(Stated { ts, level, classes });
        true
    }

    /// A grant inside the last event's window joins it (and confirms an unclaimed message); any
    /// other class or race grant opens a new one. A lone Completionist rank opens nothing.
    fn grant(&mut self, a: Admitted) -> bool {
        if let Some(e) = self.events.last_mut() {
            if a.ts - e.ts <= GROUP_MS {
                e.source = "aa".to_string();
                e.inferred = false;
                e.grants.push(a.grant);
                return true;
            }
        }
        if a.grant.component == Component::Completionist {
            return false;
        }
        self.events.push(confirmed(a.ts, a.grant));
        true
    }

    fn notice(&mut self, ts: i64, text: String) -> bool {
        if let Some(e) = self.events.last_mut() {
            if ts - e.ts <= GROUP_MS && e.message.is_none() {
                e.message = Some(text);
                return true;
            }
        }
        self.events.push(ReincarnationEvent {
            ts,
            lo: ts,
            hi: ts,
            source: "message".to_string(),
            inferred: true,
            grants: Vec::new(),
            who_classes: Vec::new(),
            message: Some(text),
        });
        true
    }

    /// Instants of the confirmed reincarnations only (the AA bursts).
    pub fn confirmed_ts(&self) -> Vec<i64> {
        self.events
            .iter()
            .filter(|e| !e.inferred)
            .map(|e| e.ts)
            .collect()
    }

    /// Every reincarnation, confirmed and possible, in time order.
    pub fn events(&self) -> Vec<ReincarnationEvent> {
        let known: Vec<i64> = self.events.iter().map(|e| e.ts).collect();
        let mut out = self.events.clone();
        out.extend(inferred_drops(&self.stated, &known));
        out.sort_by_key(|e| e.ts);
        out
    }
}

fn confirmed(ts: i64, grant: Grant) -> ReincarnationEvent {
    ReincarnationEvent {
        ts,
        lo: ts,
        hi: ts,
        source: "aa".to_string(),
        inferred: false,
        grants: vec![grant],
        who_classes: Vec::new(),
        message: None,
    }
}

/// `/who` codes, sorted, so two rows naming one trio in a different order compare equal.
pub fn sorted_codes(classes: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = classes.iter().map(|c| (*c).to_string()).collect();
    out.sort();
    out
}

/// The first `/who` row at or after `from` that is still the same life: no statement between
/// `from` and it is lower than the one before it.
fn who_after<'a>(stated: &[&'a Stated], from: usize) -> Option<&'a Stated> {
    let mut prev = stated[from].level;
    for s in &stated[from..] {
        if s.level < prev {
            return None;
        }
        prev = s.level;
        if !s.classes.is_empty() {
            return Some(s);
        }
    }
    None
}

/// INFERRED reincarnations: consecutive statements falling from the cap to <= 2, with the `/who`
/// rows either side naming the same classes, and no known reincarnation near the drop.
pub fn inferred_drops(stated: &[Stated], known: &[i64]) -> Vec<ReincarnationEvent> {
    let mut sorted: Vec<&Stated> = stated.iter().collect();
    sorted.sort_by_key(|s| s.ts);
    let mut out = Vec::new();
    for i in 1..sorted.len() {
        let (a, b) = (sorted[i - 1], sorted[i]);
        if a.level < LEVEL_CAP || b.level > FRESH_LEVEL {
            continue;
        }
        if known
            .iter()
            .any(|&k| k >= a.ts - GROUP_MS && k <= b.ts + GROUP_MS)
        {
            continue;
        }
        let before = sorted[..i].iter().rev().find(|s| !s.classes.is_empty());
        let (Some(before), Some(after)) = (before, who_after(&sorted, i)) else {
            continue;
        };
        if before.classes != after.classes {
            continue;
        }
        out.push(ReincarnationEvent {
            ts: b.ts,
            lo: a.ts,
            hi: b.ts,
            source: "levelDrop".to_string(),
            inferred: true,
            grants: Vec::new(),
            who_classes: after.classes.clone(),
            message: None,
        });
    }
    out
}

/// The instants the combo model treats as "a new life, not a swap": every event's `ts`.
pub fn rebirth_instants(events: &[ReincarnationEvent]) -> Vec<i64> {
    events.iter().map(|e| e.ts).collect()
}

#[cfg(test)]
mod tests;
