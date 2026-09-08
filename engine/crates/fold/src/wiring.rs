//! THE WIRING: the cluster's inputs and the one function that registers every module in the order
//! the goldens were recorded under. Lifted out of lib.rs (Z Engine, 2026-09-07) unchanged.

use super::*;

/// The app's persisted knowledge, already parsed — what [`Registry::seed_persisted`] puts back.
///
/// Deliberately not a field of [`ClusterDeps`]: `registered()` is what the parity runner, the bench
/// arm and every test call, so a seed field there would be a door a file could walk through into
/// the world the oracle records. The seed arrives after construction, from the one caller handed a
/// `stateDir` — the same rule `install_knowledge` follows.
///
/// Both halves are default-empty, and an empty seed is not the same act as no seed: the
/// `begin_source` half still runs, because naming this fold's own bucket is right either way.
#[derive(Debug, Default)]
pub struct PersistedState {
    /// `<userData>/resist-ledger.json`'s buckets, the shipped baseline's already refused.
    pub resist: Vec<modules::resist::ledger_file::LedgerSource>,
    /// `<userData>/message-overlay.json`'s buckets, keyed by the source that produced them. The key
    /// travels with the counts because merging two origins under one key would put the fold's own
    /// output back in the pile it is seeded from, and the totals double.
    pub overlay: Vec<(String, Vec<message_overlay::SeedMessage>)>,
}

/// Everything the cluster needs from outside itself — `wiring.ts ModuleWiringDeps`.
///
/// A struct rather than a parameter list so a module with a new construction input adds a field and
/// a registration line instead of re-threading every call site.
///
/// Every field is a fact about the run rather than about the log's bytes, and each is derived by
/// the caller the way the TS harness derives it, because the goldens were recorded that way.
#[derive(Default)]
pub struct ClusterDeps {
    /// `wiring.ts` `knownSpell`, passed as the key set rather than as a closure so nothing in this
    /// crate borrows the parser.
    pub known_spell: HashSet<String>,
    /// `spellClasses.ts`'s canon-key → class-set index, built once off the same DB (evidence.rs).
    pub spell_classes: modules::combo::evidence::SpellClassIndex,
    /// `epochDetector.ts LAUNCH_MS`, resolved through the fold's own zone.
    pub launch_ms: i64,
    /// `WorldOpts.constructionNowMs` — the pinned construction clock the respawn module seeds its
    /// ordering clock from. See `modules/respawn.rs`'s header for why it cannot be a wall clock.
    pub construction_now_ms: i64,
    /// The `CharacterRef` pushed in with `setCharacter`, derived from the log's filename.
    pub character: Option<Value>,
    /// `roster.setSelfName`. The bench does not call it, so the parity runner passes `None` and the
    /// recorded goldens are what that produces.
    pub self_name: Option<String>,
    /// `deps.respawnPrefs` — the shipped default is an empty watch list, which is what every
    /// non-Electron caller passes.
    pub respawn_prefs: modules::respawn::RespawnPrefs,
    /// The whole of `db.byKey`, projected into the scalar facts the buffs model reads
    /// (`spell_facts.rs`). An empty one is the TS's absent `db?`: every read answers nothing, which
    /// is what a caller with no catalog gets.
    pub facts: spell_facts::SpellFacts,
}

/// Every ported module, registered in `WIRING_ORDER`'s relative order.
///
/// Named for what it does rather than for the cluster that brought it, so a reader never has to
/// date it. `Registry::missing()` is what says which modules a given build did not register.
pub fn registered(deps: ClusterDeps) -> Registry {
    let ClusterDeps {
        known_spell,
        spell_classes,
        launch_ms,
        construction_now_ms,
        character,
        self_name,
        respawn_prefs,
        facts,
    } = deps;
    let mut r = Registry::new();
    // combo goes first: within one bus delivery every later module — and the combat engine, which
    // folds the same event afterwards — sees an already-advanced combo state.
    r.register(Box::new(modules::combo::ComboModule::new(
        spell_classes,
        launch_ms,
    )));
    // roster goes second for the same reason: the engine's admission gate pulls the roster through
    // a seam installed before it ever folds a line, so the roster must already be advanced.
    r.register(Box::new(modules::roster::RosterModule::new(
        self_name.as_deref(),
    )));
    r.register(Box::new(modules::loot::LootModule::new()));
    r.register(Box::new(modules::turnins::TurnInsModule::new()));
    r.register(Box::new(modules::class_unlocks::ClassUnlocksModule::new()));
    r.register(Box::new(modules::kills::KillsModule::new()));
    // Beside `kills` because it folds the same death line, and after it, so anything reading both
    // within one delivery sees the kill counted before the clock that kill started.
    r.register(Box::new(modules::respawn::RespawnModule::new(
        construction_now_ms,
        respawn_prefs,
    )));
    r.register(Box::new(modules::progression::ProgressionModule::new()));
    r.register(Box::new(modules::leveling::LevelingModule::new()));
    r.register(Box::new(modules::character::CharacterModule::new(
        character,
    )));
    r.register(Box::new(modules::output_files::OutputFilesModule::new()));
    r.register(Box::new(modules::spell_sets::SpellSetsModule::new()));
    r.register(Box::new(modules::item_tiers::ItemTiersModule::new()));
    r.register(Box::new(
        modules::observed_spell_ranks::ObservedSpellRanksModule::new(known_spell),
    ));
    r.register(Box::new(modules::alerts::AlertsModule::new()));
    // The crowd-control module is built from the buffs module's own anchors and learner, so the two
    // cannot hold two ideas of whose spell just landed or how long it lasts. One `Rc<RefCell<…>>`,
    // cloned into both, is that sharing.
    let core = modules::buffs::shared_core(facts.clone());
    r.register(Box::new(modules::buffs::BuffsModule::new(
        facts,
        core.clone(),
    )));
    r.register(Box::new(modules::buff_timers::BuffTimersModule::new(core)));
    r.register(Box::new(modules::consider::ConsiderModule::new()));
    r.register(Box::new(modules::resist::ResistModule::new()));
    r.register(Box::new(modules::hails::HailsModule::new()));
    r.register(Box::new(modules::faction::FactionModule::new()));
    r.register(Box::new(modules::coin::CoinModule::new()));
    r.register(Box::new(modules::skills::SkillsModule::new()));
    r.register(Box::new(modules::deaths::DeathsModule::new()));
    r.register(Box::new(modules::event_feed::EventFeedModule::new()));
    r
}
