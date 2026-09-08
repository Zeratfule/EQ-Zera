//! Every coin the log said reached you, as a row per sentence — and NO TOTAL ANYWHERE.
//!
//! THE LADDER IS NOT IN THE LOG (`shared/acquireEvents.ts`'s law, applied on this side of the
//! wire). EverQuest's platinum/gold/silver/copper conversion appears in no line the client prints,
//! so a `total` field here would be a number this repo cannot source (law 1). A consumer that wants
//! platinum-per-hour declares the rate itself, in the open, where a reader can see it — this module
//! states only which denominations which sentence named.
//!
//! THREE SOURCES, ONE ROW SHAPE:
//!   `corpse`  `You receive 5 gold, 5 silver and 8 copper from the corpse.` — coin loot. The line
//!             names no mob, so neither does the row.
//!   `vendor`  `You receive 9 gold 9 silver 4 copper from Klok Sasz for the Ringmail Neckguard(s).`
//!             — you sold something at a merchant. Carries `npc` and `item`.
//!   `sold`    `You looted <item> from <mob>'s corpse and sold it for 125 platinum.` — the AUTO
//!             vendor. It is a `loot` event with disposition `sold`, not a `coin` event, and its
//!             price was discarded by the parser until this module needed it. It is by far the
//!             largest coin stream in a farming session, which is the whole reason plat/hour was
//!             unanswerable before.
//!
//! `item` and `unstated` coin events are DELIBERATELY NOT ROWS. A destroy payout is a refund on
//! something you already had, and an unstated receipt says nothing about where it came from; both
//! would sit in an income rate claiming to be income. They stay in the event stream for whoever
//! wants them.
//!
//! UNCAPPED, like `loot`, and for the same reason: a rate is computed over the whole run, so
//! dropping the oldest rows would silently move the answer.

use crate::event::Event;
use crate::EqModule;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The published shape's version.
const SHAPE_VERSION: i64 = 1;

/// One coin sentence. Every optional field is omitted when the line did not say it, never written
/// as null or as zero — `{silver: 4}` and `{platinum: 0, silver: 4}` are different claims.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CoinRow {
    ts: i64,
    /// `corpse` | `vendor` | `sold`. See the header.
    #[serde(deserialize_with = "crate::checkpoint::interned")]
    source: crate::checkpoint::Static,
    #[serde(skip_serializing_if = "Option::is_none")]
    platinum: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gold: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    silver: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    copper: Option<i64>,
    /// What was sold — the vendor line's item, or the auto-sold loot.
    #[serde(skip_serializing_if = "Option::is_none")]
    item: Option<String>,
    /// Who paid, on the vendor form.
    #[serde(skip_serializing_if = "Option::is_none")]
    npc: Option<String>,
    /// The zone the module was standing in, `loot.rs`'s stamp. Absent for rows folded before the
    /// scan reached a zone line.
    #[serde(skip_serializing_if = "Option::is_none")]
    zone: Option<String>,
}

impl CoinRow {
    /// Put one `(denomination, amount)` pair in its own field. A denomination this build does not
    /// know is dropped rather than summed into a neighbour.
    fn put(&mut self, denom: &str, amount: i64) {
        match denom {
            "platinum" => self.platinum = Some(amount),
            "gold" => self.gold = Some(amount),
            "silver" => self.silver = Some(amount),
            "copper" => self.copper = Some(amount),
            _ => {}
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
pub struct CoinModule {
    rows: Vec<CoinRow>,
    /// The label the NEXT row will carry — module bookkeeping, not published state.
    zone: Option<String>,
    seq: i64,
    /// The announce cursor — see [`crate::announce`].
    announce: crate::announce::Announce,
}

impl CoinModule {
    pub fn new() -> Self {
        Self::default()
    }

    /// The shared row build: the coin pairs the event carried, then whatever the sentence named
    /// beside them.
    fn push(
        &mut self,
        ev: &Event,
        source: &'static str,
        item: Option<String>,
        npc: Option<String>,
    ) {
        let Some(coins) = ev.coins("coins") else {
            return;
        };
        let mut row = CoinRow {
            ts: ev.ts(),
            source,
            item,
            npc,
            zone: self.zone.clone(),
            ..CoinRow::default()
        };
        for (denom, amount) in coins {
            row.put(denom, amount);
        }
        self.rows.push(row);
        self.announce.changed(self.seq);
    }
}

impl EqModule for CoinModule {
    fn checkpoint(&self) -> Option<Vec<u8>> {
        serde_json::to_vec(self).ok()
    }

    fn restore(&mut self, bytes: &[u8]) -> bool {
        let Some(fresh) = crate::checkpoint::parse::<Self>(bytes) else {
            return false;
        };
        *self = fresh;
        true
    }

    fn id(&self) -> &'static str {
        "coin"
    }

    fn reset(&mut self) {
        self.rows.clear();
        self.zone = None;
        self.seq = 0;
        self.announce.reset();
    }

    fn on_event(&mut self, ev: &Event, _live: bool) {
        self.seq = ev.seq();
        match ev.kind() {
            // Character rebirth: income before the boundary belonged to a dead character. `zone` is
            // world state and is kept, exactly as `loot` keeps it.
            "epoch" => {
                if !self.rows.is_empty() {
                    self.rows.clear();
                    self.announce.changed(self.seq);
                }
            }
            "zone" => self.zone = ev.str("zone").map(str::to_string),
            "coin" => match ev.str("source") {
                Some("corpse") => self.push(ev, "corpse", None, None),
                Some("vendor") => {
                    let item = ev.str("item").map(str::to_string);
                    let npc = ev.str("npc").map(str::to_string);
                    self.push(ev, "vendor", item, npc);
                }
                // `item` and `unstated` are not income. See the header.
                _ => {}
            },
            // The auto-vendor: a loot line that stated its own price.
            "loot" if ev.str("disposition") == Some("sold") => {
                let item = ev.str("item").map(str::to_string);
                self.push(ev, "sold", item, None);
            }
            _ => {}
        }
    }

    fn published_seq(&self) -> Option<i64> {
        Some(self.announce.cursor())
    }

    fn snapshot(&self) -> Value {
        json!({
            "seq": self.seq,
            "state": { "v": SHAPE_VERSION, "rows": self.rows },
        })
    }
}
