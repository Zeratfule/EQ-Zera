//! THE COMBAT PHASE SPLIT, printed at the end of `--stages` when parity was built with
//! `--features profile` (which turns on `fold/profile`). Without the feature every timer is a
//! no-op and this says so in one line rather than printing a column of zeros.

pub fn print() {
    let rows = fold::combat::ingest::damage::prof::report();
    let total: u64 = rows.iter().map(|r| r.1).sum();
    if total == 0 {
        println!("  (combat phase split: build parity with --features profile)");
        return;
    }
    println!("  combat phases (feature profile), booked inside the consumer's share above:");
    for (name, ns) in rows {
        println!("    {name:<20} {:>6} ms", ns / 1_000_000);
    }
}
