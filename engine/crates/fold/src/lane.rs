//! THE COMBAT LANE: the combat engine folding on a thread of its own (Z Engine, 2026-09-07).
//!
//! Measured on the owner's 142 MB log, the combat engine is 59% of the module fold and the other
//! nineteen modules are the rest, and the two ran in turn. Here the fold thread delivers every event
//! the bus observes - primaries and derived alike, in bus order - to a second thread that folds the
//! engine, and the wall clock becomes the slower of the two rather than their sum.
//!
//! WHAT THE ENGINE READS, AND WHY IT STAYS EXACT. The engine reads exactly one thing outside its
//! own state: the roster module, as folded up to and including the event being delivered
//! (`Fold::observe` hands it `registry.roster()` after the modules have taken the line). The roster
//! is a pure function of the events and of the `roster` defines, and it emits nothing and never
//! ticks, so this lane folds a second `RosterModule` beside the engine over the same stream and the
//! same defines, in the same order. The engine therefore sees, on every event, the roster state it
//! would have seen inline. `tests/lane_parity.rs` proves it: every fixture, and the owner's whole
//! log when `ZENGINE_LANE_LOG` names one, folds to byte-identical combat snapshots both ways.
//!
//! WHERE THE FOLD THREAD WAITS. Never per event: events are buffered and sent in batches, and the
//! lane runs behind by at most `IN_FLIGHT` batches. The fold thread waits only when something
//! needs the engine's state (a snapshot, a fight search, a session mark, a define the roster must
//! see in order) - `sync` drains the lane, then the state is read under the mutex while the lane
//! is parked. Those are slice-boundary acts, a handful per scan, and once per poll in the tail.
//!
//! ONE THREAD, NAMED, at the process's own priority. It ends when the lane is dropped.

use std::cell::RefCell;
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;

use serde_json::Value;

use crate::combat::{CombatEngine, RosterSource};
use crate::event::Event;
use crate::modules::roster::RosterModule;
use crate::EqModule;

/// Events buffered on the fold thread before a batch is sent.
const BATCH: usize = 2_048;
/// Batches the lane may run behind by before the fold thread waits on it.
const IN_FLIGHT: usize = 8;

/// What the lane owns: the engine and its private roster.
pub struct LaneState {
    pub engine: CombatEngine,
    pub roster: RosterModule,
}

enum Msg {
    Fold(Vec<(Event<'static>, bool)>),
    Define(Value),
    Reset,
    SetLive,
    Mark(i64, SyncSender<bool>),
    Sync(SyncSender<()>),
    Restore(Vec<u8>, Option<Vec<u8>>, SyncSender<bool>),
}

pub struct CombatLane {
    tx: SyncSender<Msg>,
    state: Arc<Mutex<LaneState>>,
    buf: RefCell<Vec<(Event<'static>, bool)>>,
}

impl CombatLane {
    /// Start the lane around an engine and the roster it will read. The engine is expected reset
    /// and named already, exactly as `Fold::with_combat` expects it.
    pub fn start(engine: CombatEngine, roster: RosterModule) -> Self {
        let state = Arc::new(Mutex::new(LaneState { engine, roster }));
        let (tx, rx) = sync_channel::<Msg>(IN_FLIGHT);
        let worker = Arc::clone(&state);
        // A thread that could not be started would leave every send failing; the engine would then
        // fold nothing, which the parity test would catch on the first fixture. Stated rather than
        // unwrapped: the fold crate has no diagnostic channel of its own.
        let _handle = thread::Builder::new()
            .name("zengine-combat".to_owned())
            .spawn(move || run(&worker, &rx));
        Self {
            tx,
            state,
            buf: RefCell::new(Vec::with_capacity(BATCH)),
        }
    }

    /// One event on the bus, as `Fold::observe` saw it. Buffered; sent when the batch is full.
    pub fn push(&self, ev: &Event<'_>, live: bool) {
        let mut buf = self.buf.borrow_mut();
        buf.push((ev.to_static(), live));
        if buf.len() >= BATCH {
            let batch = std::mem::replace(&mut *buf, Vec::with_capacity(BATCH));
            drop(buf);
            self.send(Msg::Fold(batch));
        }
    }

    fn flush(&self) {
        let batch = std::mem::take(&mut *self.buf.borrow_mut());
        if !batch.is_empty() {
            self.send(Msg::Fold(batch));
        }
    }

    fn send(&self, msg: Msg) {
        // A closed lane (its thread gone) drops the message: nothing else can be done from here,
        // and the reader's `with` will then serve whatever the engine last was.
        let _dropped = self.tx.send(msg);
    }

    /// Wait until the lane has folded everything sent so far.
    fn sync(&self) {
        self.flush();
        let (done, ack) = sync_channel::<()>(1);
        self.send(Msg::Sync(done));
        let _gone = ack.recv();
    }

    /// The engine and its roster, caught up to every event delivered so far, for one read (or a
    /// snapshot-time sweep, which is a read that ages). The lane is parked while `f` runs.
    pub fn with<R>(&self, f: impl FnOnce(&mut CombatEngine, &dyn RosterSource) -> R) -> R {
        self.sync();
        let mut guard = self.lock();
        let LaneState { engine, roster } = &mut *guard;
        f(engine, roster)
    }

    fn lock(&self) -> MutexGuard<'_, LaneState> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// A `roster` define, delivered in order with the events around it.
    pub fn define_roster(&self, payload: &Value) {
        self.flush();
        self.send(Msg::Define(payload.clone()));
    }

    pub fn reset(&self) {
        self.flush();
        self.send(Msg::Reset);
    }

    pub fn set_live(&self) {
        self.flush();
        self.send(Msg::SetLive);
    }

    /// Put a checkpoint's engine bytes (and the roster module's, for the lane's own roster) onto
    /// the lane, in order with everything sent before. `false` when either half refuses.
    pub fn restore(&self, engine: &[u8], roster: Option<&[u8]>) -> bool {
        self.flush();
        let (reply, answer) = sync_channel::<bool>(1);
        self.send(Msg::Restore(engine.to_vec(), roster.map(<[u8]>::to_vec), reply));
        answer.recv().unwrap_or(false)
    }

    /// `CombatEngine::session_mark`, answered by the lane after everything before it was folded.
    pub fn session_mark(&self, at: i64) -> bool {
        self.flush();
        let (reply, answer) = sync_channel::<bool>(1);
        self.send(Msg::Mark(at, reply));
        answer.recv().unwrap_or(false)
    }
}

/// The lane thread: every message in order, the state locked only for the length of one message.
fn run(state: &Mutex<LaneState>, rx: &Receiver<Msg>) {
    while let Ok(msg) = rx.recv() {
        let mut guard = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let LaneState { engine, roster } = &mut *guard;
        match msg {
            Msg::Fold(batch) => {
                for (ev, live) in &batch {
                    // The roster first, then the engine reads it - the order `Fold::observe` keeps
                    // (the modules take the line before the engine does).
                    roster.on_event(ev, *live);
                    engine.on_event(ev, *live, Some(roster));
                }
            }
            Msg::Define(payload) => {
                if let Some(d) = roster.as_defines() {
                    d.define(&payload);
                }
            }
            Msg::Reset => {
                roster.reset();
                engine.reset();
            }
            Msg::SetLive => engine.set_live(),
            Msg::Mark(at, reply) => {
                let _dropped = reply.send(engine.session_mark(at));
            }
            Msg::Sync(done) => {
                let _dropped = done.send(());
            }
            Msg::Restore(bytes, roster_bytes, reply) => {
                let roster_ok = roster_bytes.is_none_or(|b| roster.restore(&b));
                let _dropped = reply.send(roster_ok && engine.restore(&bytes));
            }
        }
    }
}
