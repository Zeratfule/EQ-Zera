//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// The `buffApply` candidate shape.
pub(super) fn candidates_of(ev: &Event) -> Vec<Candidate> {
    ev.candidates(Key::Candidates)
        .into_iter()
        .map(|(name, duration_ms, illusion)| Candidate {
            name,
            duration_ms,
            illusion,
        })
        .collect()
}

/// The `buffWearOff` candidate shape — plain names.
pub(super) fn wear_off_candidates(ev: &Event) -> Vec<String> {
    ev.arr_str(Key::Candidates)
        .into_iter()
        .map(str::to_string)
        .collect()
}
