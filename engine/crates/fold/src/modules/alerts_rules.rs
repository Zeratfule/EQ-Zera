//! `src/main/modules/alerts.ts`'s matcher half: whether a line makes a sound, and what the firing
//! it produces says. `alerts_captures.rs` bounds the words; `alerts_early.rs` schedules the ones an
//! offset moves.
//!
//! [`Fire`] is FULLY RESOLVED HERE — the app must be able to make the identical noise from the frame
//! alone, so `sound` is the key the renderer's sound cache is already keyed by rather than a
//! reference the app would have to look a definition back up for. `at` is the LOG's clock, never the
//! host's; the one exception is an early warning, which has no matching event (see
//! [`RuleSet::fire_warning`]).
//!
//! `app` triggers (bossDefeat / questComplete) are renderer-evaluated: they depend on derived boss
//! state that lives in the renderer, so they compile to a condition that never matches.
//!
//! ONE HONEST DIVERGENCE: WHOSE REGEX ENGINE. An alert's `/regex/` spec is user-authored and was
//! written against JavaScript's engine; Rust's has no lookaround and no backreferences, and its `.`
//! excludes one line terminator where JS's excludes four. A pattern this crate cannot compile is
//! handled exactly as the TS handles one V8 cannot — a `where` matcher degrades to literal equality,
//! a `raw` trigger compiles to a pattern that can never match — so the failure mode is one the app
//! already has a rule for. Only the SET of patterns falling into it is bigger on this side.

use crate::event::{Event, Key};
use crate::jsmap::JsMap;
use crate::modules::alerts_captures::{
    harvest_captures, merge_captures, wants_target_token, with_auto_captures, CaptureMap,
};
use crate::modules::alerts_early::{
    break_event_identity, break_probes, break_trigger_kinds, early_warn_subject,
    normalize_early_warn_sec, ArmedFire, BreakKind, BreakWatchers, EarlyWarnArm, EarlyWarnDue,
    EarlyWarnings,
};
use crate::modules::buff_timer_rows::BuffTimerRow;
use eqlog::jsstr::js_trim;
use eqlog::names::{id_key, spell_canon_key};
use regex::{Regex, RegexBuilder};
use serde_json::Value;
use serde::{Deserialize, Serialize};

/// What a def that names no cooldown gets.
const DEFAULT_COOLDOWN_MS: i64 = 2000;

/// Max distinct cooldown clocks at once, across every alert. An alert-level clock is one entry per
/// alert, so the bound exists for `cooldownScope:'target'` alerts, which mint an entry per mob.
/// Eviction is least-recently-FIRED, so the entry discarded is the one closest to having expired.
const COOLDOWN_KEY_CAP: usize = 500;

/// Max fires kept per alert in the recent-fires ring.
const HISTORY_CAP: usize = 20;

/// One alert fired — a `FireMessage`'s payload, built where the alert system's vocabulary is rather
/// than in `zengine`, so the protocol crate never learns what an alert is.
///
/// The last three fields are what it SAYS; the first four are that it HAPPENED. All three are
/// optional and nearly every real firing carries none of them: an alert declaring no capture group,
/// writing no `{target}`, matched on a family that names no spell and carrying no offset sends the
/// identical four fields it always sent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fire {
    /// The `ts` of the event that matched — the LOG's clock.
    pub at: i64,
    /// The alert's label (`AlertDef.name`).
    pub rule: String,
    /// `<packId>/<soundId>` — the key the app plays.
    pub sound: String,
    /// The text that matched: the raw log line.
    pub message: String,
    /// The named groups this rule's OWN matcher took, plus the `{target}` auto token when the def's
    /// phrase asked for one. Already sanitized and capped — see `alerts_captures`.
    pub captures: Option<CaptureMap>,
    /// The spell this firing is about, display form with the rank INTACT, refined to the candidate
    /// that actually satisfied the alert. `None` when the family names none.
    pub spell: Option<String>,
    /// The deadline an early warning was early for — the watched row's stated end. `None` on every
    /// ordinary fire, which warns about nothing.
    pub due_at: Option<i64>,
}

/// Everything one match produced, before any clock has had its say.
///
/// One value because the three answers are one answer: recomputing the captures afterwards would
/// mean running the pattern again and hoping the second run agreed with the first. It also keeps the
/// arming path and the firing path reading from the same value — an early warning speaks the words
/// its ARMING match took.
struct Firing {
    /// The matched text: the raw log line, or a projection sentence for a break probe.
    text: String,
    captures: Option<CaptureMap>,
    spell: Option<String>,
}

/// A condition that matched, and what its named groups captured.
///
/// A struct rather than a bare `Option<CaptureMap>` because "did not match" and "matched, naming
/// nothing" are different answers, and the outer `Option` is the one that means the first.
struct Hit {
    captures: Option<CaptureMap>,
}

/// One fire, as the module's published `history` ring records it.
#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FireRecord {
    ts: i64,
    matched_text: String,
}

/// A compiled matcher value: a literal (compared case-insensitively) or the `/regex/` the spec was
/// written in.
enum Matcher {
    /// Already lowercased, so a compare is one `to_lowercase` on the field and no allocation here.
    Literal(String),
    Pattern(Box<Regex>),
}

/// One compiled `where` entry: the event field it names, its matcher, and the rank-folded key when
/// it is a LITERAL matcher on a key that NAMES A SPELL.
struct Field {
    key: String,
    matcher: Matcher,
    /// Set only for a literal matcher on a spell-naming key, and only when the fold leaves something
    /// to compare. Absent everywhere else, which keeps `caster`, `target` and every `/regex/` spec
    /// exactly what they were.
    line_key: Option<String>,
}

/// A single PRIMITIVE condition, prepared for fast evaluation.
enum Condition {
    Event {
        kind: String,
        fields: Vec<Field>,
    },
    Raw(Box<Regex>),
    /// An `app` primitive: renderer-evaluated, so it never matches here. A variant rather than an
    /// absence, so the reader does not have to infer it.
    Never,
}

/// Composite semantics, evaluated against the SINGLE incoming event.
enum Composite {
    Single,
    Any,
    All,
}

/// One compiled alert.
pub struct Rule {
    id: String,
    name: String,
    sound: String,
    cooldown_ms: i64,
    /// `cooldownScope === 'target'`. Anything else — including a value some other build wrote —
    /// reads as `alert`, which is the safe direction.
    per_target: bool,
    composite: Composite,
    conditions: Vec<Condition>,
    /// The offset in seconds, or `None` for the overwhelming majority of defs, which fire when their
    /// trigger matches.
    early_warn_sec: Option<i64>,
    /// Does this def's spoken phrase write `{target}` — the compile-time gate that keeps a resolved
    /// target off every firing that never asked for one.
    ///
    /// Compiled from the PHRASE, not from the trigger: whether a value is worth carrying is a
    /// question about what the def will say, and a def with no custom phrase wants nothing.
    wants_target: bool,
    /// The break kinds this def watches for, empty unless its trigger IS an ending.
    ///
    /// Computed at compile time because it is a pure function of the trigger, and the trigger cannot
    /// change without a `set_defs` that rebuilds the whole rule. The WATCHER LIST also depends on
    /// `enabled` and on the offset, so that one is rebuilt per tick (`RuleSet::break_watchers`).
    break_kinds: Vec<BreakKind>,
}

/// Which (kind, key) pairs name a spell — the compile-time half of the rank fold. `spell` folds on
/// every kind that has one; `damage.skill` joins it because the typed-nuke and DoT shapes put the
/// spell name there. Whether the fold REACHES a given event is [`fold_reaches`]'s question.
fn folds_rank(kind: &str, key: &str) -> bool {
    key == "spell" || (kind == "damage" && key == "skill")
}

/// Whether the rank fold reaches this event — the runtime half, and it exists for one field.
/// `damage` puts four vocabularies in `skill` and only two are spell names: `spell` (the typed nuke)
/// and `dot` (the tick). `melee` is a closed table of ten constants and `ds` is the damage-shield
/// element, free text off the line — so the gate is written on the DTYPE rather than left to a
/// measurement a new element could invalidate.
fn fold_reaches(field: &Field, ev: &Event) -> bool {
    if field.key != "skill" {
        return true;
    }
    ev.kind() == "damage" && matches!(ev.str("dtype"), Some("spell" | "dot"))
}

/// The spell names one event can honestly answer to — every name in its `candidates` list, string
/// elements and `{name}` objects alike, or empty when it carries none.
///
/// EQ's landing sentences are shared across a whole spell family (`<mob> slows down.` is five
/// different spells), so the parser puts a BEST-EFFORT pick in `spell` and the truth in
/// `candidates`. A `where.spell` matcher tests the whole set, or an enchanter's Shiftless Deeds
/// alert is compared against the string "Forlorn Deeds" and can never fire.
///
/// The union over both shapes lives on the event rather than here, because which shape a def will
/// meet is not a fact this file knows.
fn candidate_names(ev: &Event) -> Vec<String> {
    ev.any_candidate_names(Key::Candidates)
}

/// Compile one matcher spec. A value wrapped in slashes is a case-insensitive regex; anything else
/// is a case-insensitive exact match. An INVALID regex falls back to literal equality so a bad def
/// degrades gracefully instead of matching nothing by accident — see the header's divergence.
fn compile_field(key: &str, spec: &str, kind: &str) -> Field {
    if let Some(body) = pattern_body(spec) {
        if let Ok(re) = build_regex(body) {
            return Field {
                key: key.to_owned(),
                matcher: Matcher::Pattern(Box::new(re)),
                line_key: None,
            };
        }
    }
    let line_key = if folds_rank(kind, key) {
        let folded = spell_canon_key(spec);
        // A spec that is nothing but a roman numeral folds to '' and is left alone rather than
        // turned into a wildcard.
        (!folded.is_empty()).then_some(folded)
    } else {
        None
    };
    Field {
        key: key.to_owned(),
        matcher: Matcher::Literal(spec.to_lowercase()),
        line_key,
    }
}

/// The body of a `/…/` spec, or `None` for a literal.
fn pattern_body(spec: &str) -> Option<&str> {
    (spec.len() >= 2 && spec.starts_with('/') && spec.ends_with('/'))
        .then(|| &spec[1..spec.len() - 1])
}

/// Every alert regex is case-insensitive and carries no `g` flag, so a match is stateless.
fn build_regex(body: &str) -> Result<Regex, regex::Error> {
    RegexBuilder::new(body).case_insensitive(true).build()
}

/// Whether a compiled matcher accepts one piece of text — exact equality or the pattern, plus the
/// RANK FOLD for a literal spell matcher.
///
/// A spell alert fires for ALL RANKS of the spell. EQ Legends re-tiers the classic spells as
/// roman-numeral ranks of one base name and only some of the lines a spell prints carry the suffix,
/// so a def pinned to one spelling would be an alert half the spell's own lines could never satisfy.
/// It WIDENS ONLY, AND ONLY FOR LITERALS: a `/regex/` spec asked a narrower question on purpose.
fn accepts(field: &Field, text: &str, folds: bool) -> bool {
    let hit = match &field.matcher {
        Matcher::Literal(lower) => text.to_lowercase() == *lower,
        Matcher::Pattern(re) => re.is_match(text),
    };
    if hit {
        return true;
    }
    folds
        && field
            .line_key
            .as_ref()
            .is_some_and(|k| spell_canon_key(text) == *k)
}

/// Whether one compiled `where` field accepts `ev`, and what it captured.
///
/// An ABSENT field is an immediate no-match, which is what keeps a `where:{spell:…}` written against
/// a family with no `spell` field from being admitted. The candidate widening applies to the `spell`
/// key and to nothing else, and it captures from the CANDIDATE NAME that satisfied the matcher: the
/// text the pattern matched is the text it named.
///
/// CAPTURES COME FROM THE TEXT THIS MATCHER TESTED AND FROM NOWHERE ELSE — control 3 of the threat
/// model, structural rather than a rule somebody has to remember. The only text reachable here is
/// the value of the one field this `where` entry names, on the one kind the trigger subscribed to.
fn field_matches(ev: &Event, field: &Field) -> Option<Hit> {
    // `field.key` is a string because a def is user-authored: it may name any field, including one
    // no event carries, and that reads as absent — an immediate no-match.
    let text = ev.field_text(field.key.as_str())?;
    let folds = fold_reaches(field, ev);
    if accepts(field, &text, folds) {
        return Some(captures_from(field, &text));
    }
    // Only the `spell` key widens, and only when the event carries candidates.
    if field.key != "spell" {
        return None;
    }
    let hit = candidate_names(ev)
        .into_iter()
        .find(|n| accepts(field, n, folds))?;
    Some(captures_from(field, &hit))
}

/// Run a matcher's own pattern over the text it just accepted, and bound what it named.
///
/// A LITERAL MATCHER CAPTURES NOTHING: it has no pattern, so it declares no names, so there is
/// nothing for a token to resolve to. The rank fold reaches only literals, so a value accepted
/// through the fold takes this branch and names nothing either.
fn captures_from(field: &Field, text: &str) -> Hit {
    let Matcher::Pattern(re) = &field.matcher else {
        return Hit { captures: None };
    };
    let Some(caps) = re.captures(text) else {
        return Hit { captures: None };
    };
    Hit {
        captures: harvest_captures(re, &caps),
    }
}

/// Compile one PRIMITIVE trigger object into a matcher condition.
fn compile_condition(t: &Value) -> Condition {
    match t.get("type").and_then(Value::as_str) {
        Some("event") => {
            let kind = t
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let fields = t
                .get("where")
                .and_then(Value::as_object)
                .map(|w| {
                    w.iter()
                        .filter_map(|(key, spec)| Some(compile_field(key, spec.as_str()?, &kind)))
                        .collect()
                })
                .unwrap_or_default();
            Condition::Event { kind, fields }
        }
        Some("raw") => {
            let body = t.get("regex").and_then(Value::as_str).unwrap_or_default();
            // A bad regex must never match and never throw. `$.^` is the unmatchable pattern the TS
            // uses; `(?!)` would be the idiomatic Rust one, and this crate has no lookaround.
            let re = build_regex(body).or_else(|_| build_regex("$.^"));
            match re {
                Ok(re) => Condition::Raw(Box::new(re)),
                Err(_) => Condition::Never,
            }
        }
        // 'app' triggers are renderer-evaluated, and so is anything this build cannot read.
        _ => Condition::Never,
    }
}

impl Rule {
    /// Compile one stored `AlertDef`, or `None` when it is switched off — the only reason this
    /// build refuses a def. An offset changes WHEN a def speaks, which is [`RuleSet::fire`]'s
    /// business rather than the compiler's.
    pub fn compile(def: &Value) -> Option<Rule> {
        if !def.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
            return None;
        }
        let trigger = def.get("trigger")?;
        let (composite, conditions) = match trigger.get("conditions").and_then(Value::as_array) {
            Some(list) => {
                let composite = match trigger.get("type").and_then(Value::as_str) {
                    Some("all") => Composite::All,
                    _ => Composite::Any,
                };
                (composite, list.iter().map(compile_condition).collect())
            }
            None => (Composite::Single, vec![compile_condition(trigger)]),
        };
        let sound = def.get("sound")?;
        Some(Rule {
            id: def.get("id").and_then(Value::as_str)?.to_owned(),
            name: def
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            sound: format!(
                "{}/{}",
                sound
                    .get("packId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                sound
                    .get("soundId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            ),
            cooldown_ms: def
                .get("cooldownMs")
                .and_then(Value::as_i64)
                .unwrap_or(DEFAULT_COOLDOWN_MS),
            per_target: def.get("cooldownScope").and_then(Value::as_str) == Some("target"),
            composite,
            conditions,
            early_warn_sec: normalize_early_warn_sec(def.get("earlyWarnSec")),
            // Read through the same `Option` chain every other field of a stored def is: a def is
            // the STORE's contract and this engine states nothing about its shape.
            wants_target: wants_target_token(
                def.get("speech")
                    .and_then(|s| s.get("phrase"))
                    .and_then(Value::as_str),
            ),
            // Handed in rather than duplicated inside `alerts_early`: that file is the schedule and
            // this one is the matcher, and there is exactly one matcher.
            break_kinds: break_trigger_kinds(trigger, &|spec| matcher_accepts(spec, "true")),
        })
    }

    /// The matched text and what it named, if this alert's trigger matches `ev`, else `None`.
    ///
    /// 'all' → every condition must match this ONE event; there are no cross-event windows, and an
    /// empty condition list is a no-match rather than a firehose. Every condition matched, so all
    /// their captures are in scope, first writer wins.
    ///
    /// 'any' / 'single' → the first matching condition, and its captures alone. A later condition
    /// is never evaluated, so it can never contribute a value the firing did not match on.
    fn matches(&self, ev: &Event) -> Option<Hit> {
        match self.composite {
            Composite::All => {
                if self.conditions.is_empty() {
                    return None;
                }
                let mut captures = None;
                for c in &self.conditions {
                    let hit = condition_matches(c, ev)?;
                    captures = merge_captures(captures, hit.captures);
                }
                Some(Hit { captures })
            }
            Composite::Any | Composite::Single => self
                .conditions
                .iter()
                .find_map(|c| condition_matches(c, ev)),
        }
    }

    /// Everything this rule's match produced, resolved. `base` is the event's own best-effort spell,
    /// computed once per firing by the caller and refined here PER ALERT, because for the
    /// shared-message families which name is right depends on which alert matched.
    fn firing(&self, ev: &Event, hit: Hit, base: Option<&str>, text: String) -> Firing {
        Firing {
            text,
            captures: with_auto_captures(hit.captures, self.wants_target, ev),
            spell: base.map(|b| matched_spell_name(self, ev, b)),
        }
    }

    /// The cooldown clock this firing belongs to.
    ///
    /// 'alert' (and absent) → the alert's own id. 'target' → `<id>\0<idKey(target)>`, so the first
    /// match on a mob always fires and only re-lands on THAT mob are rate-limited. A family that
    /// names no target degrades to the alert-level clock rather than minting a bogus one — a
    /// quieter alert, never a missing cooldown.
    ///
    /// RANK-BLIND BY CONSTRUCTION: no spell name enters this key, so one def firing on rank I and
    /// rank III of its own spell shares one clock.
    fn cooldown_key(&self, ev: &Event) -> String {
        if !self.per_target {
            return self.id.clone();
        }
        let Some(target) = ev.str("target") else {
            return self.id.clone();
        };
        let key = id_key(target);
        if key.is_empty() {
            self.id.clone()
        } else {
            format!("{}\u{0}{key}", self.id)
        }
    }
}

/// Whether a `where` matcher spec accepts one value, expressed through THIS file's own compiler so
/// the equality with the real matcher is structural rather than pinned by a test.
///
/// Key-blind, and its one caller asks about `refresh`. The rank fold belongs to keys that NAME A
/// SPELL, so it lives in [`compile_field`] where the trigger's kind and key are both known —
/// `refresh` is 'true', not a spell name, which is what `folds: false` says.
fn matcher_accepts(spec: &str, value: &str) -> bool {
    accepts(&compile_field("refresh", spec, ""), value, false)
}

fn condition_matches(cond: &Condition, ev: &Event) -> Option<Hit> {
    match cond {
        Condition::Event { kind, fields } => {
            if ev.kind() != kind {
                return None;
            }
            // Every field must match, so all their names are in scope. First writer wins on a
            // collision, which is source order.
            let mut captures = None;
            for f in fields {
                let hit = field_matches(ev, f)?;
                captures = merge_captures(captures, hit.captures);
            }
            Some(Hit { captures })
        }
        // A raw condition tests `ev.raw` — the exact line, and the only text it ever sees. One call
        // for both the test and the groups, so the two cannot disagree.
        Condition::Raw(re) => {
            let caps = re.captures(ev.raw())?;
            Some(Hit {
                captures: harvest_captures(re, &caps),
            })
        }
        Condition::Never => None,
    }
}

/// The compiled rule set and its clocks — everything `alerts.define` installs, plus what firing
/// leaves behind.
#[derive(Default, Serialize, Deserialize)]
pub struct RuleSet {
    /// The definitions VERBATIM, as the store holds them, and published as the module's `defs`: that
    /// list is the store's contract and carries the defs this evaluator compiled out too.
    defs: Vec<Value>,
    /// Compiled from `defs` (regexes inside), so a checkpoint carries the defs and `recompile`s.
    #[serde(skip)]
    rules: Vec<Rule>,
    /// Cooldown clock → last fire timestamp. `def.id` for an alert-scoped clock and
    /// `def.id\0<targetKey>` for a per-target one; one map holds both because a NUL can appear in
    /// no alert id and in no mob name. Bounded by [`COOLDOWN_KEY_CAP`], least-recently-fired first,
    /// which the delete-then-insert in [`RuleSet::note_fire`] is what keeps true.
    last_fire: JsMap<i64>,
    /// Per-alert ring of recent fires, newest last — the module's published `history`.
    history: JsMap<Vec<FireRecord>>,
}

impl RuleSet {
    /// Full-set replace. Everything about the previous set goes except the clocks and the history:
    /// a cooldown is a statement about a sound already made, and the fires ledger is user-facing
    /// history — neither is invalidated by the user editing a different alert.
    pub fn set_defs(&mut self, defs: Vec<Value>) {
        self.rules = defs.iter().filter_map(Rule::compile).collect();
        self.defs = defs;
    }

    /// The rules again from the defs - what a restored checkpoint does, since the compiled rules
    /// are not in it.
    pub fn recompile(&mut self) {
        self.rules = self.defs.iter().filter_map(Rule::compile).collect();
    }

    /// The definitions the store pushed, for `snapshot()`.
    pub fn defs(&self) -> &[Value] {
        &self.defs
    }

    /// The recent-fires ring as a plain object for the snapshot.
    pub fn history(&self) -> Value {
        let mut out = serde_json::Map::new();
        for (id, records) in self.history.iter() {
            out.insert(
                id.to_owned(),
                serde_json::to_value(records).unwrap_or(Value::Null),
            );
        }
        Value::Object(out)
    }

    /// A character switch: the defs stay (user prefs, not log state) while the per-character firing
    /// bookkeeping goes.
    pub fn reset(&mut self) {
        self.last_fire.clear();
    }

    /// Evaluate one LIVE event. The caller has already established that; this is never reached for a
    /// historical one, which is the boundary law kept in one gate above the loop.
    ///
    /// `early` is handed in rather than owned, because the scheduler is a sibling field of this one
    /// on the alerts module: an armed warning is resolved and delivered from the heartbeat, and a
    /// rule set that owned it could not lend it to the tick without lending itself.
    pub fn fire(&mut self, ev: &Event, early: &mut EarlyWarnings) -> Vec<Fire> {
        let mut out = Vec::new();
        // Collected before the clocks are written because a rule borrow cannot outlive one.
        let mut hits: Vec<(usize, String, Hit)> = Vec::new();
        for (i, rule) in self.rules.iter().enumerate() {
            if let Some(hit) = rule.matches(ev) {
                hits.push((i, rule.cooldown_key(ev), hit));
            }
        }
        // Resolved once per firing and refined per alert below — and lazily, so an event that
        // matched no rule (nearly every event) pays nothing for a field only a match can use.
        let base = (!hits.is_empty()).then(|| firing_spell(ev)).flatten();
        for (i, key, hit) in hits {
            let rule = &self.rules[i];
            let firing = rule.firing(ev, hit, base.as_deref(), ev.raw().to_owned());
            if early_warn_takes_it(rule, ev, &key, &firing, early) {
                continue;
            }
            if self.on_cooldown(&key, rule.cooldown_ms, ev.ts()) {
                continue;
            }
            let fire = Fire {
                at: ev.ts(),
                rule: rule.name.clone(),
                sound: rule.sound.clone(),
                message: firing.text.clone(),
                captures: firing.captures,
                spell: firing.spell,
                // An ordinary fire warns about nothing: it IS the thing happening, so there is no
                // deadline to count down to.
                due_at: None,
            };
            let id = rule.id.clone();
            self.note_fire(&key, ev.ts());
            self.record(&id, ev.ts(), firing.text);
            out.push(fire);
        }
        out
    }

    /// Make an early warning's firing, if the alert behind it still wants it.
    ///
    /// The def is RE-READ rather than trusted: a warning can be armed for a minute, and an alert the
    /// user deleted or switched off in the meantime must not speak. A rule recompiled under the same
    /// id is the same alert and speaks.
    ///
    /// The cooldown is spent here, on the clock the ARMING event chose (so `cooldownScope: 'target'`
    /// still means one clock per mob) and against `now_ms`, because there is no line behind it.
    ///
    /// `at` IS THE HEARTBEAT'S CLOCK — the one fire frame whose `at` is not the log's. An early
    /// warning has no matching event, its subject being a deadline that arrives while the log is
    /// idle, so the honest stamp is the instant it was spoken.
    pub fn fire_warning(&mut self, due: &EarlyWarnDue, now_ms: i64) -> Option<Fire> {
        let rule = self.rules.iter().find(|r| r.id == due.fired.alert_id)?;
        let cooldown_ms = rule.cooldown_ms;
        if self.on_cooldown(&due.cooldown_key, cooldown_ms, now_ms) {
            return None;
        }
        let id = due.fired.alert_id.clone();
        self.note_fire(&due.cooldown_key, now_ms);
        self.record(&id, now_ms, due.fired.message.clone());
        Some(Fire {
            at: now_ms,
            rule: due.fired.rule.clone(),
            sound: due.fired.sound.clone(),
            message: due.fired.message.clone(),
            // The words the arming match took, carried across the wait: a warning armed a minute ago
            // speaks the mob it armed ON, not whatever the world looks like now.
            captures: due.fired.captures.clone(),
            spell: due.fired.spell.clone(),
            // The row's stated end, so the gap between it and `at` IS the configured lead time.
            due_at: Some(due.due_at),
        })
    }

    /// Whether clock `key` is still inside `cooldown_ms` at `ts`.
    fn on_cooldown(&self, key: &str, cooldown_ms: i64, ts: i64) -> bool {
        self.last_fire
            .get(key)
            .is_some_and(|&last| ts - last < cooldown_ms)
    }

    /// Stamp a fire on clock `key`, keeping the map bounded and its iteration order
    /// least-recently-fired first (remove-then-insert re-inserts at the tail).
    fn note_fire(&mut self, key: &str, ts: i64) {
        self.last_fire.remove(key);
        self.last_fire.insert(key.to_owned(), ts);
        if self.last_fire.len() > COOLDOWN_KEY_CAP {
            let oldest = self.last_fire.keys().next().map(str::to_owned);
            if let Some(k) = oldest {
                self.last_fire.remove(&k);
            }
        }
    }

    /// Append a fire to an alert's ring buffer, capping at [`HISTORY_CAP`] (newest last).
    fn record(&mut self, id: &str, ts: i64, matched_text: String) {
        let record = FireRecord { ts, matched_text };
        if let Some(ring) = self.history.get_mut(id) {
            ring.push(record);
            if ring.len() > HISTORY_CAP {
                ring.drain(..ring.len() - HISTORY_CAP);
            }
            return;
        }
        self.history.insert(id.to_owned(), vec![record]);
    }
}

/// Event kind → the field on that event whose value is the triggering spell's DISPLAY name.
fn spell_field_of(kind: &str) -> Option<&'static str> {
    match kind {
        "castBegin" | "castFizzle" | "castInterrupted" | "resist" | "cc" | "heal" | "buffApply"
        | "buffFade" | "buffWearOff" | "buffExpired" => Some("spell"),
        "poisonProc" => Some("strike"),
        "poisonCoat" => Some("poison"),
        _ => None,
    }
}

/// The spell that set this event off, display form with the rank suffix INTACT, or `None` when the
/// family names none.
fn firing_spell(ev: &Event) -> Option<String> {
    if ev.kind() == "damage" {
        if !matches!(ev.str("dtype"), Some("spell" | "dot")) {
            return None;
        }
        let skill = js_trim(ev.str("skill").unwrap_or_default());
        return (!skill.is_empty()).then(|| skill.to_owned());
    }
    let name = js_trim(ev.str(spell_field_of(ev.kind())?).unwrap_or_default());
    // 'unknown' is what a `poisonCoat` says when the line deliberately hides which poison it was.
    (!name.is_empty() && name != "unknown").then(|| name.to_owned())
}

/// The spell name this firing is about: `base` (the event's own best-effort pick) unless the alert
/// matched a different candidate.
///
/// Once a Shiftless Deeds alert is allowed to fire on a line whose `spell` field says "Forlorn
/// Deeds", reporting "Forlorn Deeds" would be a second wrong answer wearing the first one's clothes.
/// It asks the same question the match did ([`accepts`], same rank fold), so the two cannot split
/// apart: a def pinned to `Elemental Maelstrom` firing on `Elemental Maelstrom II` keeps the event's
/// own pick.
fn matched_spell_name(rule: &Rule, ev: &Event, base: &str) -> String {
    let names = candidate_names(ev);
    if names.is_empty() {
        return base.to_owned();
    }
    for cond in &rule.conditions {
        let Condition::Event { kind, fields } = cond else {
            continue;
        };
        if kind != ev.kind() {
            continue;
        }
        let Some(f) = fields.iter().find(|x| x.key == "spell") else {
            continue;
        };
        let folds = fold_reaches(f, ev);
        if accepts(f, base, folds) {
            continue;
        }
        if let Some(hit) = names.iter().find(|n| accepts(f, n, folds)) {
            return hit.clone();
        }
    }
    base.to_owned()
}

/// The names this line could answer to — the event's own resolved pick plus the candidate list,
/// which is the truth when one sentence is a whole family.
fn arming_names(rule: &Rule, ev: &Event) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    if let Some(base) = firing_spell(ev) {
        names.push(matched_spell_name(rule, ev, &base));
    }
    names.extend(candidate_names(ev));
    names
}

/// Whether the early-warning offset claims this match — true when nothing sounds right now.
///
/// THE OFFSET MOVES THE ONE FIRE; IT DOES NOT ADD A SECOND ONE. An alert with an early warning says
/// nothing when its trigger matches: the match arms a warning against the timer row this landing
/// produces, and the firing is made N seconds before that row's estimated end. The cooldown is
/// deliberately not spent here — the clock belongs to the sound, and no sound has been made.
///
/// …unless the def's trigger IS the ending, in which case there is nothing left to arm against. A
/// break-family def arms from the row appearing instead and still fires on its own trigger, except
/// for the one landing whose warning already spoke, which `break_spoken` swallows.
fn early_warn_takes_it(
    rule: &Rule,
    ev: &Event,
    cooldown_key: &str,
    firing: &Firing,
    early: &mut EarlyWarnings,
) -> bool {
    let Some(sec) = rule.early_warn_sec else {
        return false;
    };
    let names = arming_names(rule, ev);
    if rule.break_kinds.is_empty() {
        early.arm(EarlyWarnArm {
            sec,
            cooldown_key: cooldown_key.to_owned(),
            subject: early_warn_subject(ev, &names),
            ts: ev.ts(),
            fired: rule.armed_fire(firing),
        });
        return true;
    }
    early.break_spoken(&rule.id, &break_event_identity(ev, &names))
}

impl Rule {
    /// The firing this rule would make, carrying everything the match produced. The alert's id rides
    /// along because a warning re-reads its own def when it comes due.
    ///
    /// THE WORDS ARE FROZEN AT THE ARM: the warning speaks about the landing it armed on, and that
    /// event is gone by the time the heartbeat fires. Cloned rather than moved because the caller
    /// still owns the firing — a break-family def arms nothing here and its `Firing` goes on to be
    /// the fire itself.
    fn armed_fire(&self, firing: &Firing) -> ArmedFire {
        ArmedFire {
            alert_id: self.id.clone(),
            rule: self.name.clone(),
            sound: self.sound.clone(),
            message: firing.text.clone(),
            captures: firing.captures.clone(),
            spell: firing.spell.clone(),
        }
    }
}

impl BreakWatchers for RuleSet {
    /// Rebuilt each tick rather than cached with the compile, because `enabled` and the offset can
    /// change under it and the list is at most a handful of defs. A disabled def never compiled, so
    /// `enabled` is answered structurally here.
    fn break_watchers(&self) -> Vec<(String, i64)> {
        self.rules
            .iter()
            .filter(|r| !r.break_kinds.is_empty())
            .filter_map(|r| r.early_warn_sec.map(|sec| (r.id.clone(), sec)))
            .collect()
    }

    /// The same question without the allocation — asked once per beat by
    /// [`crate::EqModule::wants_timer_rows`] to decide whether the projection is built at all.
    fn has_break_watchers(&self) -> bool {
        self.rules
            .iter()
            .any(|r| !r.break_kinds.is_empty() && r.early_warn_sec.is_some())
    }

    /// Would this def announce the break of this row — asked of the def's OWN matcher, never of a
    /// second one written to guess at the same question. The hypothetical event and its blast radius
    /// are documented on `alerts_early::break_probes`.
    ///
    /// The firing it hands back is built like an ordinary one: the matched text the matcher reports
    /// (a projection sentence, since no line has been printed), the captures its own named groups
    /// took, and the cooldown clock the REAL break event would have chosen.
    ///
    /// The probe's hypothetical event carries the row's subject, so `{target}` resolves off it
    /// exactly as it would off the line that never got printed; and the spoken spell is the probe's
    /// rank-less name, because the name the alert matched on is the name it should say.
    fn probe_break(
        &self,
        alert_id: &str,
        row: &BuffTimerRow,
        now_ms: i64,
    ) -> Option<(ArmedFire, String)> {
        let rule = self.rules.iter().find(|r| r.id == alert_id)?;
        for kind in &rule.break_kinds {
            for p in break_probes(*kind, row, now_ms) {
                let Some(hit) = rule.matches(&p.ev) else {
                    continue;
                };
                let text = p.ev.raw().to_owned();
                let firing = Firing {
                    text,
                    captures: with_auto_captures(hit.captures, rule.wants_target, &p.ev),
                    spell: Some(p.spell.clone()),
                };
                return Some((rule.armed_fire(&firing), rule.cooldown_key(&p.ev)));
            }
        }
        None
    }
}

#[cfg(test)]
mod tests;
