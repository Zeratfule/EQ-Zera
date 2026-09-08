//! THE TWO DAMAGE ROUTERS, lifted out of `routing.rs` unchanged in behaviour so the Z Engine's phase
//! timers (`ingest::damage::prof`, a no-op without `--features profile`) can say where a landed hit's
//! cost goes: source, resolve, aggregate, engage, timeline, log.

use super::*;
use crate::combat::ingest::damage::prof;

/// A hostile (or the pet) hit YOU. Resolve the attacker to an instance so twins are distinct in the
/// incoming list.
pub(super) fn route_incoming_damage(st: &mut EngineState, ev: &DamageEvent<'_>) {
    let _span = prof::span(prof::INC);
    let att = st.resolve(ev.attacker, ev.ts, false);
    let (id, name) = (att.instance_id.clone(), att.label.clone());
    both(st, ev.ts, false, |agg| agg.add_inc(&id, &name, ev));
    engage_hostile(st, &att, ev.ts);
    // An incoming instant lanes under the attacker's skill, so it gets its own row.
    if let Some(enc) = st.current.as_mut() {
        EngineState::push_timeline(
            enc,
            TimelineRaw {
                ts: ev.ts,
                lane: ev.skill.to_string(),
                category: ev.category.to_string(),
                amount: ev.amount,
                crit: ev.crit,
                modifiers: own_mods(ev.modifiers),
                kind: "enemy",
                outcome: None,
                detail: None,
                target: None,
            },
        );
    }
    st.log(
        ev.ts,
        ev.dtype,
        "enemy",
        format!(
            "{name} → You  {}{}  {}",
            ev.amount,
            if ev.crit { "*" } else { "" },
            ev.skill
        ),
    );
}

/// You, your pet or a group member landed a hit.
pub(super) fn route_outgoing_damage(st: &mut EngineState, ev: &DamageEvent<'_>, at: &Attribution) {
    let source = prof::span(prof::OUT_SOURCE);
    let src = out_source(st, ev.attacker, at.out_kind(), ev.ts);
    drop(source);
    let mut ambiguous = false;
    if let Attribution::OutPet {
        pet_key,
        ambiguous: amb,
        ..
    } = at
    {
        ambiguous = *amb;
        // The pet is trading blows with its target — record that engagement for death case (b).
        st.world
            .note_pet_engagement(ev.attacker, &id_key_ref(ev.target));
        // A pet LANDING a hit is pet-shaped evidence (see the miss and resist twins).
        st.charm.note_pet_evidence(pet_key);
    }
    // A member's hit records no pet engagement and no charm evidence: a member is not a pet. The one
    // thing it does beyond its own row is engage its TARGET, because the mob your group-mate is
    // fighting is the mob you are fighting.

    // The game states the damage type on every typed spell line ("… for 53 points of POISON damage
    // by Asp Venom Strike."), so a poison lane is a fact the log printed, not a name-matched guess.
    // Outgoing only, and additive — a second index over damage already counted, so no total moves.
    if ev.dclass == Some("poison") {
        // The ledger is about the venom, not the meter row: a cast-less firing's meter lane carries
        // the origin marker and this counter must not inherit it.
        let venom = base_lane_name(&ev.skill).to_string();
        both(st, ev.ts, false, |agg| {
            agg.procs.add_poison_damage(&venom, ev.amount)
        });
    }
    // Resolve the target to an instance. For a same-name ambiguous pet hit the target is the hostile
    // twin (`prefer_charmed = false` picks it).
    let resolve = prof::span(prof::OUT_RESOLVE);
    let tgt = st.resolve(ev.target, ev.ts, false);
    let (tid, tname) = (tgt.instance_id.clone(), tgt.label.clone());
    drop(resolve);
    let agg_span = prof::span(prof::OUT_AGG);
    both(st, ev.ts, false, |agg| {
        agg.add_out(&src, ev, ambiguous);
        agg.bump_target(&tid, &tname, ev.amount);
    });
    drop(agg_span);
    let engage = prof::span(prof::OUT_ENGAGE);
    engage_hostile(st, &tgt, ev.ts);
    drop(engage);
    let timeline = prof::span(prof::OUT_TIMELINE);
    // The live fight is named after whatever you are presently swinging at; finalize switches to the
    // largest target.
    if let Some(enc) = st.current.as_mut() {
        enc.last_out_target = Some(tname.clone());
        // An outgoing instant lanes under the skill/spell name, and `target` carries the
        // instance-resolved defender label — the same value `bump_target` aggregates under, so the
        // per-mob breakdown can answer "what did I land on THIS mob".
        EngineState::push_timeline(
            enc,
            TimelineRaw {
                ts: ev.ts,
                lane: ev.skill.to_string(),
                category: ev.category.to_string(),
                amount: ev.amount,
                crit: ev.crit,
                modifiers: own_mods(ev.modifiers),
                kind: src.kind.as_str(),
                outcome: None,
                detail: None,
                target: Some(tname.clone()),
            },
        );
    }
    drop(timeline);
    let _log = prof::span(prof::OUT_LOG);
    // The ambiguous mark `~` replaces the crit star rather than joining it: "could not attribute
    // cleanly" outranks "it crit".
    let cat = if ambiguous { "ambiguous" } else { ev.dtype };
    let mark = if ambiguous {
        "~"
    } else if ev.crit {
        "*"
    } else {
        ""
    };
    st.log(
        ev.ts,
        cat,
        src.kind.as_str(),
        format!("{} → {tname}  {}{mark}  {}", src.name, ev.amount, ev.skill),
    );
}
