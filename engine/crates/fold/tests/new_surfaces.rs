//! THE FIVE SURFACES ADDED 2026-09-08, each pinned as the WHOLE published shape.
//!
//! `hails`, `faction`, `coin`, `skills` and `deaths` publish facts the log always stated and
//! nothing in this program ever read: the NPCs you greeted, how far each faction moved, every coin
//! that reached you (including the auto-vendor's price, which the parser discarded until this
//! change), what the client says your skills are worth, and what the last seconds before a death
//! looked like.
//!
//! WHY THE WHOLE SHAPE AND NOT A FIELD AT A TIME. These snapshots are the samples five TypeScript
//! type files are written against; a test that asserted one leaf would let a renamed sibling ship.
//! An `assert_eq!` against a `json!` literal fails by printing both trees, which is the diff a
//! reader of a shape change actually wants.
//!
//! AND IT IS ONE TEST, NOT FIVE, because the claim is about the SET: five modules were registered
//! in `WIRING_ORDER` and each must publish a versioned object. A snapshot that came back `null` for
//! one of them is the failure a per-module test could pass around.
//!
//! It sits in the integration suite rather than inline beside the fold because it exercises the
//! registry through its public door — `registered()` → `on_primary` → `snapshots()` — which is
//! exactly what `announce.rs` next door does with the dirty bit.

use fold::event::Event;
use fold::{registered, ClusterDeps, Fold};
use serde_json::{json, Value};

/// A fold of these JSON events, and its published snapshots.
///
/// `launch_ms` at `i64::MAX` is the fold suite's own construction: no line is after the launch
/// anchor, so the epoch detector synthesizes nothing and every row below is the work of the event
/// beside it.
fn fold_lines(lines: &[&str]) -> Value {
    let mut fold = Fold::new(registered(ClusterDeps::default()), i64::MAX);
    for line in lines {
        let ev = Event::from_json(line).expect("a JSON object");
        fold.on_primary(&ev, false);
    }
    fold.registry.snapshots()
}

fn state_of(snaps: &Value, id: &str) -> Value {
    snaps["modules"]
        .as_array()
        .expect("modules")
        .iter()
        .find(|m| m["id"] == id)
        .unwrap_or_else(|| panic!("{id} is not registered"))["snapshot"]["state"]
        .clone()
}

#[test]
fn the_five_new_modules_publish_the_shapes_their_consumers_are_typed_against() {
    let snaps = fold_lines(&[
        r#"{"kind":"zone","seq":0,"ts":1000,"raw":"z","zone":"Nagafen's Lair"}"#,
        r#"{"kind":"hail","seq":1,"ts":2000,"raw":"h","npc":"Beur Tenlah"}"#,
        r#"{"kind":"factionHit","seq":2,"ts":3000,"raw":"f","faction":"Solusek Mining Co.","delta":5}"#,
        r#"{"kind":"factionHit","seq":3,"ts":4000,"raw":"f","faction":"solusek mining co.","delta":-2}"#,
        r#"{"kind":"factionHit","seq":4,"ts":5000,"raw":"f","faction":"Inhabitants of Hate","cap":"min"}"#,
        r#"{"kind":"loot","seq":5,"ts":6000,"raw":"l","item":"Sapphire Necklace +4","source":"Cleric of Innoruuk","disposition":"sold","coins":{"platinum":125}}"#,
        r#"{"kind":"skillUp","seq":6,"ts":7000,"raw":"s","skill":"Meditate","value":57}"#,
        r#"{"kind":"damage","seq":7,"ts":8000,"raw":"d","attacker":"a fire giant","target":"You","amount":106,"skill":"Melee","dtype":"melee","crit":false}"#,
        r#"{"kind":"resist","seq":8,"ts":8500,"raw":"r","caster":"a fire giant","target":"You","spell":"Fear","incoming":true}"#,
        r#"{"kind":"playerDeath","seq":9,"ts":9000,"raw":"p","killer":"a fire giant"}"#,
    ]);

    assert_eq!(
        state_of(&snaps, "hails"),
        json!({ "v": 1, "recent": [{ "npc": "Beur Tenlah", "ts": 2000 }] })
    );

    // The key is lowercased; `display` is the FIRST spelling, so the second line's casing does not
    // rewrite the label. The rail is COUNTED and enters no sum — `delta` is 3, not 3-with-a-zero.
    assert_eq!(
        state_of(&snaps, "faction"),
        json!({
            "v": 1,
            "factions": {
                "inhabitants of hate": { "display": "Inhabitants of Hate", "delta": 0, "hits": 0, "maxed": 0, "bottomed": 1, "firstTs": 5000, "lastTs": 5000 },
                "solusek mining co.": { "display": "Solusek Mining Co.", "delta": 3, "hits": 2, "maxed": 0, "bottomed": 0, "firstTs": 3000, "lastTs": 4000 },
            },
            "recent": [
                { "faction": "Solusek Mining Co.", "delta": 5, "ts": 3000 },
                { "faction": "solusek mining co.", "delta": -2, "ts": 4000 },
                { "faction": "Inhabitants of Hate", "cap": "min", "ts": 5000 },
            ],
        })
    );

    // The auto-vendor row, zone-stamped exactly as a loot row is, with only the denominations the
    // clause named — and no total anywhere.
    assert_eq!(
        state_of(&snaps, "coin"),
        json!({
            "v": 1,
            "rows": [{
                "ts": 6000,
                "source": "sold",
                "platinum": 125,
                "item": "Sapphire Necklace +4",
                "zone": "Nagafen's Lair",
            }],
        })
    );

    assert_eq!(
        state_of(&snaps, "skills"),
        json!({
            "v": 1,
            "skills": {
                "meditate": { "display": "Meditate", "value": 57, "ups": 1, "firstTs": 7000, "lastTs": 7000, "history": [[7000, 57]] },
            },
        })
    );

    // The recap quotes the window; `taken` is the window's sum and says so beside `windowMs`. The
    // resist rides along carrying no amount, so it cannot enter that sum (law 8).
    assert_eq!(
        state_of(&snaps, "deaths"),
        json!({
            "v": 1,
            "recaps": [{
                "ts": 9000,
                "killer": "a fire giant",
                "zone": "Nagafen's Lair",
                "windowMs": 15000,
                "taken": 106,
                "hits": [{ "ts": 8000, "attacker": "a fire giant", "skill": "Melee", "dtype": "melee", "amount": 106, "crit": false }],
                "byAttacker": [{ "name": "a fire giant", "amount": 106, "hits": 1 }],
                "bySkill": [{ "name": "Melee", "amount": 106, "hits": 1 }],
                "resisted": [{ "ts": 8500, "caster": "a fire giant", "spell": "Fear" }],
            }],
        })
    );
}

/// The ring ages off the LOG's clock, not a wall clock — so a hit older than the recap window is
/// not in the recap, and one older than the ring is not kept at all.
#[test]
fn a_recap_quotes_its_window_and_nothing_the_ring_has_already_aged_out() {
    let snaps = fold_lines(&[
        // 40 s before the death: inside the 60 s ring, outside the 15 s window.
        r#"{"kind":"damage","seq":0,"ts":60000,"raw":"d","attacker":"an old wound","target":"You","amount":9999,"skill":"Melee","dtype":"melee","crit":false}"#,
        // 5 s before: in the window.
        r#"{"kind":"damage","seq":1,"ts":95000,"raw":"d","attacker":"a fire giant","target":"You","amount":40,"skill":"Melee","dtype":"melee","crit":false}"#,
        // Outgoing, and so nobody's recap.
        r#"{"kind":"damage","seq":2,"ts":96000,"raw":"d","attacker":"You","target":"a fire giant","amount":700,"skill":"Melee","dtype":"melee","crit":false}"#,
        r#"{"kind":"playerDeath","seq":3,"ts":100000,"raw":"p"}"#,
    ]);
    let recaps = state_of(&snaps, "deaths")["recaps"].clone();
    assert_eq!(recaps.as_array().expect("recaps").len(), 1);
    assert_eq!(recaps[0]["taken"], 40, "{recaps}");
    assert_eq!(recaps[0]["hits"].as_array().expect("hits").len(), 1);
    assert_eq!(recaps[0]["hits"][0]["attacker"], "a fire giant");
    // `You died.` names no killer, and an absent optional is omitted rather than written as null.
    assert!(recaps[0].get("killer").is_none(), "{recaps}");
}

/// `for free.` states a price, and the price is nothing. The row exists and names no denomination.
#[test]
fn a_free_auto_sale_is_a_row_with_no_denomination_on_it() {
    let snaps = fold_lines(&[
        r#"{"kind":"loot","seq":0,"ts":1000,"raw":"l","item":"Thorny Vine Helm","source":"Cleric of Innoruuk","disposition":"sold","coins":{}}"#,
    ]);
    assert_eq!(
        state_of(&snaps, "coin"),
        json!({ "v": 1, "rows": [{ "ts": 1000, "source": "sold", "item": "Thorny Vine Helm" }] })
    );
}
