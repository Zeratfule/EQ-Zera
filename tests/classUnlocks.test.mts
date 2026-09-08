// SKILL / DISCIPLINE / INNATE UNLOCK LEVELS — the second half of "what's new at this
// level" (docs/plans/levelup-whats-new.md § 1, wave O1).
//
// The design doc assumed this data "does NOT exist". It does: every eqlwiki class page
// states unlock levels in tables with a Level column, and `npm run scrape:classes` now
// commits them into src/main/data/classes.json as `skillUnlocks` / `discUnlocks`.
//
// Asserted against the COMMITTED JSON, never the live wiki (the classTables.test.mts rule):
// the scrape is a build step, the file is the authority. No Electron, never skips.
//
// Counts are FLOORS under what the tree measures today (450 skill-section rows across 16
// classes, 33 discipline rows across 4, measured 2026-08-05), so a wiki edit that adds a
// row keeps them green and a parser regression that stops resolving a column turns them red.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import classes from '../src/main/data/classes.json'

interface Unlock {
  name: string
  level: number
  kind: string
}

const skillUnlocks: Record<string, Unlock[]> = classes.skillUnlocks
const discUnlocks: Record<string, Unlock[]> = classes.discUnlocks
const skills: Record<string, string[]> = classes.skills

const ALL: string[] = [
  'BER', 'BRD', 'BST', 'CLR', 'DRU', 'ENC', 'MAG', 'MNK',
  'NEC', 'PAL', 'RNG', 'ROG', 'SHD', 'SHM', 'WAR', 'WIZ'
]

const everyRow = (t: Record<string, Unlock[]>): Unlock[] => Object.values(t).flat()

// ---- the shape of the two new sections -----------------------------------

test('every class states its skill unlocks; the discipline table is sparse and says so', () => {
  assert.deepEqual(Object.keys(skillUnlocks).sort(), ALL)
  // Only four class pages carry a discipline table with levels — BER, MNK, RNG and ROG.
  // The other twelve are ABSENT rather than empty: the wiki does not state them, so we do
  // not carry a key that would read as "this class has none" (law 1).
  for (const abbr of Object.keys(discUnlocks)) assert.ok(ALL.includes(abbr), `unknown class ${abbr}`)
  assert.ok(Object.keys(discUnlocks).length >= 4, 'the discipline tables vanished')
  assert.ok(Object.keys(discUnlocks).length < 16, 'every class suddenly has disciplines — verify the wiki')
})

test('every unlock row is a real statement: a name, an integer level in 1..65, a known kind', () => {
  for (const [abbr, rows] of Object.entries({ ...skillUnlocks, ...discUnlocks })) {
    assert.ok(rows.length > 0, `${abbr} carries an empty list`)
    for (const r of rows) {
      assert.ok(r.name.length > 0 && r.name.length <= 40, `${abbr}: bad name ${JSON.stringify(r.name)}`)
      assert.ok(Number.isInteger(r.level), `${abbr} ${r.name}: level ${String(r.level)} is not an integer`)
      assert.ok(r.level >= 1 && r.level <= 65, `${abbr} ${r.name}: level ${r.level} out of range`)
      assert.ok(['skill', 'disc', 'innate'].includes(r.kind), `${abbr} ${r.name}: kind ${r.kind}`)
    }
  }
})

test('the two sections are disjoint by kind — a disc never lands in skillUnlocks', () => {
  for (const r of everyRow(skillUnlocks)) assert.notEqual(r.kind, 'disc', `${r.name} is a disc in skillUnlocks`)
  for (const r of everyRow(discUnlocks)) assert.equal(r.kind, 'disc', `${r.name} is ${r.kind} in discUnlocks`)
})

test('each class lists a name once, in level order, so a panel can slice by level', () => {
  for (const [abbr, rows] of Object.entries({ ...skillUnlocks, ...discUnlocks })) {
    const names = rows.map((r) => r.name.toLowerCase())
    assert.deepEqual(names.length, new Set(names).size, `${abbr} lists a name twice`)
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1].level <= rows[i].level, `${abbr} is not level-ordered at ${rows[i].name}`)
    }
  }
})

// ---- coverage floors ------------------------------------------------------

test('the class pages state at least 430 skill unlocks and 30 discipline unlocks', () => {
  const s = everyRow(skillUnlocks).length
  const d = everyRow(discUnlocks).length
  assert.ok(s >= 430, `only ${s} skill-section unlocks`) // measured 450
  assert.ok(d >= 30, `only ${d} discipline unlocks`) // measured 33
})

test('no class page collapses to a stub — every class states at least 15 skill unlocks', () => {
  for (const abbr of ALL) {
    assert.ok(skillUnlocks[abbr].length >= 15, `${abbr} states only ${skillUnlocks[abbr].length}`)
  }
})

// ---- anchors: what the pages actually state -------------------------------

const at = (abbr: string, name: string): Unlock | undefined =>
  [...(skillUnlocks[abbr] ?? []), ...(discUnlocks[abbr] ?? [])].find((r) => r.name === name)

test('the melee anchors match the level the pages print', () => {
  assert.deepEqual(at('WAR', 'Double Attack'), { name: 'Double Attack', level: 15, kind: 'skill' })
  assert.deepEqual(at('BER', 'Triple Attack'), { name: 'Triple Attack', level: 46, kind: 'skill' })
  assert.deepEqual(at('MNK', 'Feign Death'), { name: 'Feign Death', level: 17, kind: 'skill' })
  assert.deepEqual(at('ROG', 'Backstab'), { name: 'Backstab', level: 1, kind: 'skill' })
})

test('kind innate comes from the page FOOTNOTING it as an ability, never from a guess', () => {
  // "* Lay on Hands is an Ability, not a Skill", "** Smite is a new Paladin ability
  // (not a Skill) in EQL", "* Harm Touch is now an Ability, not a Skill".
  assert.deepEqual(at('PAL', 'Lay on Hands'), { name: 'Lay on Hands', level: 1, kind: 'innate' })
  assert.deepEqual(at('PAL', 'Smite'), { name: 'Smite', level: 9, kind: 'innate' })
  assert.deepEqual(at('SHD', 'Harm Touch'), { name: 'Harm Touch', level: 1, kind: 'innate' })
  // Exactly those three across all 16 pages — nothing else is called innate.
  const innate = everyRow(skillUnlocks).filter((r) => r.kind === 'innate')
  assert.equal(innate.length, 3)
})

test('the discipline anchors match, Rogue poisons included', () => {
  assert.deepEqual(at('MNK', 'Stonestance Discipline'), {
    name: 'Stonestance Discipline',
    level: 51,
    kind: 'disc'
  })
  assert.deepEqual(at('BER', 'Tendon Slice'), { name: 'Tendon Slice', level: 14, kind: 'disc' })
  assert.deepEqual(at('ROG', 'Asp Venom'), { name: 'Asp Venom', level: 2, kind: 'disc' })
  assert.ok(discUnlocks.ROG.length >= 18, `only ${discUnlocks.ROG.length} Rogue poisons`) // measured 20
})

// ---- honesty: what the wiki contradicts about itself ----------------------

test('the "only Rogue poison disciplines are on Legends" statement is carried, not buried', () => {
  // The central Disciplines page strikes through every non-Rogue table and says so in
  // prose. The CLASS pages do not, so BER/MNK/RNG rows ship — but labeled, never silently
  // (law 1). If this line ever disappears the disciplines half is asserting more than the
  // wiki does.
  //
  // THIS IS THE SCRAPE, AND THE SCRAPE STAYS PRISTINE (JOS-351). The wiki still disputes RNG,
  // so the sentence is still here; whether a ROW wears the chip is decided one layer up by
  // `CONFIRMED_UNLOCKS` (src/main/data/levelUnlocks.ts), where a player's in-game sighting can
  // clear it. Do not delete a line from `disputed[]` to un-chip a row — `npm run scrape:classes`
  // would put it back, and the wiki would still be saying what it says.
  const lines = classes.disputed.filter((d) => d.startsWith('discUnlocks '))
  assert.ok(lines.length >= 3, `only ${lines.length} discipline disputes`)
  for (const abbr of ['BER', 'MNK', 'RNG']) {
    assert.ok(
      lines.some((l) => l.includes(`'${abbr}'`) && l.includes('only Rogue poison disciplines are on Legends')),
      `${abbr}'s discipline rows ship unlabeled`
    )
  }
  // ROG is the one class the Disciplines page does NOT strike through — no dispute for it.
  assert.equal(lines.some((l) => l.includes("'ROG'")), false)
})

test('every table the scrape could not read is enumerated, not silently dropped', () => {
  // Four today: the Rogue page's stance/invocation tables and the Wizard page's two quest
  // tables, none of which name a level column. They are reported so a future wiki edit
  // that ADDS a level column shows up as a shrinking list rather than as nothing at all.
  const gaps = classes.disputed.filter((d) => d.startsWith('unlocks '))
  assert.ok(gaps.length > 0, 'the gap register is empty — the reporting hook is dead')
  assert.ok(gaps.length <= 20, `${gaps.length} unreadable tables — the page shapes changed`)
})

// ---- parity with the existing skills table --------------------------------

test('the unlock names line up with the skills table the combo inference already uses', () => {
  const rows = Object.entries(skillUnlocks).flatMap(([abbr, rs]) =>
    rs.filter((r) => r.kind === 'skill').map((r) => ({ abbr, name: r.name }))
  )
  const matched = rows.filter((r) => (skills[r.name] ?? []).includes(r.abbr))
  // measured 433 of 447. The shortfall is ONE class: the Shadow Knight page writes its
  // Casting and Miscellaneous skill names as PLAIN TEXT (no [[wiki link]]), and the older
  // `skills` parser keys on the first linked cell, so those 15 rows never reached `skills`.
  // The unlock table reads them from the header instead and is strictly more complete —
  // this floor pins that it stays a small, one-class gap rather than a drift.
  assert.ok(matched.length >= 420, `only ${matched.length} of ${rows.length} unlock names are in skills[]`)
  assert.ok(rows.length - matched.length <= 25, `${rows.length - matched.length} unlock names are unknown to skills[]`)
})
