//! The unit tests, in a file of their own so the module stays at its factoring line.

use super::*;

fn pulses(out: &[SongOut]) -> Vec<(i64, bool)> {
    out.iter()
        .filter_map(|o| match o {
            SongOut::Pulse(p) => Some((p.ts, p.witnessed)),
            SongOut::File { .. } => None,
        })
        .collect()
}

#[test]
fn a_twelve_second_gap_interpolates_exactly_one_pulse_and_a_restart_drops_it() {
    let mut p = SongPulses::default();
    let mut out = Vec::new();
    p.witness("largo's melodic binding", 0, Some("a rat"), &mut out);
    p.witness("largo's melodic binding", 12_000, Some("a rat"), &mut out);
    // Closing the first pulse emitted it; the interpolated 6 s pulse waits for the second close.
    p.flush(&mut out);
    assert_eq!(
        pulses(&out),
        vec![(0, true), (6_000, false), (12_000, true)]
    );

    let mut p = SongPulses::default();
    let mut out = Vec::new();
    p.witness("largo's melodic binding", 0, None, &mut out);
    p.note_sing("largo's melodic binding", 7_000, &mut out);
    p.witness("largo's melodic binding", 12_000, None, &mut out);
    p.flush(&mut out);
    // The restart re-anchors: the 6 s interior pulse is before it and is dropped.
    assert_eq!(pulses(&out), vec![(0, true), (12_000, true)]);
}

#[test]
fn nothing_is_interpolated_across_a_gap_longer_than_a_run() {
    let mut p = SongPulses::default();
    let mut out = Vec::new();
    p.witness("s", 0, None, &mut out);
    p.witness("s", SONG_RUN_GAP_MS + 6_000, None, &mut out);
    p.flush(&mut out);
    assert_eq!(
        pulses(&out),
        vec![(0, true), (SONG_RUN_GAP_MS + 6_000, true)]
    );
}

#[test]
fn the_auras_heartbeat_beats_six_second_arithmetic_inside_a_gap() {
    let mut p = SongPulses::default();
    let mut out = Vec::new();
    p.note_heartbeat(5_500);
    p.witness("s", 0, None, &mut out);
    p.witness("s", 12_000, None, &mut out);
    p.flush(&mut out);
    // 5,500 — the instant the log printed — rather than the arithmetic 6,000.
    assert_eq!(
        pulses(&out),
        vec![(0, true), (5_500, false), (12_000, true)]
    );
}

#[test]
fn everything_inside_one_second_of_a_witness_is_the_same_pulse() {
    let mut p = SongPulses::default();
    let mut out = Vec::new();
    p.witness("s", 0, Some("a rat"), &mut out);
    p.witness("s", 800, Some("a bat"), &mut out);
    p.flush(&mut out);
    let SongOut::Pulse(pulse) = &out[0] else {
        panic!("a pulse");
    };
    assert_eq!(
        pulse.resisted,
        vec!["a rat".to_string(), "a bat".to_string()]
    );
    assert_eq!(out.len(), 1);
}
