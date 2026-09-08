//! THE HISTORICAL SCAN AS A TWO-STAGE PIPELINE (Z Engine, 2026-09-06).
//!
//! Measured on the owner's 142 MB log: parsing is 28% of a fold and the modules are 70%, and the
//! two ran in turn on one thread. Here a second thread reads and parses the file a megabyte at a
//! time into batches of OWNED events, and the ingest thread - which owns the fold, the sink and
//! every answer at a slice boundary - folds each batch as it arrives. The wall clock becomes the
//! slower stage rather than the sum.
//!
//! WHAT DOES NOT CHANGE. The event sequence is byte-for-byte the one the single-threaded scan
//! produced: the same `TailCore` splits the same chunks into the same lines, the same `Parser`
//! parses them in the same order with the same `seq`, and the fold receives them in that order.
//! The sink never crosses a thread (it is not `Send`, on purpose - see `ingest::EventSink`); only
//! the parser does, and it comes back for the live tail. Determinism is the cache-correctness law
//! of this engine, so the pipeline moves work, never meaning.
//!
//! BOUNDED. At most two batches are in flight, so a fast disk cannot turn a 200 MB log into a
//! 200 MB allocation. One thread, named, at the process's own (below-normal) priority: nothing
//! here pins a core or spawns per module.
//!
//! PREEMPTION. The ingest thread polls the world's ownership at every batch, as before. When it
//! returns early it drops the receiver; the parser's next `send` fails and the thread ends. A read
//! error is delivered as a batch, so `run` sees the same `io::Result` it saw from its own `read`.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::thread::{self, JoinHandle};

use eqlog::event::{Ev, Payload};
use eqlog::parse::Parser;
use eqlog::tail::TailCore;

/// The chunk the parser reads at a time; one batch per chunk. The scan is deliberately impolite -
/// no yield, no throttle, no slice sleep; the process boundary is what keeps it off the UI. A
/// buffer, not a promise: `Read::read` may hand back less. It is also the granularity at which the
/// fold polls the generation and may announce progress - big enough to amortize a read, small
/// enough that a preempted fold abandons within milliseconds.
const READ_BYTES: usize = 1 << 20;
/// Batches the parser may run ahead by before it waits for the fold.
const IN_FLIGHT: usize = 2;

/// One parsed event, owned so it can cross to the fold thread. The two halves are exactly the ones
/// `Ev::done` hands out, copied once.
pub struct Owned {
    pub json: String,
    pub payload: Payload,
    pub seq: i64,
}

/// One chunk's worth of events, with the line core's coordinates at the chunk's end.
pub struct Batch {
    pub events: Vec<Owned>,
    /// `TailCore::checkpoint_offset` after this chunk: the end of the last complete line.
    pub checkpoint: u64,
    /// The `seq` the next event will carry.
    pub next_seq: i64,
}

/// What the parser thread hands back when the file is exhausted: everything the tail needs.
pub struct ScanEnd {
    pub parser: Parser,
    pub core: TailCore,
    pub seq: i64,
}

pub struct ScanPipeline {
    rx: Receiver<io::Result<Batch>>,
    handle: JoinHandle<ScanEnd>,
}

impl ScanPipeline {
    /// Start parsing `file` at byte `offset` (a line boundary - a checkpoint's mark, or zero) on
    /// a helper thread, numbering the first event `first_seq`.
    pub fn start_at(parser: Parser, mut file: File, offset: u64, first_seq: i64) -> io::Result<Self> {
        file.seek(SeekFrom::Start(offset))?;
        let (tx, rx) = sync_channel::<io::Result<Batch>>(IN_FLIGHT);
        let handle = thread::Builder::new()
            .name("zengine-parse".to_owned())
            .spawn(move || parse_all(parser, file, offset, first_seq, &tx))?;
        Ok(Self { rx, handle })
    }

    /// The next batch, in order; `None` once the file is exhausted (or the parser thread is gone).
    pub fn next(&self) -> Option<io::Result<Batch>> {
        self.rx.recv().ok()
    }

    /// Take the parser, the line core and the sequence back for the live tail. Call only after
    /// `next` answered `None`; a parser thread that ended by panic is reported as an error.
    pub fn finish(self) -> io::Result<ScanEnd> {
        drop(self.rx);
        self.handle
            .join()
            .map_err(|_| io::Error::other("the parse thread panicked"))
    }
}

/// The parser thread's whole life: chunks in, batches out, until EOF or the fold stops listening.
fn parse_all(
    parser: Parser,
    mut file: File,
    offset: u64,
    first_seq: i64,
    tx: &SyncSender<io::Result<Batch>>,
) -> ScanEnd {
    let mut core = TailCore::at(offset);
    let mut ev = Ev::new();
    let mut seq: i64 = first_seq;
    let mut buf = vec![0u8; READ_BYTES];
    loop {
        let got = match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _dropped = tx.send(Err(e));
                break;
            }
        };
        let mut events = Vec::new();
        core.consume(&buf[..got], |line| {
            if parser.parse_event(line, seq, &mut ev) {
                let (json, payload) = ev.done();
                events.push(Owned {
                    json: json.to_owned(),
                    payload: payload.clone(),
                    seq,
                });
                seq += 1;
            }
        });
        let batch = Batch {
            events,
            checkpoint: core.checkpoint_offset(),
            next_seq: seq,
        };
        // A failed send means the fold has gone (preempted, or ended): nothing left to parse for.
        if tx.send(Ok(batch)).is_err() {
            break;
        }
    }
    ScanEnd { parser, core, seq }
}
