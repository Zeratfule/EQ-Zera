//! The second half of the unit tests (split so each file stays under the factoring line).

use super::*;

#[test]
fn a_full_set_replace_forgets_the_previous_set() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
    let mut other = def(json!({"type":"event","kind":"death"}));
    other["id"] = json!("a2");
    rules.set_defs(vec![other]);
    assert_eq!(rules.defs().len(), 1);
    assert!(rules
        .fire_no_offset(&ev(r#"{"kind":"uncharm","seq":1,"ts":1,"raw":"x"}"#))
        .is_empty());
    assert_eq!(
        rules
            .fire_no_offset(&ev(r#"{"kind":"death","seq":2,"ts":2,"raw":"d"}"#))
            .len(),
        1
    );
}

#[test]
fn an_app_trigger_never_fires_here() {
    let mut rules = set(vec![def(json!({"type":"app","signal":"bossDefeat"}))]);
    assert!(rules
        .fire_no_offset(&ev(r#"{"kind":"death","seq":1,"ts":1,"raw":"d"}"#))
        .is_empty());
}

#[test]
fn a_regex_this_engine_cannot_compile_degrades_the_way_the_app_does() {
    // A `where` matcher falls back to LITERAL equality on the spec, slashes and all…
    let mut field = set(vec![def(
        json!({"type":"event","kind":"death","where":{"name":"/(?<=a )rat/"}}),
    )]);
    assert!(field
        .fire_no_offset(&ev(
            r#"{"kind":"death","seq":1,"ts":1,"raw":"d","name":"a rat"}"#
        ))
        .is_empty());
    // …and a `raw` trigger compiles to a pattern nothing can satisfy.
    let mut raw = set(vec![def(json!({"type":"raw","regex":"(?<=a )rat"}))]);
    assert!(raw
        .fire_no_offset(&ev(r#"{"kind":"unknown","seq":1,"ts":1,"raw":"a rat"}"#))
        .is_empty());
}

// Everything above asks whether a line makes a sound. What follows asks what that sound says.

/// A def with a phrase, so `{target}` is wanted. Everything else is `def`'s.
fn speaking_def(trigger: Value, phrase: &str) -> Value {
    let mut d = def(trigger);
    d["speech"] = json!({ "mode": "custom", "phrase": phrase });
    d
}

/// A `raw` condition captures from `ev.raw` — the exact line it just tested, and the only text
/// it ever sees.
#[test]
fn a_declared_group_rides_out_on_the_firing() {
    let mut rules = set(vec![def(json!({
        "type": "raw",
        "regex": r"^\[[^\]]*\] (?<player>[A-Za-z' `]{1,48}) growls with the spirit of the puma\."
    }))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"spellEmote","seq":1,"ts":1000,"raw":"[Sat Aug 01 18:38:10 2026] Fail growls with the spirit of the puma."}"#,
    ));
    assert_eq!(fires.len(), 1);
    let captures = fires[0].captures.as_ref().expect("the group it declared");
    assert_eq!(captures.get("player").map(String::as_str), Some("Fail"));
}

/// An `event` condition's `/regex/` matcher captures from the value of the one field it tested,
/// on the one kind the trigger names — control 3, structurally.
#[test]
fn a_where_matcher_captures_from_the_field_it_tested() {
    let mut rules = set(vec![def(json!({
        "type": "event",
        "kind": "cc",
        "where": { "mob": "/^(?<mob>a \\w+ puma)$/" }
    }))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"cc","seq":1,"ts":1000,"raw":"a young puma is mesmerized.","mob":"a young puma","spell":"Mesmerization III"}"#,
    ));
    let captures = fires[0].captures.as_ref().expect("the field's own group");
    assert_eq!(
        captures.get("mob").map(String::as_str),
        Some("a young puma")
    );
    // …and a literal matcher declares no names, so it captures nothing.
    let mut literal = set(vec![def(
        json!({"type":"event","kind":"cc","where":{"mob":"a young puma"}}),
    )]);
    assert_eq!(
        literal
            .fire_no_offset(&ev(
                r#"{"kind":"cc","seq":2,"ts":2000,"raw":"a young puma is mesmerized.","mob":"a young puma"}"#
            ))[0]
            .captures,
        None
    );
}

/// The one token filled in without a group, and the gate that keeps it off every firing that
/// never asked: the same def with and without `{target}` in its phrase.
#[test]
fn the_target_token_rides_only_when_the_phrase_writes_it() {
    const LINE: &str = r#"{"kind":"cc","seq":1,"ts":1000,"raw":"a young puma is mesmerized.","mob":"a young puma"}"#;
    let mut asked = set(vec![speaking_def(
        json!({"type":"event","kind":"cc"}),
        "Mez broke on {target}",
    )]);
    let captures = asked.fire_no_offset(&ev(LINE))[0]
        .captures
        .clone()
        .expect("the auto token");
    assert_eq!(
        captures.get("target").map(String::as_str),
        Some("a young puma")
    );

    // The same def with no phrase carries nothing — the frame it sent before the field existed.
    let mut silent = set(vec![def(json!({"type":"event","kind":"cc"}))]);
    assert_eq!(silent.fire_no_offset(&ev(LINE))[0].captures, None);
}

/// The sentinels are the parser's vocabulary, not names. "Clarity wore off self" is nobody's
/// sentence.
#[test]
fn a_self_form_speaks_english() {
    let mut rules = set(vec![speaking_def(
        json!({"type":"event","kind":"buffFade"}),
        "{target} lost it",
    )]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"buffFade","seq":1,"ts":1000,"raw":"Your Clarity spell has worn off.","spell":"Clarity"}"#,
    ));
    let captures = fires[0].captures.as_ref().expect("the self form");
    assert_eq!(captures.get("target").map(String::as_str), Some("you"));
}

/// The spell, rank INTACT. Stripping is the speaker's job, and a consumer that wants the rank
/// must still be able to see it.
#[test]
fn the_firing_names_its_spell_with_the_rank_left_on() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"castBegin"}))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"castBegin","seq":1,"ts":1000,"raw":"You begin casting Mesmerization III.","spell":"Mesmerization III"}"#,
    ));
    assert_eq!(fires[0].spell.as_deref(), Some("Mesmerization III"));
}

/// Once a Shiftless Deeds alert is allowed to fire on a line whose `spell` field says "Forlorn
/// Deeds", speaking "Forlorn Deeds" would be a second wrong answer wearing the first one's
/// clothes. The name reported is the candidate that satisfied the def's OWN matcher.
#[test]
fn the_spell_reported_is_the_one_the_alert_matched_on() {
    let mut rules = set(vec![def(json!({
        "type": "event",
        "kind": "buffApply",
        "where": { "spell": "Shiftless Deeds" }
    }))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"buffApply","seq":1,"ts":1000,"raw":"King Tranix slows down.","spell":"Forlorn Deeds","candidates":["Forlorn Deeds","Shiftless Deeds"],"target":"King Tranix"}"#,
    ));
    assert_eq!(fires[0].spell.as_deref(), Some("Shiftless Deeds"));
}

/// A family that names no spell says so, rather than inventing one; the speaker falls back to
/// the alert's own name, which is a true statement about what fired.
#[test]
fn a_family_with_no_spell_names_none() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"Your charm spell has worn off.","mob":"a rat"}"#,
    ));
    assert_eq!(fires[0].spell, None);
}

/// Values are defanged before they reach the frame — control 1 asked of the whole evaluator
/// rather than of the sanitizer alone. The line carries an OSC 52 and a BiDi override; neither
/// survives, and the name does.
#[test]
fn an_attacker_influenced_capture_arrives_defanged() {
    let mut rules = set(vec![def(json!({
        "type": "raw",
        "regex": "^(?<who>.+) tells you"
    }))]);
    // Built with escapes rather than typed: `rustc` refuses a BiDi override inside a string
    // literal (`text_direction_codepoint_in_literal`), which is this defence one layer down.
    let hostile = format!(
        "{esc}]52;c;cGF5bG9hZA=={bel}Ro{bidi}wel tells you hello",
        esc = '\u{1B}',
        bel = '\u{7}',
        bidi = '\u{202E}'
    );
    let fires = rules.fire_no_offset(&Event::from_value(json!({
        "kind": "tell", "seq": 1, "ts": 1000, "raw": hostile
    })));
    let captures = fires[0].captures.as_ref().expect("a capture");
    assert_eq!(captures.get("who").map(String::as_str), Some("Rowel"));
}

/// An ordinary fire warns about nothing, so it carries no deadline. The early-warning half is
/// proven against the module's heartbeat in `alerts.rs`, where there is a clock to measure.
#[test]
fn an_ordinary_fire_carries_no_deadline() {
    let mut rules = set(vec![def(json!({"type":"event","kind":"uncharm"}))]);
    let fires = rules.fire_no_offset(&ev(
        r#"{"kind":"uncharm","seq":1,"ts":1000,"raw":"Your charm spell has worn off.","mob":"a rat"}"#,
    ));
    assert_eq!(fires[0].due_at, None);
}
