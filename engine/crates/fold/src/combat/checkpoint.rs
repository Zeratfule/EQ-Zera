//! THE COMBAT ENGINE'S HALF OF A FOLD CHECKPOINT (Z Engine, 2026-09-07): the whole `EngineState`,
//! serialized, and put back. See `crate::checkpoint` for the law and the proof.
//!
//! ONLY A HYDRATING ENGINE CHECKPOINTS. Once live, the engine is aged by the wall clock (the
//! snapshot-time sweeps, the deferred closure), and a state that is not a function of the log's
//! bytes alone is not a checkpoint - restoring it and folding on would answer something no cold
//! fold answers. So the app takes its checkpoint at the fold's landing, before the first tick.

use super::{CombatEngine, EngineState};

impl CombatEngine {
    /// The engine's whole state, serialized - `None` while live (see the module header).
    pub fn checkpoint(&self) -> Option<Vec<u8>> {
        let st = self.st.borrow();
        if !st.hydrating {
            return None;
        }
        serde_json::to_vec(&*st).ok()
    }

    /// The inverse of `checkpoint`, onto an engine built the same way (reset, named); `false`
    /// refuses bytes this build does not read.
    pub fn restore(&mut self, bytes: &[u8]) -> bool {
        let Some(fresh) = crate::checkpoint::parse::<EngineState>(bytes) else {
            return false;
        };
        *self.st.get_mut() = fresh;
        true
    }
}
