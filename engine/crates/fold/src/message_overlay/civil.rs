//! The civil-date arithmetic the overlay register's `updatedAt` is printed with. Lifted out of the
//! miner's file unchanged (Z Engine, 2026-09-07) so that file stays at its factoring line.

/// `new Date(ms).toISOString()` — UTC, always three fractional digits, always the `Z` suffix.
///
/// Written out rather than pulling in a date crate: this direction needs no zone database and no
/// table, so twenty-four characters would not be worth a dependency.
///
/// The civil-from-days algorithm is Howard Hinnant's. Days are floored rather than truncated so a
/// pre-epoch instant is still correct.
pub(super) fn iso_utc(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    let (h, min, s, milli) = (
        rem / 3_600_000,
        rem / 60_000 % 60,
        rem / 1000 % 60,
        rem % 1000,
    );
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{min:02}:{s:02}.{milli:03}Z")
}

/// Days since 1970-01-01 → (year, month, day), Gregorian.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

