//! The EverQuest Legends log parser: bytes in, canonical events out.
//!
//! Two ways in and one line law between them: `scan.rs` folds a complete file, `tail.rs` follows one
//! EverQuest is still appending to, and the tail's line sequence must equal the scan's over any
//! chunking at all.
//!
//! The bar is byte identity with the TypeScript parser's NDJSON event stream, not equivalence. That
//! is why several things here look stranger than a merely correct parser would:
//!
//!   * events are written key by key rather than derived (`event.rs`), because `JSON.stringify`
//!     writes insertion order and the insertion order is a property of the code path;
//!   * `\d`, `\w`, `\s`, `.trim()` and `JSON.stringify`'s escape set are spelled out (`jsstr.rs`),
//!     because JavaScript's are ASCII-or-ECMA where Rust's are Unicode;
//!   * timestamps resolve through an IANA zone with historical DST (`timestamp.rs`), because the TS
//!     hands a zone-less string to `Date.parse` and gets host local time;
//!   * the whole spell-DB load path is reproduced (`spelldb/`), because the `candidates` list a
//!     `buffApply` carries is that database.
//!
//! A parse produces two things at once: the NDJSON line, and a typed `Payload` recording the kind as
//! a discriminant with each field as a `(Key, Slot)` pair in write order, strings in one reused
//! arena. The fold reads the payload; re-parsing the line into a `serde_json::Value` cost 9.6% of a
//! whole fold. Both halves are handed over together because the writer's buffers are reused — a
//! caller that took one could not ask for the other afterwards.
//!
//! A parse is a pure function of (bytes, spell-DB version, character name). Everything stateful
//! lives on `Parser` and nothing outlives it.

pub mod event;
pub mod jsstr;
pub mod names;
pub mod parse;
pub mod scan;
pub mod spelldb;
pub mod stems;
pub mod tail;
pub mod taxonomy;
pub mod timestamp;

/// Re-exported so a consumer names the zone type through this crate rather than pinning its own
/// `chrono-tz` version — two tz databases in one process is a way for two answers to appear.
pub use chrono_tz::Tz;
pub use parse::Parser;
pub use timestamp::{
    host_timezone, platform_timezone, resolve_zone, Civil, Clock, ResolvedZone, Zone, ZoneHint,
    ZoneSource,
};

/// Build the parser the app builds: the effective spell DB installed, and the tailed character's
/// name known.
///
/// The character name must be installed before the fold — the self-`/who` rule and the pet-leader
/// carve-out both decline every line until it is set. The catalog is the process's one copy
/// (`spelldb::shared`), so a second parser does not pay the 386 ms build again.
pub fn parser_for(character: &str, tz: chrono_tz::Tz) -> Parser {
    Parser::new(
        Clock::new(tz),
        Some(spelldb::shared()),
        Some(character.to_string()),
    )
}

/// The log filename shape, `eqlog_<Name>_<server>.<slice>.txt`, spelled once: two readers take two
/// groups off it, and a second copy would let them disagree about what a log file is called.
fn log_file_re() -> &'static regex::Regex {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"(?i)^eqlog_(.+?)_([^_]+?)\.[^.]+\.txt$").unwrap())
}

/// The character a slice was cut from, derived from its FILENAME. Hardcoding the name would let the
/// corpus and the harness drift apart silently.
pub fn character_of(file_name: &str) -> Option<String> {
    log_file_re().captures(file_name).map(|m| m[1].to_string())
}

/// The server out of the same filename: the character module publishes a whole `CharacterRef`, and
/// the golden recorder derives every field of it from the filename.
pub fn server_of(file_name: &str) -> Option<String> {
    log_file_re().captures(file_name).map(|m| m[2].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::Ev;

    fn parse_one(p: &Parser, raw: &str) -> String {
        let mut ev = Ev::new();
        assert!(p.parse_event(raw, 0, &mut ev), "line was not timestamped");
        ev.finish().to_string()
    }

    fn bare() -> Parser {
        Parser::new(
            Clock::new(chrono_tz::America::Los_Angeles),
            None,
            Some("Primitive".to_string()),
        )
    }

    #[test]
    fn the_character_comes_off_the_filename() {
        assert_eq!(
            character_of("eqlog_Primitive_freeport.patch-week.txt").as_deref(),
            Some("Primitive")
        );
        assert_eq!(character_of("not-a-log.txt"), None);
    }

    #[test]
    fn an_unclassified_line_is_the_unknown_envelope() {
        let p = bare();
        assert_eq!(
            parse_one(
                &p,
                "[Wed Aug 19 16:21:47 2026] You are not currently assigned to an adventure."
            ),
            r#"{"kind":"unknown","seq":0,"ts":1787181707000,"raw":"[Wed Aug 19 16:21:47 2026] You are not currently assigned to an adventure."}"#
        );
    }

    #[test]
    fn a_line_with_no_timestamp_is_no_event_at_all() {
        let p = bare();
        let mut ev = Ev::new();
        assert!(!p.parse_event("no bracket here", 0, &mut ev));
    }

    /// A chat line carrying bare carriage returns is not a log line at all: it must produce no
    /// event, so `seq` does not advance. See `jsstr::JS_DOT`.
    #[test]
    fn a_line_with_an_embedded_carriage_return_is_no_event_at_all() {
        let p = bare();
        let mut ev = Ev::new();
        assert!(!p.parse_event(
            "[Sun Aug 16 20:09:40 2026] Velkator tells general2:1, 'rebaseline\rCount items from\r/outputfile inventory'",
            0,
            &mut ev
        ));
        // …but a CR sitting where the one optional space goes is consumed by `\s?` and the line
        // parses.
        assert!(p.parse_event(
            "[Sun Aug 16 20:09:40 2026]\rWelcome to EverQuest Legends!",
            0,
            &mut ev
        ));
        assert!(ev.finish().starts_with(r#"{"kind":"sessionStart""#));
    }

    /// The instance-creation notice. Synthetic sentence, real shape: the player name is invented
    /// because the line this was learned from is a reporter's own log.
    #[test]
    fn the_instance_notice_names_the_creator_the_zone_and_the_id() {
        let p = bare();
        let raw =
            "[Thu Aug 27 00:24:09 2026] Player Wanderling creating instance The Plane of Sky 6038.";
        assert_eq!(
            parse_one(&p, raw),
            format!(
                r#"{{"kind":"instanceCreate","seq":0,"ts":1787815449000,"raw":{},"player":"Wanderling","zone":"The Plane of Sky","instance":6038}}"#,
                serde_json::to_string(raw).unwrap()
            )
        );
    }

    /// The id is the last number, so a zone whose own name ends in an ordinal keeps it; a notice
    /// with no id is not this line family and claims nothing.
    #[test]
    fn the_instance_id_never_eats_the_end_of_the_zone_name() {
        let p = bare();
        let out = parse_one(
            &p,
            "[Thu Aug 27 00:24:09 2026] Player Wanderling creating instance Befallen 2 6038.",
        );
        assert!(out.contains(r#""zone":"Befallen 2""#), "{out}");
        assert!(out.contains(r#""instance":6038"#), "{out}");
        let out = parse_one(
            &p,
            "[Thu Aug 27 00:24:09 2026] Player Wanderling creating instance The Plane of Sky.",
        );
        assert!(out.starts_with(r#"{"kind":"unknown""#), "{out}");
    }

    #[test]
    fn the_group_kind_writes_change_before_the_envelope() {
        let p = bare();
        assert_eq!(
            parse_one(
                &p,
                "[Wed Aug 19 16:21:47 2026] Dranix has joined the group."
            ),
            r#"{"kind":"group","change":"join","name":"Dranix","seq":0,"ts":1787181707000,"raw":"[Wed Aug 19 16:21:47 2026] Dranix has joined the group."}"#
        );
    }

    #[test]
    fn a_typed_nuke_carries_dclass_and_an_empty_modifier_list() {
        let p = bare();
        let raw = "[Wed Aug 19 16:21:54 2026] Atesc hit a thunder spirit princess for 231 points of magic damage by Spirit Tap.";
        assert_eq!(
            parse_one(&p, raw),
            format!(
                r#"{{"kind":"damage","seq":0,"ts":1787181714000,"raw":{},"attacker":"Atesc","target":"a thunder spirit princess","amount":231,"dtype":"spell","dclass":"magic","skill":"Spirit Tap","crit":false,"modifiers":[],"category":"spell"}}"#,
                serde_json::to_string(raw).unwrap()
            )
        );
    }

    #[test]
    fn a_damage_shield_carries_no_modifier_list_at_all() {
        let p = bare();
        let out = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] a thunder spirit princess is burned by YOUR flames for 12 points of non-melee damage.",
        );
        assert!(out.contains(r#""attacker":"You""#), "{out}");
        assert!(!out.contains("modifiers"), "{out}");
        assert!(out.ends_with(r#""category":"ds"}"#), "{out}");
    }

    #[test]
    fn a_caster_less_dot_says_null_rather_than_omitting_the_attacker() {
        let p = bare();
        let out = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] a thunder spirit princess has taken 30 damage by Ignite Blood.",
        );
        assert!(out.contains(r#""attacker":null"#), "{out}");
    }

    #[test]
    fn the_experience_percentage_is_the_one_float_in_the_stream() {
        let p = bare();
        let out = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] You gain experience! (3.288%)",
        );
        assert!(out.ends_with(r#""party":false,"pct":3.288}"#), "{out}");
        // …and an integral one prints as JS prints it: no fraction.
        let out = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] You gain party experience! (3%)",
        );
        assert!(out.ends_with(r#""party":true,"pct":3}"#), "{out}");
        // …and a line that states none omits the key rather than saying zero.
        let bonus = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] You gain experience (with a bonus)! (3.288%)",
        );
        assert!(
            bonus.contains(r#""kind":"expGain""#),
            "the bonus spelling is an experience gain: {bonus}"
        );
        assert!(bonus.ends_with(r#""party":false,"pct":3.288}"#), "{bonus}");
        let dot = parse_one(
            &p,
            "[Sun Aug 16 17:57:49 2026] You have taken 12 damage from Choking by a thunder spirit princess.",
        );
        for expected in [
            r#""kind":"damage""#,
            r#""target":"You""#,
            r#""attacker":"a thunder spirit princess""#,
            r#""amount":12"#,
            r#""skill":"Choking""#,
            r#""dtype":"dot""#,
            r#""raw":"[Sun Aug 16 17:57:49 2026] You have taken 12 damage from Choking by a thunder spirit princess.""#,
        ] {
            assert!(
                dot.contains(expected),
                "the first-person DoT line: wanted {expected} in {dot}"
            );
        }
        let out = parse_one(&p, "[Wed Aug 19 16:21:54 2026] You gain experience!");
        assert!(out.ends_with(r#""party":false}"#), "{out}");
    }

    /// THE GREETING. Both spellings are real (the comma is the player's own typing), and a `You say`
    /// line that is not a hail stays exactly what it was: nothing.
    #[test]
    fn a_hail_names_the_npc_and_every_other_thing_you_say_is_still_unknown() {
        let p = bare();
        let raw = "[Wed Aug 19 16:21:54 2026] You say, 'Hail, Beur Tenlah'";
        assert_eq!(
            parse_one(&p, raw),
            format!(
                r#"{{"kind":"hail","seq":0,"ts":1787181714000,"raw":{},"npc":"Beur Tenlah"}}"#,
                serde_json::to_string(raw).unwrap()
            )
        );
        // The comma-less spelling is the same event.
        let bare_comma = parse_one(&p, "[Wed Aug 19 16:21:54 2026] You say, 'Hail Nicholas'");
        assert!(bare_comma.contains(r#""kind":"hail""#), "{bare_comma}");
        assert!(bare_comma.contains(r#""npc":"Nicholas""#), "{bare_comma}");
        // Conversation is not a hail and mints no `say` kind.
        let chat = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] You say, 'anyone need a port'",
        );
        assert!(chat.starts_with(r#"{"kind":"unknown""#), "{chat}");
    }

    /// THE TWO FACTION SENTENCES, and the rule that keeps them apart: `delta` is a number the line
    /// stated, `cap` is a rail the line named INSTEAD of a number. Never both.
    #[test]
    fn a_faction_line_states_either_a_delta_or_a_rail_and_never_both() {
        let p = bare();
        let raw = "[Wed Aug 05 20:42:02 2026] Your faction standing with Solusek Mining Co. has been adjusted by 5.";
        assert_eq!(
            parse_one(&p, raw),
            format!(
                r#"{{"kind":"factionHit","seq":0,"ts":1785987722000,"raw":{},"faction":"Solusek Mining Co.","delta":5}}"#,
                serde_json::to_string(raw).unwrap()
            )
        );
        let down = parse_one(
            &p,
            "[Wed Jul 29 01:24:24 2026] Your faction standing with Undead Frogloks of Guk has been adjusted by -15.",
        );
        assert!(
            down.ends_with(r#""faction":"Undead Frogloks of Guk","delta":-15}"#),
            "{down}"
        );
        // The saturation forms carry NO magnitude: a `cap`, and no `delta` to sum.
        let floored = parse_one(
            &p,
            "[Tue Aug 04 00:25:52 2026] Your faction standing with Inhabitants of Hate could not possibly get any worse.",
        );
        assert!(
            floored.ends_with(r#""faction":"Inhabitants of Hate","cap":"min"}"#),
            "{floored}"
        );
        assert!(
            !floored.contains("delta"),
            "a rail states no magnitude: {floored}"
        );
        let capped = parse_one(
            &p,
            "[Sun Aug 02 21:43:06 2026] Your faction standing with Frogloks of Guk could not possibly get any better.",
        );
        assert!(
            capped.ends_with(r#""faction":"Frogloks of Guk","cap":"max"}"#),
            "{capped}"
        );
    }

    /// THE SOLD PRICE, appended after every field a sold row already carried — so the bytes ahead of
    /// `coins` are the bytes this event has always printed.
    #[test]
    fn a_sold_loot_line_now_carries_the_price_it_always_stated() {
        let p = bare();
        let raw = "[Thu Aug 20 02:41:06 2026] You looted a Sapphire Necklace +4 from Cleric of Innoruuk's corpse and sold it for 125 platinum.";
        assert_eq!(
            parse_one(&p, raw),
            format!(
                r#"{{"kind":"loot","seq":0,"ts":1787218866000,"raw":{},"item":"Sapphire Necklace +4","source":"Cleric of Innoruuk","disposition":"sold","coins":{{"platinum":125}}}}"#,
                serde_json::to_string(raw).unwrap()
            )
        );
        // Every denomination the clause names, in the order it named them, and a stack count still
        // goes ahead of the price.
        let full = parse_one(
            &p,
            "[Wed Jul 29 01:23:12 2026] You looted 2 Phosphorous Powder from a zol ghoul knight's corpse and sold it for 2 platinum, 5 gold, 7 silver and 2 copper.",
        );
        assert!(
            full.ends_with(
                r#""disposition":"sold","count":2,"coins":{"platinum":2,"gold":5,"silver":7,"copper":2}}"#
            ),
            "{full}"
        );
        // `for free.` DID state a price, and the price was nothing.
        let free = parse_one(
            &p,
            "[Thu Aug 20 02:46:23 2026] You looted a Thorny Vine Helm from Cleric of Innoruuk's corpse and sold it for free.",
        );
        assert!(
            free.ends_with(r#""disposition":"sold","coins":{}}"#),
            "{free}"
        );
    }

    #[test]
    fn the_spell_db_puts_a_candidate_list_on_a_landing() {
        let p = parser_for("Primitive", chrono_tz::America::Los_Angeles);
        let out = parse_one(
            &p,
            "[Wed Aug 19 16:21:54 2026] A thunder spirit princess staggers.",
        );
        assert!(out.starts_with(r#"{"kind":"buffApply","#), "{out}");
        assert!(out.contains(r#""candidates":[{"name":"#), "{out}");
    }
}
