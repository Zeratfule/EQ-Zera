//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// How much of `[start, end)` a correction covers. Both edges open ⇒ `i64::MAX` — the TS's
/// `Infinity`, which only ever ends up compared against another overlap.
pub(super) fn overlap_ms(c: &ComboCorrection, start: i64, end: Option<i64>) -> i64 {
    let hi = match (c.end_ts, end) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => i64::MAX,
    };
    hi.saturating_sub(c.start_ts.max(start))
}
