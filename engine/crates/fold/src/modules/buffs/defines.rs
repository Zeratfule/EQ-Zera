//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

impl crate::Defines for BuffsModule {
    fn family(&self) -> &'static str {
        "buffTrust"
    }

    /// The externals allowlist, replaced whole.
    ///
    /// It lands on the shared core and therefore on both modules at once, so the buff bar and the
    /// crowd-control bar cannot end up with two ideas of whose spell just landed. `buffs` answers
    /// for the family because it owns the core's construction; `buffTimers` clones the same handle
    /// and needs no define of its own.
    fn define(&mut self, payload: &Value) {
        let Some(list) = payload.get("externals").and_then(Value::as_array) else {
            return;
        };
        let names: Vec<String> = list
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect();
        self.core.borrow_mut().anchors.set_trust(names);
    }
}
