//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::{Fire, RuleSet};
use crate::event::Event;
use serde_json::{json, Value};

fn ev(line: &str) -> Event<'static> {
    Event::from_json(line).expect("a JSON object")
}

fn def(trigger: Value) -> Value {
    json!({
        "id": "a1",
        "name": "Charm break",
        "enabled": true,
        "sound": { "packId": "classic", "soundId": "ding" },
        "trigger": trigger
    })
}

fn set(defs: Vec<Value>) -> RuleSet {
    let mut rules = RuleSet::default();
    rules.set_defs(defs);
    rules
}

/// Fire with a throwaway scheduler, for the matcher tests. No def below carries an offset except
/// the one that is ABOUT the offset, so the arms map is provably empty and discarding it
/// observes nothing. The schedule has its own suite in `alerts_early.rs`.
trait FireNoOffset {
    fn fire_no_offset(&mut self, ev: &Event) -> Vec<Fire>;
}

impl FireNoOffset for RuleSet {
    fn fire_no_offset(&mut self, ev: &Event) -> Vec<Fire> {
        self.fire(
            ev,
            &mut crate::modules::alerts_early::EarlyWarnings::default(),
        )
    }
}

#[test]
fn an_event_trigger_fires_and_the_frame_is_fully_resolved() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"Your charm spell has worn off.","mob":"a rat"}"#,
    ));
    assert_eq!(
        fires,
        vec![Fire {
            at: 1000,
            rule: "Charm break".to_owned(),
            sound: "classic/ding".to_owned(),
            message: "Your charm spell has worn off.".to_owned(),
            // The three speech fields are absent, and that is the claim: this def declares no
            // capture group, writes no `{target}` phrase, matched a family that names no spell,
            // and carries no offset — so its frame is the one it sent before the fields existed.
            captures: None,
            spell: None,
            due_at: None,
        }]
    );
}

#[test]
fn a_disabled_alert_compiles_to_nothing() {
    let mut off = def(json!({"type":"event","kind":"uncharm"}));
    off["enabled"] = json!(false);
    let mut rules = set(vec![off]);
    assert!(rules
        .fire_no_offset(&ev(r#"{"kind":"uncharm","seq":1,"ts":1,"raw":"x"}"#))
        .is_empty());
    // …and the store's list still carries it: `defs` is the store's contract, not the
    // evaluator's.
    assert_eq!(rules.defs().len(), 1);
}

/// The offset MOVES the one fire; it does not add a second — so a matching line makes no sound
/// here and files an arm instead.
#[test]
fn a_def_whose_fire_the_offset_moves_arms_instead_of_sounding() {
    let mut early = def(json!({"type":"event","kind":"buffApply"}));
    early["earlyWarnSec"] = json!(10);
    let mut rules = set(vec![early]);
    let mut sched = crate::modules::alerts_early::EarlyWarnings::default();
    let fires = rules.fire(
        &ev(r#"{"kind":"buffApply","seq":1,"ts":1000,"raw":"x","spell":"Dazzle","target":"a rat"}"#),
        &mut sched,
    );
    assert!(fires.is_empty(), "nothing sounds at the match");
    assert!(!sched.idle(), "…and a warning is waiting for its row");
    // The clock is not spent — a cooldown belongs to a sound, and no sound has been made.
    // Proven by the second landing arming too: a spent clock would have swallowed it.
    rules.fire(
        &ev(r#"{"kind":"buffApply","seq":2,"ts":1100,"raw":"x","spell":"Dazzle","target":"a bat"}"#),
        &mut sched,
    );
    assert!(!sched.idle());
}

/// An offset def still appears in the published set: `defs` is the STORE's contract, not the
/// evaluator's.
#[test]
fn an_offset_def_is_published_like_any_other() {
    use crate::modules::alerts_early::BreakWatchers as _;
    let mut early = def(json!({"type":"event","kind":"uncharm"}));
    early["earlyWarnSec"] = json!(10);
    let rules = set(vec![early]);
    assert_eq!(rules.defs().len(), 1);
    // An `uncharm` trigger IS an ending, so this def watches rows rather than arming from its
    // own match.
    assert_eq!(
        rules.break_watchers(),
        vec![("a1".to_owned(), 10)],
        "a break-family def with an offset watches the timer rows"
    );
}

/// The normalizer is the app's: a zero, a negative, a string and an absent key all mean "no
/// warning", while an out-of-range number is CLAMPED rather than read as absent.
#[test]
fn the_offset_is_normalized_the_way_the_app_normalizes_it() {
    use crate::modules::alerts_early::normalize_early_warn_sec;
    for absent in [json!(0), json!(-5), json!("10"), json!(null)] {
        assert_eq!(normalize_early_warn_sec(Some(&absent)), None, "{absent}");
    }
    assert_eq!(normalize_early_warn_sec(None), None);
    assert_eq!(normalize_early_warn_sec(Some(&json!(10))), Some(10));
    // Round, then the ceiling — never a refusal.
    assert_eq!(normalize_early_warn_sec(Some(&json!(9.6))), Some(10));
    assert_eq!(normalize_early_warn_sec(Some(&json!(5000))), Some(120));
    // …and the floor is a refusal rather than a clamp, because 0 means "no warning".
    assert_eq!(normalize_early_warn_sec(Some(&json!(0.4))), None);
}

#[test]
fn a_where_matcher_narrows_and_an_absent_field_never_matches() {
    let mut rules = set(vec![def(
        json!({"type":"event","kind":"death","where":{"name":"a fire giant"}}),
    )]);
    assert!(
        rules
            .fire_no_offset(&ev(
                r#"{"kind":"death","seq":1,"ts":1,"raw":"d","name":"A Fire Giant"}"#
            ))
            .len()
            == 1
    );
    assert!(rules
        .fire_no_offset(&ev(
            r#"{"kind":"death","seq":2,"ts":9000,"raw":"d","name":"a rat"}"#
        ))
        .is_empty());
    assert!(rules
        .fire_no_offset(&ev(r#"{"kind":"death","seq":3,"ts":18000,"raw":"d"}"#))
        .is_empty());
}

#[test]
fn a_literal_spell_matcher_is_rank_blind_and_a_regex_one_is_not() {
    let mut literal = set(vec![def(
        json!({"type":"event","kind":"castBegin","where":{"spell":"Elemental Maelstrom"}}),
    )]);
    assert_eq!(
        literal
            .fire_no_offset(&ev(
                r#"{"kind":"castBegin","seq":1,"ts":1,"raw":"c","spell":"Elemental Maelstrom III"}"#
            ))
            .len(),
        1
    );
    let mut pattern = set(vec![def(
        json!({"type":"event","kind":"castBegin","where":{"spell":"/^Elemental Maelstrom$/"}}),
    )]);
    assert!(pattern
        .fire_no_offset(&ev(
            r#"{"kind":"castBegin","seq":1,"ts":1,"raw":"c","spell":"Elemental Maelstrom III"}"#
        ))
        .is_empty());
}

#[test]
fn the_rank_fold_reaches_a_damage_skill_only_for_the_two_spell_dtypes() {
    let d = def(json!({"type":"event","kind":"damage","where":{"skill":"Harm Touch"}}));
    let mut rules = set(vec![d]);
    assert_eq!(
        rules
            .fire_no_offset(&ev(
                r#"{"kind":"damage","seq":1,"ts":1,"raw":"d","dtype":"spell","skill":"Harm Touch III"}"#
            ))
            .len(),
        1
    );
    // The gate is on the dtype rather than a measurement, so a `ds` element the game adds
    // tomorrow cannot quietly start folding.
    assert!(rules
        .fire_no_offset(&ev(
            r#"{"kind":"damage","seq":2,"ts":9000,"raw":"d","dtype":"ds","skill":"Harm Touch III"}"#
        ))
        .is_empty());
}

#[test]
fn a_spell_matcher_tests_the_whole_candidate_family() {
    let mut rules = set(vec![def(
        json!({"type":"event","kind":"buffApply","where":{"spell":"Shiftless Deeds"}}),
    )]);
    // The parser's best-effort pick is another member of the family; the truth is in
    // `candidates`, and an alert on any one of them is an alert on the family.
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"buffApply","seq":1,"ts":1,"raw":"a mob slows down.","spell":"Forlorn Deeds","candidates":[{"name":"Forlorn Deeds"},{"name":"Shiftless Deeds"}]}"#,
    ));
    assert_eq!(fires.len(), 1);
}

#[test]
fn a_raw_trigger_reads_the_line_and_a_composite_reads_one_event() {
    let mut raw = set(vec![def(
        json!({"type":"raw","regex":"you have been slain"}),
    )]);
    assert_eq!(
        raw.fire_no_offset(&ev(
            r#"{"kind":"unknown","seq":1,"ts":1,"raw":"You have been slain by a rat!"}"#
        ))
        .len(),
        1
    );
    let mut all = set(vec![def(json!({
        "type": "all",
        "conditions": [
            {"type":"event","kind":"damage","where":{"dtype":"spell"}},
            {"type":"event","kind":"damage","where":{"target":"Primitive"}}
        ]
    }))]);
    assert_eq!(
        all.fire_no_offset(&ev(
            r#"{"kind":"damage","seq":1,"ts":1,"raw":"d","dtype":"spell","target":"Primitive"}"#
        ))
        .len(),
        1
    );
    assert!(all
        .fire_no_offset(&ev(
            r#"{"kind":"damage","seq":2,"ts":9000,"raw":"d","dtype":"melee","target":"Primitive"}"#
        ))
        .is_empty());
}

#[test]
fn the_cooldown_is_per_alert_unless_the_def_asks_for_per_target() {
    let mut plain = set(vec![def(json!({"type":"event","kind":"death"}))]);
    let a = r#"{"kind":"death","seq":1,"ts":1000,"raw":"d","target":"a rat"}"#;
    let b = r#"{"kind":"death","seq":2,"ts":1500,"raw":"d","target":"a fire giant"}"#;
    assert_eq!(plain.fire_no_offset(&ev(a)).len(), 1);
    assert!(
        plain.fire_no_offset(&ev(b)).is_empty(),
        "one clock silences both"
    );

    let mut scoped = def(json!({"type":"event","kind":"death"}));
    scoped["cooldownScope"] = json!("target");
    let mut per_target = set(vec![scoped]);
    assert_eq!(per_target.fire_no_offset(&ev(a)).len(), 1);
    assert_eq!(
        per_target.fire_no_offset(&ev(b)).len(),
        1,
        "the first match on a new mob always fires"
    );
    assert!(
        per_target.fire_no_offset(&ev(a)).is_empty(),
        "and only re-lands on THAT mob are quiet"
    );
}

#[test]
fn a_fire_is_recorded_in_the_alerts_own_ring() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
    rules.fire_no_offset(&ev(
        r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"broke!"}"#,
    ));
    assert_eq!(
        rules.history(),
        json!({ "a1": [{ "ts": 1000, "matchedText": "broke!" }] })
    );
}

mod more;
