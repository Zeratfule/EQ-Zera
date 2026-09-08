//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

impl Default for ResistModule {
    fn default() -> Self {
        Self::new()
    }
}

impl ResistModule {
    pub fn new() -> Self {
        ResistModule {
            ledger: ResistLedgerStore::new(),
            fold: ResistFold::new(),
            seq: 0,
            // The constructed default. `begin_source` names the character whose log is about to be
            // folded; the bench never calls it, so this is the key the goldens were recorded under.
            source_key: "log".to_string(),
        }
    }

    /// Name the character whose log is about to be folded. Discards that character's bucket first,
    /// so re-reading the same log every launch replaces its contribution instead of doubling it.
    ///
    /// The parity bench never calls it, so the source key stays the constructed default there.
    pub fn begin_source(&mut self, key: &str) {
        self.source_key = key.to_string();
        self.ledger.begin_source(key);
        self.fold.begin_source();
    }

    /// Seed the persisted buckets.
    ///
    /// It must run before [`ResistModule::begin_source`], never after: seeding puts every persisted
    /// bucket back and the fold's own source is discarded afterwards by the one call that names it.
    /// Reversed, this run's character would be seeded with counts its own log is about to re-state.
    ///
    /// Nothing in this crate calls it — the one caller is `zengine::foldsink`, which is handed the
    /// sources at attach. That is what keeps the parity oracle's world file-free by construction.
    pub fn seed(&mut self, sources: &[ledger_file::LedgerSource]) {
        ledger_file::seed_store(&mut self.ledger, sources);
    }

    /// The user's half of the ledger, as it goes on disk. The shipped baseline's bucket and every
    /// empty bucket are dropped.
    #[must_use]
    pub fn user_ledger_file(&self) -> ledger_file::UserLedgerFile {
        ledger_file::ledger_file_of(&self.ledger)
    }

    /// The pull seam for one creature's level, since this module publishes only counts and has no
    /// cursor to mirror.
    ///
    /// It takes both the key and the display name because the two are used for different things: a
    /// `/con` this session is filed under the folded key, and the committed catalog is looked up
    /// under the name the log spelled. The caller folds the key so one spelling rule serves the
    /// whole engine.
    ///
    /// `&self`, through [`MobLevels::level_of_ref`], for the ingest door's no-mutation law.
    #[must_use]
    pub fn level_of(&self, mob_key: &str, display: &str) -> Option<world::MobLevelFact> {
        self.fold.level_of_ref(mob_key, display)
    }
}
