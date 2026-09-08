//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// The spec for re-projecting a row that is already live: everything the instance IS, carried
/// forward from the row being replaced, with only the coordinates a re-projection restates supplied
/// by the caller.
///
/// It exists because the store re-projects from two places that must not drift — `restat` (the hold
/// group moved) and `add_sample` (a fresh duration changed what every live instance of that line
/// counts down from). Hand-copying the fields in both is how a row ends up saying different things
/// depending on which internal event last touched it.
pub(super) fn reproject_spec(
    a: &ActiveBuff,
    key: &str,
    entity_key: &str,
    started_ts: i64,
    caster: &str,
    count: i64,
) -> ActiveSpec {
    ActiveSpec {
        spell: a.spell.clone(),
        cast_name: a.cast_name.clone(),
        key: key.to_string(),
        entity_key: entity_key.to_string(),
        started_ts,
        disp_override: a.disposition,
        caster: Some(caster.to_string()),
        count: Some(count),
        candidates: a.candidates.clone(),
        message_driven: a.message_driven == Some(true),
        permanent: a.permanent == Some(true),
    }
}
