//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

pub fn shared_core(facts: SpellFacts) -> SharedCore {
    Rc::new(RefCell::new(BuffsCore {
        anchors: CastAnchors::new(),
        stats: SpellStats::new(facts),
    }))
}

/// An empty core, for the checkpoint's `skip` on the timers' handle of it.
pub fn empty_core() -> SharedCore {
    shared_core(SpellFacts::default())
}
