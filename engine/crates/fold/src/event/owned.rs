//! THE OWNED EVENT: the constructors that borrow nothing. A derived event is built from JSON
//! (`from_json` / `from_value`); a primary one is copied off the parser's buffers with
//! `to_static` so it can cross to the combat lane (Z Engine, 2026-09-07). Split from `event.rs`
//! so that file stays at its factoring line; the readers stay there, unchanged.

use super::{Body, Event, Kind};
use serde_json::Value;
use std::borrow::Cow;

impl Event<'static> {
    /// Parse one NDJSON line from `eqlog::scan`. `None` when the line is not a JSON object, which
    /// the scanner cannot produce and which therefore only a corrupt input can reach.
    ///
    /// Not on the production path: it serves the modes that genuinely start from NDJSON text — the
    /// golden-driven view tests, the module-snapshot harness, and this crate's unit tests.
    #[must_use]
    pub fn from_json(line: &str) -> Option<Event<'static>> {
        let v: Value = serde_json::from_str(line).ok()?;
        v.is_object().then(|| Event::from_value(v))
    }

    /// Wrap a value the fold built itself — `epoch`, `offlineGap`, `buffExpired`, and the
    /// early-warning break probes.
    #[must_use]
    pub fn from_value(v: Value) -> Event<'static> {
        let kind = Kind::parse(v.get("kind").and_then(Value::as_str).unwrap_or(""));
        Event {
            kind,
            body: Body::Json(v),
        }
    }
}

/// A JSON-bodied event serializes as its value and reads back through `from_value` - the shape
/// every derived event and every early-warning probe has. A typed body (the parser's) refuses:
/// nothing in a fold's state holds one at a boundary, and a checkpoint that met one would be wrong
/// to guess at its JSON, so it fails to serialize and the checkpoint is not taken.
impl serde::Serialize for Event<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match &self.body {
            Body::Json(v) => v.serialize(s),
            Body::Typed(_) => Err(serde::ser::Error::custom(
                "a parser-typed event cannot be checkpointed",
            )),
        }
    }
}

impl<'de> serde::Deserialize<'de> for Event<'static> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(Event::from_value(Value::deserialize(d)?))
    }
}

impl Event<'_> {
    /// This event, owning its payload, so it can outlive the parser's buffers and cross a thread.
    /// A derived (JSON-bodied) event owns nothing borrowed and is simply cloned.
    #[must_use]
    pub fn to_static(&self) -> Event<'static> {
        Event {
            kind: self.kind,
            body: match &self.body {
                Body::Typed(p) => Body::Typed(Cow::Owned(p.clone().into_owned())),
                Body::Json(v) => Body::Json(v.clone()),
            },
        }
    }
}
