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

/// Every row width [`realign`] reads.
pub const KNOWN_ROW_LENGTHS: [usize; 4] =
    [F_SLOTS, LAYOUT_2026_08, LAYOUT_2026_11, LAYOUT_2026_11B];

/// A row at a measured width, mapped onto the original field map; `None` for any other width, which
/// is skipped rather than read at offsets that moved.
pub(crate) fn realign(f: Vec<&str>) -> Option<Vec<&str>> {
    match f.len() {
        F_SLOTS | LAYOUT_2026_08 => Some(f),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spells_us::parse_spells_us;

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
        assert_eq!(KNOWN_ROW_LENGTHS, [172, 173, 174, 190]);
    }
}
