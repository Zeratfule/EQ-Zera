//! `src/main/modules/comboLevels.ts` — reading the character's level, for the interval builder.
//!
//! EQ Legends states your level in exactly two places: a `Welcome to level N!` ding and your own
//! `/who` row's bracket. Everything here reconciles them.
//!
//! The fact it all rests on: the displayed level is the MINIMUM over the loadout's class levels.
//! Two consequences pull in opposite directions — inside one loadout the number only ever RISES, so
//! a level that goes backwards proves a swap; across a swap it can fall by forty, which is why
//! `level_drop_boundaries` treats a non-increasing ding as the loudest swap signal in the log.
//!
//! `level_at`'s two loops share one `at`, so the latest statement wins whichever source it came
//! from. Running them in sequence would let an old `/who` row's level beat every ding after it and
//! report a span min-of-loadout makes impossible. A row at the SAME instant as a ding still wins:
//! it states the bracket outright.

use super::ClassAbbr;
use serde::{Deserialize, Serialize};

/// A `/who` row, reduced to what interval construction needs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhoRow {
    pub ts: i64,
    pub seq: i64,
    #[serde(deserialize_with = "crate::checkpoint::interned_vec")]
    pub classes: Vec<ClassAbbr>,
    /// The bracketed level — min over the loadout, so it is the interval's level too.
    pub level: i64,
}

/// A `You have gained a level!` ding.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LevelPoint {
    pub ts: i64,
    pub level: i64,
}

/// Everything that ever STATES a level, which is the whole input to this file.
pub struct LevelStatements<'a> {
    pub levels: &'a [LevelPoint],
    pub who_rows: &'a [WhoRow],
    /// Reincarnation instants (`reincarnation.rs`): each states level 1, and none is a swap.
    pub rebirths: &'a [i64],
}

/// The tertiary slot unlocks at level 10 — a PRIOR, overridden by a `/who` row's own arity.
const TERTIARY_UNLOCK_LEVEL: i64 = 10;

/// The level in force at `ts` — the LATEST statement at or before it, from any source.
pub fn level_at(input: &LevelStatements, ts: i64) -> Option<i64> {
    let mut level: Option<i64> = None;
    let mut at = i64::MIN;
    for &r in input.rebirths {
        if r <= ts && r >= at {
            level = Some(1);
            at = r;
        }
    }
    for p in input.levels {
        if p.ts <= ts && p.ts >= at {
            level = Some(p.level);
            at = p.ts;
        }
    }
    for r in input.who_rows {
        if r.ts <= ts && r.ts >= at {
            level = Some(r.level);
            at = r.ts;
        }
    }
    level
}

/// A ding below the previous one that a reincarnation explains: the new life restarts at 1 with
/// the SAME classes, so it is never a swap. The far edge allows for the grant lines trailing it.
pub fn drop_is_rebirth(prev_ts: i64, ding_ts: i64, rebirths: &[i64]) -> bool {
    let tail = crate::modules::reincarnation::GROUP_MS;
    rebirths
        .iter()
        .any(|&r| r >= prev_ts && r <= ding_ts + tail)
}

/// The slot prior: 2 below the tertiary unlock, 3 after — and 3 at every level once the character
/// has reincarnated, because a reincarnated loadout keeps all three classes from level 1.
pub fn slot_prior(level_lo: Option<i64>, end: Option<i64>, rebirths: &[i64]) -> usize {
    let reborn = rebirths.iter().any(|&r| end.is_none_or(|e| r < e));
    if !reborn && level_lo.is_some_and(|l| l < TERTIARY_UNLOCK_LEVEL) {
        2
    } else {
        3
    }
}

/// Every level stated inside `[from, end)`. `from` is inclusive for the range — a ding that opens
/// an interval is that interval's level — while the regression test asks for the exclusive form,
/// which is why it is a parameter rather than a convention.
fn stated_in(input: &LevelStatements, from: i64, end: Option<i64>, inclusive: bool) -> Vec<i64> {
    let inside = |ts: i64| -> bool {
        (if inclusive { ts >= from } else { ts > from }) && end.is_none_or(|e| ts < e)
    };
    let mut out: Vec<i64> = input
        .levels
        .iter()
        .filter(|p| inside(p.ts))
        .map(|p| p.level)
        .collect();
    out.extend(
        input
            .who_rows
            .iter()
            .filter(|r| inside(r.ts))
            .map(|r| r.level),
    );
    out.extend(input.rebirths.iter().filter(|&&r| inside(r)).map(|_| 1));
    out
}

/// Levels observed inside a slice, for the interval's honest level range.
pub fn level_range(
    input: &LevelStatements,
    start_at: i64,
    end: Option<i64>,
) -> (Option<i64>, Option<i64>) {
    let mut inside = stated_in(input, start_at, end, true);
    if let Some(in_force) = level_at(input, start_at) {
        inside.push(in_force);
    }
    if inside.is_empty() {
        return (None, None);
    }
    (inside.iter().copied().min(), inside.iter().copied().max())
}

/// A level span one loadout cannot produce. Inside a fixed loadout the minimum only ever goes UP,
/// so a level observed inside the interval that is BELOW the level in force when it opened proves a
/// swap in there that no detector cut.
///
/// Stated as a regression rather than as a width, because a width is not evidence of anything:
/// `levels 24-50` is a legitimate month of grinding, and `levels 11-50` is impossible only because
/// the 11 came after the 50. The interval still carries the honest hull; this is what the hull
/// cannot express. A reincarnation inside the span restarts the count, so only the part before the
/// first one is asked.
pub fn level_regressed_inside(input: &LevelStatements, start_at: i64, end: Option<i64>) -> bool {
    let Some(in_force) = level_at(input, start_at) else {
        return false;
    };
    let first_rebirth = input
        .rebirths
        .iter()
        .copied()
        .filter(|&r| r > start_at && end.is_none_or(|e| r < e))
        .min();
    let end = first_rebirth.map_or(end, Some);
    stated_in(input, start_at, end, false)
        .into_iter()
        .any(|level| level < in_force)
}
