//! THE FOLD CHECKPOINT ON DISK (Z Engine, 2026-09-07): the engine's warm start.
//!
//! At the fold's landing - before the first beat, while the fold is still a pure function of the
//! bytes - the whole fold (`fold::checkpoint`) is written under the app's state directory, keyed
//! by everything it is a function of. At the next attach, a checkpoint whose key matches is put
//! onto the fresh fold and the scan starts at its byte offset instead of at zero. Nothing about
//! the fold's ANSWERS changes: `fold/tests/checkpoint_parity.rs` holds restore-and-continue to
//! byte-identity with a whole fold, and this file only decides WHEN a checkpoint may be used.
//!
//! THE KEY, every part of which must match or the fold is cold (`docs/plans/data-server.md`'s
//! rulings: invalidate by version, never patch):
//!   * the engine build (this binary's size and mtime, its crate version, the protocol version,
//!     the checkpoint format),
//!   * the inputs the fold is a function of besides the log: every held define, the persisted
//!     seeds (the resist ledger and the message overlay files), the client's spell table's size
//!     and mtime, the resolved clock zone and the character,
//!   * the log itself: its path, and a hash of every byte up to the checkpoint's offset - a
//!     rolled, truncated or replaced log cannot match.
//!
//! THE FILE is one JSON header line followed by the parts' raw bytes, written temp + fsync +
//! rename like every other state file (`state.rs`). A checkpoint is rewritten at a landing only
//! when the log grew by `REWRITE_AFTER_BYTES` since the last one, so a quick relaunch does not pay
//! the serialization twice for nothing.
//!
//! Absent a state directory (every non-app client) nothing is read or written.

use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use fold::checkpoint::{FoldCheckpoint, ModulePart, FORMAT};
use serde::{Deserialize, Serialize};

use crate::ingest::EventSink;
use crate::spawn::DIAGNOSTIC_PREFIX;

/// A landing rewrites the checkpoint only when this many bytes were folded past the last one.
const REWRITE_AFTER_BYTES: u64 = 4 << 20;
const DIR: &str = "checkpoints";
const HASH_CHUNK: usize = 1 << 20;

/// What the checkpoint's key is computed from.
pub struct Ctx {
    pub log: PathBuf,
    pub state_dir: Option<PathBuf>,
    pub defines: Vec<(String, serde_json::Value)>,
    pub zone: String,
    pub character: Option<String>,
}

impl Ctx {
    /// The key's inputs as `ingest::run` has them at the attach: the log and state directory,
    /// every held define, the resolved zone and the character.
    pub fn for_attach(
        attach: &crate::ingest::Attach,
        world: &crate::world::World,
        zone: &impl std::fmt::Debug,
        character: Option<&str>,
    ) -> Self {
        Ctx {
            log: attach.log.clone(),
            state_dir: attach.state_dir.clone(),
            defines: world.held_defines(),
            zone: format!("{zone:?}"),
            character: character.map(str::to_owned),
        }
    }
}

/// Where a restored fold continues from; the default is byte zero, a cold fold.
#[derive(Debug, Clone, Copy, Default)]
pub struct Resume {
    pub offset: u64,
    pub seq: i64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Key {
    engine: String,
    inputs: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Header {
    format: u32,
    key: Key,
    offset: u64,
    prefix: String,
    events: u64,
    last_ts: i64,
    epoch_fired: bool,
    session: (i64, i64),
    parts: Vec<(String, usize)>,
    combat: Option<usize>,
}

fn hex(h: u64) -> String {
    format!("{h:016x}")
}

fn engine_identity() -> String {
    let mut h = std::hash::DefaultHasher::new();
    env!("CARGO_PKG_VERSION").hash(&mut h);
    protocol::generated::PROTOCOL_VERSION.hash(&mut h);
    FORMAT.hash(&mut h);
    if let Ok(exe) = std::env::current_exe() {
        if let Ok(meta) = fs::metadata(&exe) {
            meta.len().hash(&mut h);
            if let Ok(m) = meta.modified() {
                m.hash(&mut h);
            }
        }
    }
    hex(h.finish())
}

fn file_stamp(path: &Path, h: &mut std::hash::DefaultHasher) {
    match fs::metadata(path) {
        Ok(meta) => {
            meta.len().hash(h);
            if let Ok(m) = meta.modified() {
                m.hash(h);
            }
        }
        Err(_) => "absent".hash(h),
    }
}

fn inputs_identity(ctx: &Ctx) -> String {
    let mut h = std::hash::DefaultHasher::new();
    let mut defines: Vec<&(String, serde_json::Value)> = ctx.defines.iter().collect();
    defines.sort_by(|a, b| a.0.cmp(&b.0));
    for (family, payload) in defines {
        family.hash(&mut h);
        payload.to_string().hash(&mut h);
    }
    if let Some(dir) = &ctx.state_dir {
        for seed in [crate::state::RESIST_LEDGER, crate::state::MESSAGE_OVERLAY] {
            match fs::read(dir.join(seed)) {
                Ok(bytes) => bytes.hash(&mut h),
                Err(_) => "absent".hash(&mut h),
            }
        }
    }
    if let Some(root) = ctx.log.parent().and_then(Path::parent) {
        file_stamp(&root.join("spells_us.txt"), &mut h);
    }
    ctx.zone.hash(&mut h);
    ctx.character.hash(&mut h);
    hex(h.finish())
}

/// The hash of the log's first `offset` bytes - the log's identity as of the checkpoint.
fn prefix_hash(log: &Path, offset: u64) -> io::Result<String> {
    let mut file = File::open(log)?;
    let mut h = std::hash::DefaultHasher::new();
    let mut buf = vec![0u8; HASH_CHUNK];
    let mut left = offset;
    while left > 0 {
        let want = usize::try_from(left.min(HASH_CHUNK as u64)).unwrap_or(HASH_CHUNK);
        let got = file.read(&mut buf[..want])?;
        if got == 0 {
            return Err(io::Error::other(
                "the log is shorter than the checkpoint's offset",
            ));
        }
        buf[..got].hash(&mut h);
        left -= got as u64;
    }
    Ok(hex(h.finish()))
}

fn path_for(ctx: &Ctx) -> Option<PathBuf> {
    let dir = ctx.state_dir.as_ref()?;
    let name = ctx.log.file_name()?.to_string_lossy();
    Some(dir.join(DIR).join(format!("{name}.zck")))
}

fn say(what: &str) {
    eprintln!("{DIAGNOSTIC_PREFIX} checkpoint: {what}");
}

/// Put a matching checkpoint onto the sink and say where the scan continues from; `Resume`'s
/// default (byte zero) when there is none, it does not match, or it cannot be read.
pub fn try_restore(sink: &mut dyn EventSink, ctx: &Ctx) -> Resume {
    let Some(path) = path_for(ctx) else {
        return Resume::default();
    };
    match read_and_restore(sink, ctx, &path) {
        Ok(resume) => {
            say(&format!(
                "restored from {} at byte {} ({} events); the scan continues from there",
                path.display(),
                resume.offset,
                resume.seq
            ));
            resume
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Resume::default(),
        Err(e) => {
            say(&format!("{} not used ({e}); a cold fold", path.display()));
            Resume::default()
        }
    }
}

fn read_and_restore(sink: &mut dyn EventSink, ctx: &Ctx, path: &Path) -> io::Result<Resume> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let header: Header = serde_json::from_str(line.trim_end())
        .map_err(|e| io::Error::other(format!("unreadable header: {e}")))?;
    if header.format != FORMAT {
        return Err(io::Error::other(format!(
            "format {} where this build reads {FORMAT}",
            header.format
        )));
    }
    let key = Key {
        engine: engine_identity(),
        inputs: inputs_identity(ctx),
    };
    if header.key != key {
        return Err(io::Error::other(
            "the engine build or the fold's inputs changed",
        ));
    }
    if prefix_hash(&ctx.log, header.offset)? != header.prefix {
        return Err(io::Error::other(
            "the log's bytes before the checkpoint changed",
        ));
    }
    let mut modules = Vec::with_capacity(header.parts.len());
    for (id, len) in &header.parts {
        let mut bytes = vec![0u8; *len];
        reader.read_exact(&mut bytes)?;
        modules.push(ModulePart {
            id: id.clone(),
            bytes,
        });
    }
    let combat = match header.combat {
        Some(len) => {
            let mut bytes = vec![0u8; len];
            reader.read_exact(&mut bytes)?;
            Some(bytes)
        }
        None => None,
    };
    let ck = FoldCheckpoint {
        format: header.format,
        modules,
        combat,
        epoch_fired: header.epoch_fired,
        session: header.session,
        events: header.events,
        last_ts: header.last_ts,
    };
    sink.restore(&ck).map_err(io::Error::other)?;
    Ok(Resume {
        offset: header.offset,
        seq: i64::try_from(header.events).unwrap_or(i64::MAX),
    })
}

/// Write the fold at `offset` - the landing's mark - unless a recent enough checkpoint stands.
/// Failures are said and swallowed: a checkpoint is a convenience, never the truth.
pub fn save(sink: &dyn EventSink, ctx: &Ctx, offset: u64, resumed_from: u64) {
    let Some(path) = path_for(ctx) else {
        return;
    };
    if offset < resumed_from.saturating_add(REWRITE_AFTER_BYTES) && resumed_from > 0 {
        return;
    }
    let started = std::time::Instant::now();
    let Some(ck) = sink.checkpoint() else {
        say("not taken: the fold cannot checkpoint at this landing");
        return;
    };
    match write(ctx, &path, offset, &ck) {
        Ok(bytes) => say(&format!(
            "written to {} ({} MB, {} ms) at byte {offset}",
            path.display(),
            bytes >> 20,
            started.elapsed().as_millis()
        )),
        Err(e) => say(&format!("{} could not be written ({e})", path.display())),
    }
}

fn write(ctx: &Ctx, path: &Path, offset: u64, ck: &FoldCheckpoint) -> io::Result<u64> {
    let header = Header {
        format: ck.format,
        key: Key {
            engine: engine_identity(),
            inputs: inputs_identity(ctx),
        },
        offset,
        prefix: prefix_hash(&ctx.log, offset)?,
        events: ck.events,
        last_ts: ck.last_ts,
        epoch_fired: ck.epoch_fired,
        session: ck.session,
        parts: ck
            .modules
            .iter()
            .map(|p| (p.id.clone(), p.bytes.len()))
            .collect(),
        combat: ck.combat.as_ref().map(Vec::len),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("zck.tmp");
    let written = (|| -> io::Result<u64> {
        let mut file = File::create(&tmp)?;
        let mut total = 0u64;
        let head = serde_json::to_string(&header).map_err(io::Error::other)?;
        file.write_all(head.as_bytes())?;
        file.write_all(b"\n")?;
        total += head.len() as u64 + 1;
        for p in &ck.modules {
            file.write_all(&p.bytes)?;
            total += p.bytes.len() as u64;
        }
        if let Some(c) = &ck.combat {
            file.write_all(c)?;
            total += c.len() as u64;
        }
        file.sync_all()?;
        Ok(total)
    })();
    match written {
        Ok(total) => {
            fs::rename(&tmp, path)?;
            Ok(total)
        }
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}
