//! Which `spells_us.txt` row widths [`crate::spells_us`] reads, and how a patched row is mapped back
//! onto the field map. The app's `realign` (`src/main/resist/spellsUsParse.ts`) is the same rule;
//! `tests/spellsUsLayoutParity.test.mts` holds the two width lists equal, because the app's
//! game-file health check judges the file against its list and a width one reader skips while the
//! other reads at moved offsets is a silent wrong answer.

use super::F_SLOTS;

/// The August 2026 width the field map was measured on.
const LAYOUT_2026_08: usize = F_SLOTS + 1;
/// The 2026-11-08 client: one column inserted at index 77, so 78.. move up by one.
const LAYOUT_2026_11: usize = F_SLOTS + 2;
/// The 2026-11-24 client: the 174-field row plus sixteen columns before the slots, which stay last.
const LAYOUT_2026_11B: usize = LAYOUT_2026_11 + 16;
/// Where the November column went in.
const INSERTED_BEFORE: usize = 77;

/// Every row width [`realign`] reads: measured layouts only. 172 is not one (no client has written
/// it); it is what a patch that drops a column writes.
pub const KNOWN_ROW_LENGTHS: [usize; 3] = [LAYOUT_2026_08, LAYOUT_2026_11, LAYOUT_2026_11B];

/// A row at a measured width, mapped onto the original field map; `None` for any other width, which
/// is skipped rather than read at offsets that moved.
pub(crate) fn realign(f: Vec<&str>) -> Option<Vec<&str>> {
    match f.len() {
        LAYOUT_2026_08 => Some(f),
        LAYOUT_2026_11 => {
            let mut f = f;
            f.remove(INSERTED_BEFORE);
            Some(f)
        }
        LAYOUT_2026_11B => {
            let mut out = f[..INSERTED_BEFORE].to_vec();
            out.extend_from_slice(&f[INSERTED_BEFORE + 1..=F_SLOTS]);
            out.push(f[f.len() - 1]);
            Some(out)
        }
        _ => None,
    }
}

/// The field checks, shared with the app (`src/main/resist/spellsUsSemantics.ts`). The JSON's own
/// header says how each check and floor was measured.
const CHECKS_JSON: &str = include_str!("../../../../../src/shared/spellsUsChecks.json");

#[derive(serde::Deserialize)]
struct Check {
    col: usize,
    kind: String,
    #[serde(default)]
    args: Vec<String>,
    floor: f64,
}

#[derive(serde::Deserialize)]
struct Checks {
    #[serde(rename = "minRows")]
    min_rows: usize,
    checks: Vec<Check>,
}

fn table() -> &'static Checks {
    static CHECKS: std::sync::OnceLock<Checks> = std::sync::OnceLock::new();
    CHECKS.get_or_init(|| {
        serde_json::from_str::<Checks>(CHECKS_JSON).unwrap_or(Checks {
            min_rows: 0,
            checks: Vec::new(),
        })
    })
}

fn checks() -> &'static [Check] {
    &table().checks
}

/// JavaScript's `/^-?\d+$/`.
fn is_int(v: &str) -> bool {
    let digits = v.strip_prefix('-').unwrap_or(v);
    !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())
}

/// A field as a number, for an `is_int` field only.
fn num(v: &str) -> f64 {
    v.parse::<f64>().unwrap_or(f64::NAN)
}

/// The app's `/^\d+\|-?\d+\|/`, the head of an effect slot.
fn slot_head(v: &str) -> bool {
    let mut parts = v.splitn(3, '|');
    let (Some(a), Some(b), Some(_)) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !a.is_empty() && a.bytes().all(|x| x.is_ascii_digit()) && is_int(b)
}

/// One check on one field; `None` is a field past the end of the row. Mirrors `compile` in
/// spellsUsSemantics.ts kind for kind.
fn passes(c: &Check, v: Option<&str>) -> bool {
    match c.kind.as_str() {
        // `eq` is `oneOf` with one value; both compare text, so a non-numeric field can match.
        "eq" | "oneOf" => v.is_some_and(|v| c.args.iter().any(|a| a == v)),
        "name" => v.is_some_and(|v| !v.trim().is_empty() && !is_int(v.trim())),
        "emptyOrText" => v.is_some_and(|v| !is_int(v)),
        "slotGrammar" => {
            let t = v.unwrap_or("").trim();
            t.is_empty() || slot_head(t)
        }
        _ => v.filter(|v| is_int(v)).is_some_and(|v| passes_int(c, v)),
    }
}

/// The kinds that read an integer field (the caller has checked it is one).
fn passes_int(c: &Check, v: &str) -> bool {
    let arg = |i: usize| c.args.get(i).map_or(f64::NAN, |a| num(a));
    let x = num(v);
    match c.kind.as_str() {
        "notOneOf" => !c.args.iter().any(|a| a == v),
        "within" => x >= arg(0) && x <= arg(1),
        "multipleOf" => x % arg(0) == 0.0,
        "multipleOfNonZero" => v != "0" && x % arg(0) == 0.0,
        "notMultipleOf" => x % arg(0) != 0.0,
        "nonZero" => v != "0",
        _ => false,
    }
}

/// The app's width rule: rows exist, at most half are an unmeasured width, and the commonest width
/// (first seen wins a tie, as the app's histogram does) is a measured one.
fn widths_recognised(text: &str) -> bool {
    let mut seen: Vec<(usize, usize)> = Vec::new();
    let mut rows = 0usize;
    for line in text.split('\n') {
        if line.trim_end_matches('\r').is_empty() {
            continue;
        }
        rows += 1;
        let width = line.matches('^').count() + 1;
        match seen.iter_mut().find(|(w, _)| *w == width) {
            Some((_, n)) => *n += 1,
            None => seen.push((width, 1)),
        }
    }
    let read: usize = seen
        .iter()
        .filter(|(w, _)| KNOWN_ROW_LENGTHS.contains(w))
        .map(|(_, n)| n)
        .sum();
    let dominant = seen
        .iter()
        .fold(
            (0, 0),
            |best, &(w, n)| if n > best.1 { (w, n) } else { best },
        )
        .0;
    rows > 0 && (rows - read) * 2 <= rows && KNOWN_ROW_LENGTHS.contains(&dominant)
}

/// Does this build recognise the file: the app's width rule and every field check at its floor.
/// The engine serves no client table from a file that fails, which is what makes the app's
/// "paused" notice true for the engine's surfaces too. The field checks are shares, so they judge
/// only a file of at least the JSON's `minRows` rows, as the app's do.
#[must_use]
pub fn recognised(text: &str) -> bool {
    recognised_with(text, table().min_rows)
}

/// [`recognised`] with the field checks judging any file of at least `min_rows` rows.
#[must_use]
#[allow(
    clippy::cast_precision_loss,
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "row counts far below 2^52; the ceiling of a non-negative product is a count"
)]
pub fn recognised_with(text: &str, min_rows: usize) -> bool {
    if !widths_recognised(text) {
        return false;
    }
    let checks = checks();
    let mut pass = vec![0usize; checks.len()];
    let mut rows = 0usize;
    for line in text.split('\n').filter(|l| !l.is_empty()) {
        let Some(f) = realign(line.split('^').collect()) else {
            continue;
        };
        rows += 1;
        for (i, c) in checks.iter().enumerate() {
            if passes(c, f.get(c.col).copied()) {
                pass[i] += 1;
            }
        }
    }
    rows < min_rows
        || checks
            .iter()
            .zip(pass)
            .all(|(c, n)| n >= (rows as f64 * c.floor).ceil() as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spells_us::parse_spells_us;

    #[test]
    fn the_shared_checks_parse() {
        assert!(checks().len() > 30, "src/shared/spellsUsChecks.json parsed");
        assert!(table().min_rows > 0);
    }

    /// At a real file's size the field checks run in production: a moved file is not recognised
    /// (so the engine serves no table from it), the unmoved one is.
    #[test]
    fn a_real_sized_moved_file_is_refused_and_a_real_sized_good_one_is_not() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/spellsUsShape");
        let big = |name: &str| {
            std::fs::read_to_string(dir.join(format!("{name}.txt")))
                .expect("a parity file")
                .repeat(table().min_rows / 30 + 1)
        };
        assert!(recognised(&big("ok-190")));
        assert!(!recognised(&big("moved-20-61")));
        assert!(!recognised(&big("moved-5-77")));
        let small = std::fs::read_to_string(dir.join("moved-20-61.txt")).expect("a parity file");
        assert!(recognised(&small), "thirty rows are judged on width alone");
    }

    /// The parity set (tests/spellsUsParity.test.mts writes it and holds the app to it): the engine
    /// must reach the same verdict on the same bytes.
    #[test]
    fn the_engine_agrees_with_the_app_on_every_parity_file() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../tests/fixtures/spellsUsShape");
        let expected: std::collections::BTreeMap<String, String> = serde_json::from_str(
            &std::fs::read_to_string(dir.join("expected.json")).expect("expected.json"),
        )
        .expect("json");
        assert!(expected.len() >= 8);
        for (name, verdict) in expected {
            let text =
                std::fs::read_to_string(dir.join(format!("{name}.txt"))).expect("a parity file");
            let ok = recognised_with(&text, 0) && !parse_spells_us(&text).is_empty();
            assert_eq!(ok, verdict == "ok", "{name}");
        }
    }

    /// Lifetap on the 173-field map (id 0, name 1, resist adjust 78, category 86, subcategory 87,
    /// SHD level at 40, slots 172; every other class barred), widened the way a client patch widened
    /// it: `extra` columns inserted at index 77, `tail` more just before the slots. Hand-authored:
    /// the client's file never enters this repo.
    fn lifetap_at(extra: usize, tail: usize) -> String {
        let mut f = vec!["0"; LAYOUT_2026_08];
        for c in &mut f[36..52] {
            *c = "255";
        }
        for (i, v) in [
            (0, "341"),
            (1, "Lifetap"),
            (78, "-200"),
            (86, "114"),
            (87, "43"),
            (40, "1"),
            (F_SLOTS, "1|0|-4|0|101|8"),
        ] {
            f[i] = v;
        }
        for _ in 0..extra {
            f.insert(INSERTED_BEFORE, "0");
        }
        for _ in 0..tail {
            f.insert(f.len() - 1, "0");
        }
        f.join("^")
    }

    #[test]
    fn both_november_layouts_read_every_field_where_the_map_says() {
        for (extra, tail, width) in [
            (0, 0, LAYOUT_2026_08),
            (1, 0, LAYOUT_2026_11),
            (1, 16, LAYOUT_2026_11B),
        ] {
            let text = lifetap_at(extra, tail);
            assert_eq!(text.split('^').count(), width);
            let table = parse_spells_us(&text);
            let info = table.values().next().expect("the row is read");
            assert_eq!(info.category, Some(114), "width {width}");
            assert_eq!(info.subcategory, Some(43), "width {width}");
            assert!(
                (info.resist_adj + 200.0).abs() < f64::EPSILON,
                "width {width}"
            );
            assert_eq!(info.hp.len(), 1, "the slots are found at width {width}");
        }
    }

    #[test]
    fn an_unmeasured_width_is_skipped_rather_than_read_at_moved_offsets() {
        assert!(parse_spells_us(&lifetap_at(1, 26)).is_empty(), "200 fields");
        assert!(parse_spells_us(&lifetap_at(1, 1)).is_empty(), "175 fields");
        let full = lifetap_at(0, 0);
        let dropped: Vec<&str> = full.split('^').skip(1).collect();
        assert!(parse_spells_us(&dropped.join("^")).is_empty(), "172 fields");
        assert_eq!(KNOWN_ROW_LENGTHS, [173, 174, 190]);
    }
}
