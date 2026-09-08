// V4 — THE EFFECT BROWSER'S GROUPING MODEL (src/renderer/src/features/planner/plannerGroups.ts).
//
// The browser is a windowed list of FIXED-height rows, so a group header is a row like any other
// and "expanded" is just a longer array. That is a shape, not a rendering detail, and it is what
// this file pins: the interleave (header, then its donors while open), the crown flag, and the
// ordering rule of every axis. Get those wrong and the pane still renders — it just answers the
// wrong question, silently.
//
// A FIXTURE, DELIBERATELY, unlike the corpus tests beside it: the point here is the fold, and
// nine hand-written rows can state a tie, a two-slot donor and an era the catalog does not place —
// all of which the real corpus contains but none of which it would let a test NAME. The corpus's
// own half of V4/V5 is `plannerFocusFamily.test.mts` (every real focus name, parsed).
//
// The module is pure and imports `plannerData` for TYPES ONLY, which is what lets this run under
// node with no renderer, no localStorage and no mob catalog: the era verdict arrives as `eraOf`,
// injected below exactly the way the browser injects the real one.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DonorRow } from '../src/renderer/src/features/planner/plannerData'
import {
  axesFor,
  browserRows,
  defaultAxis,
  groupDonors,
  isAxisFor,
  type BrowserRow,
  type DonorGroup
} from '../src/renderer/src/features/planner/plannerGroups'
import type { Era } from '../src/shared/planner/era'
import type { EffectFacts } from '../src/shared/planner/effectText'
import type { EquipSlot, SocketType } from '../src/shared/planner/types'

interface Spec {
  name: string
  effect: string
  socket?: SocketType
  slots?: EquipSlot[]
  family?: string
  familyTier?: number
  haste?: boolean
  era?: Era | null
  /** V6's spell-DB join, as it rides on the donor row. Absent = the join missed (law 1). */
  facts?: EffectFacts
}

const ERAS = new Map<string, Era | null>()

function row(spec: Spec): DonorRow {
  const key = spec.name.toLowerCase()
  ERAS.set(key, spec.era ?? null)
  return {
    key,
    name: spec.name,
    slots: spec.slots ?? ['PRIMARY'],
    classes: [],
    effect: spec.effect,
    family: spec.family,
    familyTier: spec.familyTier,
    socket: spec.socket ?? 'focus',
    tierRequired: 1,
    hasteLocked: spec.haste ?? false,
    quest: false,
    playerCrafted: false,
    ...spec.facts,
    searchKey: `${spec.name} ${spec.effect}`.toLowerCase()
  }
}

/** The injected era reader — the browser passes `plannerData.donorEraOf`, this passes the fixture. */
const eraOf = (d: DonorRow): Era | null => ERAS.get(d.key) ?? null

/** A focus row: an item, an effect, and the `[family, tier]` main parsed out of that effect's name. */
const focus = (name: string, effect: string, rank: [string, number], rest: Partial<Spec> = {}): DonorRow =>
  row({ name, effect, family: rank[0], familyTier: rank[1], ...rest })

// One family with three ranks and a TIE at the top, one family with a single unranked name, and
// one two-slot donor — the three cases the fold has to get right.
const HEAL_I = focus('Cloak of Piety', 'Improved Healing I', ['Improved Healing', 1])
const HEAL_III_A = focus('Water Sprinkler', 'Improved Healing III', ['Improved Healing', 3])
const HEAL_III_B = focus('Coldain Hammer', 'Improved Healing III', ['Improved Healing', 3], {
  slots: ['PRIMARY', 'SECONDARY']
})
const RANGE_I = focus('Staff of Writhing', 'Extended Range I', ['Extended Range', 1], { era: 'kunark' })
const RANGE_II = focus('Runed Mithril Bracer', 'Extended Range II', ['Extended Range', 2], { era: 'classic' })
const MINION = focus('Bone Bladed Claymore', 'Minion of Air', ['Minion of Air', 1], { era: null })
const HASTED = focus('Flowing Black Robe', 'Spell Haste I', ['Spell Haste', 1], { haste: true, slots: [] })

const FOCUS_ROWS = [HEAL_I, HEAL_III_A, HEAL_III_B, RANGE_I, RANGE_II, MINION, HASTED]

const labels = (groups: readonly DonorGroup[]): string[] => groups.map((g) => g.label)

test('the effect axis keeps the browser standing rule: most donors first, then by name', () => {
  const groups = groupDonors(FOCUS_ROWS, 'effect', eraOf)
  assert.deepEqual(labels(groups), [
    'Improved Healing III', // 2 donors
    'Extended Range I', // then the ties, alphabetically
    'Extended Range II',
    'Improved Healing I',
    'Minion of Air',
    'Spell Haste I'
  ])
  assert.equal(groups[0].donors.length, 2)
  // Nothing on the effect axis is a family, so no row can be crowned.
  assert.deepEqual(
    groups.map((g) => g.topTier),
    groups.map(() => null)
  )
})

test('the family axis folds ranks together, sorts tier-desc, and crowns every top-tier row', () => {
  const groups = groupDonors(FOCUS_ROWS, 'family', eraOf)
  // Group order: top tier DESC, then donor count, then name.
  assert.deepEqual(labels(groups), ['Improved Healing', 'Extended Range', 'Minion of Air', 'Spell Haste'])

  const healing = groups[0]
  assert.equal(healing.topTier, 3)
  assert.deepEqual(
    healing.donors.map((d) => d.effect),
    ['Improved Healing III', 'Improved Healing III', 'Improved Healing I']
  )
  // The header states the best line AS WRITTEN — the corpus has no percentages to state instead.
  assert.equal(healing.note, 'Improved Healing III')
  // …and a family whose only name IS the label says nothing rather than repeating itself (law 1).
  assert.equal(groups[2].note, '')

  const rows = browserRows(groups, new Set([healing.id]))
  const crowned = rows.filter((r): r is Extract<BrowserRow, { kind: 'donor' }> => r.kind === 'donor' && r.best)
  // BOTH III donors are crowned: if two items carry the family's best line, they both ARE the best,
  // and picking one would be the planner inventing a preference.
  assert.deepEqual(
    crowned.map((r) => r.donor.name),
    ['Water Sprinkler', 'Coldain Hammer']
  )
})

test('a group header is a ROW, and expanding one only makes the array longer', () => {
  const groups = groupDonors(FOCUS_ROWS, 'family', eraOf)
  const collapsed = browserRows(groups, new Set())
  // Windowing law: a collapsed list is exactly one row per group, whatever the donors number.
  assert.equal(collapsed.length, groups.length)
  assert.ok(collapsed.every((r) => r.kind === 'header'))

  const open = browserRows(groups, new Set([groups[0].id, groups[1].id]))
  assert.equal(open.length, groups.length + groups[0].donors.length + groups[1].donors.length)
  // The interleave: each opened header is followed by its own donors, in group order.
  assert.deepEqual(
    open.slice(0, 4).map((r) => (r.kind === 'header' ? `H ${r.group.label}` : `d ${r.donor.effect}`)),
    ['H Improved Healing', 'd Improved Healing III', 'd Improved Healing III', 'd Improved Healing I']
  )
  // Under a family header the row must name its own effect; under an effect header it must not.
  assert.ok(open.every((r) => r.kind === 'header' || r.namesEffect))
  const byEffect = browserRows(groupDonors(FOCUS_ROWS, 'effect', eraOf), new Set(['effect:Improved Healing III']))
  assert.ok(byEffect.every((r) => r.kind === 'header' || !r.namesEffect))
})

// ---- JOS-42 refinement 2: the one-liner belongs to the family, not to every row ---------------

const BURNING: EffectFacts = { spellType: 'Beneficial', spellTarget: 'Self', spellDuration: '2:24:00' }

/** Three ranks of one family, all saying the same three things about themselves — the real case. */
const BURN_ROWS = [
  focus('Runed Bolster Belt', 'Burning Affliction I', ['Burning Affliction', 1], { facts: BURNING }),
  focus('Shissar Focus Ring', 'Burning Affliction III', ['Burning Affliction', 3], { facts: BURNING })
]

test('a family header states the one-liner its whole family shares, and the rows stop repeating it', () => {
  const [family] = groupDonors(BURN_ROWS, 'family', eraOf)
  assert.equal(family.says, 'Beneficial · Self · 2:24:00')

  const rows = browserRows([family], new Set([family.id]))
  // Every donor under it goes quiet — that repeated text is exactly what was truncating the
  // effect NAME on each row ("Burning Af…", the JOS-42 screenshot).
  assert.ok(rows.every((r) => r.kind === 'header' || !r.namesSays))
  // …and the effect name is still on the row, because a family header does not name a rank.
  assert.ok(rows.every((r) => r.kind === 'header' || r.namesEffect))
})

test('a header only speaks for rows that AGREE — one dissenter and the rows keep their own line', () => {
  // The corpus's real case: Percussion Resonance carries `Self · 1:57:00` AND `Self · 2:12:00`,
  // so no line is true of the family and the header must say nothing.
  const dissenting = [
    ...BURN_ROWS,
    focus('Odd Trinket', 'Burning Affliction II', ['Burning Affliction', 2], {
      facts: { spellType: 'Detrimental', spellTarget: 'Single Hostile' }
    })
  ]
  const [family] = groupDonors(dissenting, 'family', eraOf)
  assert.equal(family.says, '', 'a header may only state what is true of every row under it')
  assert.ok(browserRows([family], new Set([family.id])).every((r) => r.kind === 'header' || r.namesSays))
})

test('a SILENT rank does not veto a header — the join missing is not a disagreement', () => {
  // The other real case: one family joins the spell DB on some ranks and not others (5.8% of
  // effect rows miss the join, law 1). Letting a row that states nothing suppress a line true of
  // every row that speaks would trade a fact for nothing.
  const withSilent = [...BURN_ROWS, focus('Plain Band', 'Burning Affliction II', ['Burning Affliction', 2])]
  const [family] = groupDonors(withSilent, 'family', eraOf)
  assert.equal(family.says, 'Beneficial · Self · 2:24:00')
  // …and every row goes quiet: the two that agreed because the header took their line, the silent
  // one because it never had a line to draw.
  assert.ok(browserRows([family], new Set([family.id])).every((r) => r.kind === 'header' || !r.namesSays))
})

test('a header that spoke does not silence the ONE rank that says something else', () => {
  const odd = focus('Odd Trinket', 'Burning Affliction II', ['Burning Affliction', 2], {
    facts: { spellType: 'Beneficial', spellTarget: 'Self', spellDuration: '9:99:99' }
  })
  // Two ranks agree, one differs, and one is silent — so the header can state nothing (the
  // dissenter vetoes), which is the case above. Take the dissenter away from the veto by giving
  // the majority its own group: what is pinned here is the per-ROW rule, read directly.
  const [family] = groupDonors([...BURN_ROWS, odd], 'family', eraOf)
  assert.equal(family.says, '')
  const rows = browserRows([family], new Set([family.id]))
  assert.ok(
    rows.every((r) => r.kind === 'header' || r.namesSays),
    'with no header line every row that HAS a line speaks'
  )
  // And with a header line in place, the row carrying exactly it is the only kind that goes quiet.
  const [agreeing] = groupDonors(BURN_ROWS, 'family', eraOf)
  const quiet = browserRows([agreeing], new Set([agreeing.id])).filter((r) => r.kind === 'donor' && !r.namesSays)
  assert.equal(quiet.length, BURN_ROWS.length)
})

test('a family the spell DB never joined says nothing — no placeholder, no invented line', () => {
  const [family] = groupDonors([HEAL_I, HEAL_III_A], 'family', eraOf)
  assert.equal(family.says, '')
  // …and neither do its rows: `namesSays` means "this row DRAWS a line", and a row the join
  // missed has none to draw. Silence at both levels, which is law 1 rather than a layout choice.
  assert.ok(browserRows([family], new Set([family.id])).every((r) => r.kind === 'header' || !r.namesSays))
})

test('only the family axis lifts the line — every other axis groups rows whose effects differ', () => {
  for (const axis of ['effect', 'slot', 'socket', 'era'] as const) {
    for (const group of groupDonors(BURN_ROWS, axis, eraOf)) {
      assert.equal(group.says, '', `the ${axis} axis lifted a one-liner`)
    }
  }
})

test('the slot axis lists a two-slot donor twice, in character-sheet order, slotless last', () => {
  const groups = groupDonors(FOCUS_ROWS, 'slot', eraOf)
  assert.deepEqual(labels(groups), ['PRIMARY', 'SECONDARY', 'No slot'])
  // The fan-out is the point: a sword that is PRIMARY and SECONDARY is genuinely both.
  assert.ok(groups[0].donors.includes(HEAL_III_B))
  assert.ok(groups[1].donors.includes(HEAL_III_B))
  assert.deepEqual(groups[1].donors, [HEAL_III_B])
  // The R2 escape hatch's rows group together rather than vanishing — they are on screen on purpose.
  assert.deepEqual(groups[2].donors, [HASTED])
  // R3 rides up to the header, so a haste-locked group says so before it is expanded.
  assert.equal(groups[2].hasteLocked, true)
  assert.equal(groups[0].hasteLocked, false)
})

test('the era axis reads the injected verdict, in release order, with the unplaced last', () => {
  const groups = groupDonors(FOCUS_ROWS, 'era', eraOf)
  assert.deepEqual(labels(groups), ['Classic', 'Kunark', 'era?'])
  assert.deepEqual(groups[1].donors, [RANGE_I])
  // "era?" is nothing states an era — never dressed up as out-of-era, and never sorted as if the
  // planner knew where it belonged.
  assert.equal(groups[2].donors.length, FOCUS_ROWS.length - 2)
})

test('the socket axis groups by unlock order — the model serves what the tabs do not', () => {
  const mixed = [
    row({ name: 'Ghoulbane', effect: 'Nullify Undead', socket: 'proc' }),
    row({ name: 'Cloak of Piety', effect: 'Improved Healing I', socket: 'focus' }),
    row({ name: 'Shiny Brass Idol', effect: 'Strengthen', socket: 'click' })
  ]
  assert.deepEqual(labels(groupDonors(mixed, 'socket', eraOf)), ['Focus', 'Click', 'Proc'])
})

test('the axes a socket offers, and the one it defaults to', () => {
  // FAMILY IS FOCUS-ONLY: the rank in an effect name is parsed for focus rows and nothing else.
  assert.deepEqual(axesFor('focus'), ['family', 'effect', 'slot', 'era'])
  for (const socket of ['proc', 'worn', 'click'] as SocketType[]) {
    assert.ok(!axesFor(socket).includes('family'), `${socket} offered the family axis`)
    assert.equal(defaultAxis(socket), 'effect')
    assert.equal(isAxisFor(socket, 'family'), false)
  }
  assert.equal(defaultAxis('focus'), 'family')
  assert.equal(isAxisFor('focus', 'family'), true)
  assert.equal(isAxisFor('focus', 'instrument'), false)
})

test('an empty corpus folds to no groups and no rows, on every axis', () => {
  for (const axis of axesFor('focus')) {
    assert.deepEqual(groupDonors([], axis, eraOf), [])
    assert.deepEqual(browserRows([], new Set()), [])
  }
})
