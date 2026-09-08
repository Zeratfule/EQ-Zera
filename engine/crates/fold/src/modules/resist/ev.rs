//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// Is this name the player? The parser's `norm` produces exactly `You` for every spelling the log
/// uses, so the identity compare answers almost every call and `id_key` is the fallback for shapes
/// that reach here unnormalised. Ordered that way because this runs on every melee swing.
pub(super) fn is_self(name: &str) -> bool {
    name == "You" || id_key(name) == "you"
}

pub(super) fn str_array(ev: &Event, key: Key) -> Vec<String> {
    ev.arr_str(key).into_iter().map(str::to_string).collect()
}

/// The candidate spell names the parser handed over. EQ prints one sentence per spell family, so
/// the parser never claims which one it was.
pub(super) fn candidate_names(ev: &Event) -> Vec<String> {
    ev.candidate_names(Key::Candidates)
}
