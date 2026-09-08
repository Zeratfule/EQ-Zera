//! Lifted out of the parent file unchanged (Z Engine, 2026-09-07) so it stays at its factoring line.

use super::*;

/// Un-conjugate: longest suffix rule first, each confirmed against the base set.
pub fn melee_verb_base(verb: &str) -> String {
    let v = verb.to_lowercase();
    if v.starts_with("frenz") {
        return "frenzy".to_string();
    }
    if v.starts_with("flurr") {
        return "flurry".to_string();
    }
    if MELEE_VERB_BASES.contains(&v.as_str()) {
        return v;
    }
    if let Some(stem) = v.strip_suffix("es") {
        if MELEE_VERB_BASES.contains(&stem) {
            return stem.to_string();
        }
    }
    if let Some(stem) = v.strip_suffix('s') {
        if MELEE_VERB_BASES.contains(&stem) {
            return stem.to_string();
        }
    }
    v
}

/// A named class skill gets its own lane; a weapon-in-a-hand verb shares one.
pub fn melee_skill(verb: &str) -> &'static str {
    let v = verb.to_lowercase();
    if v.starts_with("backstab") {
        return "Backstab";
    }
    if v.starts_with("bash") {
        return "Bash";
    }
    if v.starts_with("kick") {
        return "Kick";
    }
    if v.starts_with("cleav") {
        return "Cleave";
    }
    if v.starts_with("smite") {
        return "Smite";
    }
    if v.starts_with("shoot") {
        return "Ranged";
    }
    if v.starts_with("strike") {
        return "Strike";
    }
    if v.starts_with("frenz") {
        return "Frenzy";
    }
    if v.starts_with("flurr") {
        return "Flurry";
    }
    "Melee"
}
