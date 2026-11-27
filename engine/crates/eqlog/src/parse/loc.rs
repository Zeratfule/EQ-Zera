//! `/loc`'s answer: `Your Location is <ns>, <ew>, <z>` (measured 2026-11-27 in
//! `eqlog_<Char>_freeport.txt`: `Your Location is 218.95, 91.12, 17.90`).
//!
//! Anchored at the start of the message, so the game's own system line is the only shape that
//! claims: a tell, say or channel line quoting the sentence starts with the speaker's name.
//! North/south is printed FIRST; the fields are named `ns`/`ew` so nothing calls them x and y.
//! Accepted risk: a custom emote reading `Your Location is …` exactly (a player named `Your`
//! typing `/em Location is 1, 2, 3`) would match; it costs one wrong dot until the next /loc.

use crate::event::{Ev, Key, Kind};
use regex::Regex;

use super::Ctx;

const PREFIX: &str = "Your Location is ";

fn loc_re() -> &'static Regex {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| {
        let n = r"(-?[0-9]+(?:\.[0-9]+)?)";
        Regex::new(&format!(r"^Your Location is {n}, {n}, {n}$")).unwrap()
    })
}

pub fn classify_loc(c: &Ctx, out: &mut Ev) -> bool {
    if !c.text.starts_with(PREFIX) {
        return false;
    }
    let Some(m) = loc_re().captures(c.text) else {
        return false;
    };
    let num = |i: usize| m[i].parse::<f64>().ok().filter(|v| v.is_finite());
    let (Some(ns), Some(ew), Some(z)) = (num(1), num(2), num(3)) else {
        return false;
    };
    out.begin(Kind::Loc);
    out.envelope(c.seq, c.ts, c.raw);
    out.f(Key::Ns, ns);
    out.f(Key::Ew, ew);
    out.f(Key::Z, z);
    true
}

#[cfg(test)]
mod tests {
    use crate::event::Ev;
    use crate::timestamp::Clock;
    use crate::Parser;

    fn parse(raw: &str) -> String {
        let p = Parser::new(Clock::new(chrono_tz::America::Los_Angeles), None, None);
        let mut ev = Ev::new();
        assert!(p.parse_event(raw, 0, &mut ev), "line was not timestamped");
        ev.finish().to_string()
    }

    #[test]
    fn the_measured_line_is_a_loc_with_ns_first() {
        let out = parse("[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90");
        assert!(out.starts_with(r#"{"kind":"loc","#), "{out}");
        assert!(
            out.ends_with(r#""ns":218.95,"ew":91.12,"z":17.9}"#),
            "{out}"
        );
    }

    #[test]
    fn negative_and_integer_readings_parse() {
        let out = parse("[Fri Nov 27 16:44:57 2026] Your Location is -192.19, -129.81, -3");
        assert!(
            out.ends_with(r#""ns":-192.19,"ew":-129.81,"z":-3}"#),
            "{out}"
        );
    }

    /// Chat quoting the sentence starts with the speaker, so none of it is the system line.
    #[test]
    fn chat_quoting_the_sentence_is_never_a_loc() {
        for raw in [
            "[Fri Nov 27 16:44:57 2026] Somebody tells General:1, 'Your Location is 1.00, 2.00, 3.00'",
            "[Fri Nov 27 16:44:57 2026] Somebody says, 'Your Location is 1.00, 2.00, 3.00'",
            "[Fri Nov 27 16:44:57 2026] Somebody tells you, 'Your Location is 1.00, 2.00, 3.00'",
            "[Fri Nov 27 16:44:57 2026] You say, 'Your Location is 1.00, 2.00, 3.00'",
            "[Fri Nov 27 16:44:57 2026] Somebody shouts, 'Your Location is 1.00, 2.00, 3.00'",
            "[Fri Nov 27 16:44:57 2026] Somebody Your Location is 1.00, 2.00, 3.00",
        ] {
            let out = parse(raw);
            assert!(!out.starts_with(r#"{"kind":"loc""#), "{raw} -> {out}");
        }
    }

    #[test]
    fn a_malformed_reading_claims_nothing() {
        for raw in [
            "[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12",
            "[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90, 4.00",
            "[Fri Nov 27 16:44:57 2026] Your Location is 218.95, north, 17.90",
            "[Fri Nov 27 16:44:57 2026] Your Location is 218.95 91.12 17.90",
            "[Fri Nov 27 16:44:57 2026] Your Location is 218.95, 91.12, 17.90 and more",
            "[Fri Nov 27 16:44:57 2026] Your Location is ",
        ] {
            let out = parse(raw);
            assert!(out.starts_with(r#"{"kind":"unknown""#), "{raw} -> {out}");
        }
    }
}
