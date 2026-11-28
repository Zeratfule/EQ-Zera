//! The culled-landing memories' expiry, lifted out of the parent file unchanged so it stays at its
//! factoring line.

use super::*;

impl BuffTimersModule {
    /// Retire memories past their join window, and mints too old for a wake line to be about.
    pub(super) fn sweep_memories(&mut self, now_ms: i64) {
        let dead: Vec<String> = self
            .culled
            .iter()
            .filter(|(_, m)| now_ms > m.joinable_until)
            .map(|(k, _)| k.to_string())
            .collect();
        for k in dead {
            self.culled.remove(&k);
        }
        if !self.recent_mints.is_empty() {
            self.recent_mints
                .retain(|m| now_ms - m.ts <= WAKE_CENSOR_MS);
        }
    }
}
