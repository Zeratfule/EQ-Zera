//! The attributed fold - `parity --stages`'s stopwatch over every consumer. Lifted out of lib.rs
//! (Z Engine, 2026-09-07) unchanged; it is the parity tool's instrument, never the app's path.

use super::*;

impl Fold {
    /// [`Fold::fold_bytes`] with per-consumer attribution: nanoseconds per registered module
    /// (delivery order), for the combat engine, the two detectors, and the event wrap. The bus
    /// semantics are `on_primary`/`observe`'s, restated here with stopwatches because a flag on the
    /// production path would make every ordinary fold pay the clock reads.
    ///
    /// Observer cost: ~2 clock reads per consumer per event (~40-60 ns a pair), inflating each
    /// bucket equally — shares are trustworthy, absolutes are a shade high.
    pub fn fold_bytes_attributed(
        &mut self,
        parser: &eqlog::Parser,
        bytes: &[u8],
    ) -> FoldAttribution {
        let mut out = FoldAttribution {
            module_ids: self.registry.ids(),
            module_ns: vec![0u64; self.registry.ids().len()],
            combat_ns: 0,
            detectors_ns: 0,
            reparse_ns: 0,
        };
        eqlog::scan::scan_bytes(parser, bytes, |_json, payload| {
            // The `reparse_ns` bucket now measures wrapping the parser's payload — a discriminant
            // copy and a reference. It stays in the table because the attribution is compared
            // against an earlier baseline, and a vanished row would read as a row nobody measured.
            let t = std::time::Instant::now();
            let ev = Event::typed(payload);
            out.reparse_ns += u64::try_from(t.elapsed().as_nanos()).unwrap_or(u64::MAX);
            self.events += 1;
            self.last_ts = self.last_ts.max(ev.ts());
            self.observe_attributed(&ev, false, &mut out);
            let mut i = 0;
            while i < self.derived.len() {
                let d = self.derived[i].clone();
                i += 1;
                self.observe_attributed(&d, false, &mut out);
            }
            self.derived.clear();
        });
        out
    }

    /// `observe`, with the stopwatches — see [`Fold::fold_bytes_attributed`].
    fn observe_attributed(&mut self, ev: &Event, live: bool, out: &mut FoldAttribution) {
        self.registry
            .dispatch_timed(ev, live, &mut self.derived, &mut |i, ns| {
                out.module_ns[i] += ns;
            });
        if let Some(c) = &mut self.combat {
            let t = std::time::Instant::now();
            c.on_event(ev, live, self.registry.roster());
            out.combat_ns += u64::try_from(t.elapsed().as_nanos()).unwrap_or(u64::MAX);
        }
        let t = std::time::Instant::now();
        if let Some(d) = self.epoch.observe(ev) {
            self.derived.push(d);
        }
        if let Some(d) = self.sessions.observe(ev) {
            self.derived.push(d);
        }
        out.detectors_ns += u64::try_from(t.elapsed().as_nanos()).unwrap_or(u64::MAX);
    }
}
