//! The second half of the unit tests (split so each file stays under the factoring line).

use super::*;

/// Re-arming the same (alert, row) replaces: a fresh landing on a row already being watched is
/// the same warning moved, never a second one.
#[test]
fn a_re_land_on_a_watched_row_moves_the_warning_rather_than_adding_one() {
    let mut early = EarlyWarnings::default();
    let rows = [debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000))];
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 1_000));
    early.tick(2_000, &rows, &NoWatchers);
    early.arm(arm("a1", 10, Some("a turmoil toad"), &["Dazzle"], 3_000));
    early.tick(4_000, &rows, &NoWatchers);
    assert_eq!(
        early.tick(39_000, &rows, &NoWatchers).len(),
        1,
        "one warning, not two"
    );
}

#[test]
fn a_landings_subject_reads_mob_then_target_and_maps_self_to_the_player() {
    let mez = ev(r#"{"kind":"cc","seq":1,"ts":1,"raw":"m","mob":"A Turmoil Toad"}"#);
    assert_eq!(
        early_warn_subject(&mez, &[]).target_key.as_deref(),
        Some("a turmoil toad"),
        "canonicalized, so two spellings are one entity"
    );
    let mine = ev(r#"{"kind":"buffApply","seq":1,"ts":1,"raw":"b","target":"self"}"#);
    assert!(
        early_warn_subject(&mine, &[]).target_key.is_none(),
        "'self' is the model's word for the player, not a mob called self"
    );
}

/// A warning and its break share an identity, rank-blind on both sides: the row's name comes
/// from the ranked cast line while the break line prints the bare name.
#[test]
fn a_row_and_its_break_line_fold_to_the_same_identity() {
    let row = debuff_row("Mesmerization VII", "a turmoil toad", 1_000, Some(48_000));
    let brk = ev(
        r#"{"kind":"cc","seq":1,"ts":1,"raw":"b","mob":"a turmoil toad","spell":"Mesmerization","refresh":true}"#,
    );
    let from_row = row_break_identity(&row);
    let from_ev = break_event_identity(&brk, &[]);
    assert!(
        from_row.iter().any(|k| from_ev.contains(k)),
        "{from_row:?} vs {from_ev:?}"
    );
}

/// A self row's entity key is the literal 'self' — the word the buff families already spell in
/// their own `target` field, which is what lets the two halves meet.
#[test]
fn a_self_rows_identity_is_the_word_the_wear_off_line_uses() {
    let row = self_row("Clarity", 1_000, Some(60_000));
    let brk =
        ev(r#"{"kind":"buffExpired","seq":1,"ts":1,"raw":"b","spell":"Clarity","target":"self"}"#);
    assert!(row_break_identity(&row)
        .iter()
        .any(|k| break_event_identity(&brk, &[]).contains(k)));
}

/// Which triggers are endings. The `cc` kind carries both halves and has to be read: a bare
/// `{kind:'cc'}` matches the application too and stays a landing-family def.
#[test]
fn a_trigger_is_a_break_only_when_it_can_only_be_one() {
    let accepts_true = |spec: &str| spec.eq_ignore_ascii_case("true");
    let brk = |t: Value| break_trigger_kinds(&t, &accepts_true);
    assert_eq!(
        brk(json!({"type":"event","kind":"uncharm"})),
        [BreakKind::Uncharm]
    );
    assert_eq!(
        brk(json!({"type":"event","kind":"buffFade"})),
        [BreakKind::BuffFade]
    );
    assert!(
        brk(json!({"type":"event","kind":"cc"})).is_empty(),
        "a bare cc is a landing"
    );
    assert_eq!(
        brk(json!({"type":"event","kind":"cc","where":{"refresh":"true"}})),
        [BreakKind::Cc]
    );
    assert_eq!(
        brk(json!({"type":"event","kind":"cc","where":{"spell":"Dazzle"}})),
        [BreakKind::Cc],
        "the application sentence names no spell, so a spell matcher can only be a break"
    );
    // A `raw` condition can describe no hypothetical line, and a mixed composite keeps the
    // landing behaviour rather than half of each.
    assert!(brk(json!({"type":"raw","regex":"anything"})).is_empty());
    assert!(brk(json!({
        "type": "any",
        "conditions": [
            {"type":"event","kind":"uncharm"},
            {"type":"event","kind":"buffApply"}
        ]
    }))
    .is_empty());
    // …and the `wearsOff` template's two halves are both probed, which is why this is a list.
    assert_eq!(
        brk(json!({
            "type": "any",
            "conditions": [
                {"type":"event","kind":"buffExpired"},
                {"type":"event","kind":"buffWearOff"}
            ]
        })),
        [BreakKind::BuffExpired, BreakKind::BuffWearOff]
    );
}

/// The probe is the measured shape per kind, and a kind that cannot describe this row yields
/// nothing — a `cc` break names a mob, so it can say nothing about a buff on you.
#[test]
fn a_probe_is_the_break_event_this_row_would_produce() {
    let row = debuff_row("Dazzle", "a turmoil toad", 1_000, Some(48_000));
    let probes = break_probes(BreakKind::Cc, &row, 9_000);
    assert_eq!(probes.len(), 1);
    assert_eq!(probes[0].spell, "Dazzle");
    assert_eq!(probes[0].ev.kind(), "cc");
    assert_eq!(probes[0].ev.str("mob"), Some("a turmoil toad"));
    assert!(probes[0].ev.bool("refresh"));
    // Not a log-shaped line, on purpose: this firing is a projection off the timer model.
    assert_eq!(
        probes[0].ev.raw(),
        "Dazzle on a turmoil toad is about to end"
    );
    // …and a self row has no `cc` break at all.
    assert!(break_probes(BreakKind::Cc, &self_row("Clarity", 1, Some(2)), 9).is_empty());
    // The self-only kind is the mirror of it.
    let mine = self_row("Clarity", 1_000, Some(60_000));
    assert_eq!(break_probes(BreakKind::BuffWearOff, &mine, 9_000).len(), 1);
    assert!(break_probes(BreakKind::BuffWearOff, &row, 9_000).is_empty());
}

/// A break-family watcher that says yes to everything, so the schedule is what is under test.
struct AlwaysWatching(i64);
impl BreakWatchers for AlwaysWatching {
    fn break_watchers(&self) -> Vec<(String, i64)> {
        vec![("a1".to_owned(), self.0)]
    }
    fn has_break_watchers(&self) -> bool {
        true
    }
    fn probe_break(
        &self,
        alert_id: &str,
        row: &BuffTimerRow,
        _now_ms: i64,
    ) -> Option<(ArmedFire, String)> {
        Some((
            ArmedFire {
                alert_id: alert_id.to_owned(),
                rule: "Slow wore off a mob".to_owned(),
                sound: "classic/ding".to_owned(),
                message: break_probe_text(row, &row.name),
                captures: None,
                // A stand-in for a def's own matcher; the real one puts the probe's spell on
                // the arm (`RuleSet::probe_break`).
                spell: None,
            },
            alert_id.to_owned(),
        ))
    }
}

#[test]
fn a_break_family_def_arms_from_the_row_and_speaks_before_the_break() {
    let mut early = EarlyWarnings::default();
    let rows = [debuff_row(
        "Shiftless Deeds",
        "King Tranix",
        1_000,
        Some(60_000),
    )];
    let watchers = AlwaysWatching(5);

    // The row exists; the deadline is 55 s in. Nothing yet.
    assert!(early.tick(2_000, &rows, &watchers).is_empty());
    assert!(!early.idle(), "the row is watched");

    let due = early.tick(56_000, &rows, &watchers);
    assert_eq!(due.len(), 1);
    assert_eq!(
        due[0].fired.message,
        "Shiftless Deeds on King Tranix is about to end"
    );
    // A spoken watch is kept, not deleted: the break line at the end of this same hold has to
    // be suppressible against it. It also does not speak twice.
    assert!(early.tick(57_000, &rows, &watchers).is_empty());
    assert!(!early.idle());

    // …and the break arriving now is swallowed. One landing, one firing.
    let brk = ev(
        r#"{"kind":"buffFade","seq":1,"ts":61000,"raw":"b","spell":"Shiftless Deeds","target":"King Tranix"}"#,
    );
    assert!(early.break_spoken("a1", &break_event_identity(&brk, &[])));
    // The watch is consumed by the break it pre-empted, so a re-land can warn again.
    assert!(!early.break_spoken("a1", &break_event_identity(&brk, &[])));
}

/// An early break is never silent: the hold ends before the deadline, so no warning was ever
/// spoken and nothing suppresses the at-break firing.
#[test]
fn a_hold_that_breaks_early_suppresses_nothing() {
    let mut early = EarlyWarnings::default();
    let rows = [debuff_row(
        "Shiftless Deeds",
        "King Tranix",
        1_000,
        Some(60_000),
    )];
    early.tick(2_000, &rows, &AlwaysWatching(5));
    let brk = ev(
        r#"{"kind":"buffFade","seq":1,"ts":20000,"raw":"b","spell":"Shiftless Deeds","target":"King Tranix"}"#,
    );
    assert!(
        !early.break_spoken("a1", &break_event_identity(&brk, &[])),
        "nothing spoke, so nothing is spent"
    );
}

/// A deadline already in the past never arms on the break path, unlike the landing path,
/// because the arming here is the row's mere existence — and rows are rebuilt from history on
/// every fold, so an overdue row would announce a hold that ended months ago.
#[test]
fn a_row_already_past_its_deadline_arms_no_break_warning() {
    let mut early = EarlyWarnings::default();
    let rows = [debuff_row(
        "Shiftless Deeds",
        "King Tranix",
        1_000,
        Some(60_000),
    )];
    assert!(early.tick(90_000, &rows, &AlwaysWatching(5)).is_empty());
    assert!(early.idle(), "nothing was armed at all");
}

/// A watch retires with its row, or with the def that wanted it.
#[test]
fn a_watch_dies_with_its_row_and_with_its_def() {
    let mut early = EarlyWarnings::default();
    let rows = [debuff_row(
        "Shiftless Deeds",
        "King Tranix",
        1_000,
        Some(60_000),
    )];
    early.tick(2_000, &rows, &AlwaysWatching(5));
    assert!(!early.idle());
    early.tick(3_000, &[], &AlwaysWatching(5));
    assert!(early.idle(), "the hold ended, however it ended");

    early.tick(4_000, &rows, &AlwaysWatching(5));
    assert!(!early.idle());
    // The alert was deleted, disabled, or had its offset removed while the watch was pending.
    early.tick(5_000, &rows, &NoWatchers);
    assert!(early.idle());
}
