// QUEST STEP LOCATIONS, THE PARSER HALF (quest locations wave): scripts/sources/questStepRefs.ts
// and the per-step facts `parseQuestPage` now keeps beside each step (`stepLinks`, `stepLocs`).
//
// Two kinds of pin. Inline wikitext for every coordinate shape the committed pages write, and the
// refusals that keep prose numbers out ("48,000 exp", "2nd floor", "#4, 1x"). Then the REAL pages:
// "Hate, Betrayal, and Trust" (cache page-72694) exactly, and two laws over the committed catalog —
// the per-step arrays are index-aligned with `steps`, and the step list did not move (a hand tick
// is a step INDEX, shared/questPins.ts).
//
// Run: `npm test`.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseQuestPage } from '../scripts/sources/questPage'
import { formatPoint, parseLocTemplate, renderLocTemplates, stepLinksOf, stepLocsOf } from '../scripts/sources/questStepRefs'
import questsJson from '../src/renderer/src/data/eqlegends/quests.json'
import type { QuestData } from '../src/shared/types'

const CACHE = join(import.meta.dirname, '..', 'scripts', 'sources', 'cache', 'quests')
const page = (id: number): string => readFileSync(join(CACHE, `page-${String(id)}.wikitext`), 'utf8')
const catalog = (questsJson as unknown as QuestData).quests
const noItems = (): boolean => false
/** The prose coordinates of one plain line (no templates, so raw = text). */
const prose = (text: string): string[] => stepLocsOf(text, text).map((l) => formatPoint(l))

test('{{Loc}} parses every coordinate shape the pages write, keeping its zone verbatim', () => {
  assert.deepEqual(parseLocTemplate('Everfrost|-850, -1480'), { zone: 'Everfrost', points: [{ ns: -850, ew: -1480 }] })
  assert.deepEqual(parseLocTemplate(' Thurgadin | -200, 0'), { zone: 'Thurgadin', points: [{ ns: -200, ew: 0 }] })
  assert.deepEqual(parseLocTemplate('Splitpaw|(+690, -17)|(+690, -17)')?.points, [{ ns: 690, ew: -17 }])
  assert.deepEqual(parseLocTemplate('Firiona Vie|(116, -1365),(-322, 1854)')?.points, [
    { ns: 116, ew: -1365 },
    { ns: -322, ew: 1854 }
  ])
  // An unclosed bracket on the wiki still states the point.
  assert.deepEqual(parseLocTemplate('Kithicor Forest|(-216,3813|Jeena Firechaser - Kithicor Forest')?.points, [{ ns: -216, ew: 3813 }])
  // "2nd floor" is not an elevation of 2.
  assert.deepEqual(parseLocTemplate(' Temple of Solusek Ro |+425, -70, 2nd floor')?.points, [{ ns: 425, ew: -70 }])
  assert.deepEqual(parseLocTemplate('Lesser Faydark|-802,2682,-2|-802, 2682, -2')?.points, [{ ns: -802, ew: 2682, z: -2 }])
  assert.equal(parseLocTemplate('Rivervale|no numbers here'), null)
})

test('{{Loc}} RENDERS into the step instead of vanishing, naming its zone only when the line does not', () => {
  assert.equal(renderLocTemplates('Find X in {{Loc|Rivervale|-49, -177}}'), 'Find X in Rivervale (-49, -177)')
  // The line already says the zone (as text, or as a link to the same map): just the point.
  assert.equal(renderLocTemplates('in the [[Lesser Faydark]] at {{Loc|Lesser Faydark|-802,2682,-2}}, near'), 'in the [[Lesser Faydark]] at (-802, 2682, -2), near')
  assert.equal(renderLocTemplates('[[Eysa]] in [[Wakening Land]] {{Loc|Wakening Lands|-940, -1700}} "seeds"'), '[[Eysa]] in [[Wakening Land]] (-940, -1700) "seeds"')
  // Already in brackets: `(a, b)`, never `((a, b))`.
  assert.equal(renderLocTemplates("[[Manik]] ({{loc|Ak'Anon|902, -470|map}}) in [[Ak'Anon]]"), "[[Manik]] (902, -470) in [[Ak'Anon]]")
  assert.equal(renderLocTemplates('to [[Tain]] ({{loc|Eastern Wastes|-4950, -2650}})'), 'to [[Tain]] (Eastern Wastes -4950, -2650)')
  assert.equal(renderLocTemplates('no template'), 'no template')
})

test('prose coordinates: bracketed or cued only, and never a quantity', () => {
  assert.deepEqual(prose('meet Ozval at the central huts, near (201, -97, -7).'), ['(201, -97, -7)'])
  assert.deepEqual(prose('Larkon Theardor is located at 1029, -978, 32 behind the Library'), ['(1029, -978, 32)'])
  assert.deepEqual(prose('Your Location is -192.19, -129.81, 3.26'), ['(-192.19, -129.81, 3.26)'])
  assert.deepEqual(prose('click the gates (/waypoint -90,287,127).'), ['(-90, 287, 127)'])
  assert.deepEqual(prose('(Tascar Tissleplay loc:-89, -322) (Jakum Webdancer loc: -232, 259)'), ['(-89, -322)', '(-232, 259)'])
  assert.deepEqual(prose('Find Drill Master Dal in Fortress Talishan [-248.40, -124.09, 31.75].'), ['(-248.4, -124.09, 31.75)'])
  assert.deepEqual(prose('Trooper Mozo can be found at -2555, +3565, guarding'), ['(-2555, 3565)'])
  // Refusals: a thousands separator, a count list, an unbracketed uncued pair, a quantity.
  assert.deepEqual(prose('(About 48,000 exp per bracer)'), [])
  assert.deepEqual(prose('pick up 2x. This means 1x for Shawl #4, 1x for Shawl #7'), [])
  assert.deepEqual(prose('in Iceshard Manor (in Kael Drakkel  -850, +1150)'), [])
  assert.deepEqual(prose('it is at 5, 10 minutes past the hour'), [])
})

test('step links: targets and the labels a step shows, item and namespaced links left out', () => {
  const isItem = (t: string): boolean => t === 'Peerless Sapphire'
  const raw = "* Tell [[Merchant Tyslin (North Felwithe)|Merchant Tyslin]] in [[Felwithe|Northern Felwithe]], at (107, -438), to receive the [[Peerless Sapphire]]. [[File:x.png]] [[Category:Quests]]"
  assert.deepEqual(stepLinksOf(raw, isItem), [
    { page: 'Merchant Tyslin (North Felwithe)', label: 'Merchant Tyslin' },
    { page: 'Felwithe', label: 'Northern Felwithe' }
  ])
  assert.deepEqual(stepLinksOf('[[Rylin Coil]] and [[Rylin Coil]] again', noItems), [{ page: 'Rylin Coil' }])
})

test('REAL PAGE: Hate, Betrayal, and Trust keeps its steps and gains exactly the places they state', () => {
  const p = parseQuestPage('Hate, Betrayal, and Trust', page(72694), (t) => /Ring|Sapphire|Setter|Blessing/.test(t))
  assert.equal(p.steps.length, 7)
  assert.equal(p.stepLinks.length, 7)
  assert.equal(p.stepLocs.length, 7)
  assert.ok(p.steps[3].startsWith("Tell Rylin Coil in Ak'Anon, at (1469, -190)"), p.steps[3])
  const pts = p.stepLocs.map((s) => s.map((l) => formatPoint(l)))
  assert.deepEqual(pts, [['(201, -97, -7)'], ['(2662, 1238, -119)'], ['(107, -438)'], ['(1469, -190)'], [], ['(-90, 287, 127)'], []])
  // Each coordinate's offset points at its own text in the step.
  p.stepLocs.forEach((locs, i) => {
    for (const l of locs) assert.ok(p.steps[i].slice(l.at).startsWith(formatPoint(l).slice(1, -1).split(',')[0]), `${String(i)}: ${p.steps[i]}`)
  })
  assert.deepEqual(p.stepLinks[2], [
    { page: 'Merchant Tyslin (North Felwithe)', label: 'Merchant Tyslin' },
    { page: 'Felwithe', label: 'Northern Felwithe' }
  ])
  assert.deepEqual(p.stepLinks[3], [{ page: 'Rylin Coil' }, { page: "Ak'Anon" }])
  // No coordinate here came from a template, so none carries a template zone.
  assert.ok(p.stepLocs.flat().every((l) => l.zone === undefined))
})

test('REAL PAGE: a {{Loc}} page keeps its template zone and its step count', () => {
  const p = parseQuestPage("Jillin's Stew", page(15559))
  const withZone = p.stepLocs.flat().filter((l) => l.zone !== undefined)
  assert.ok(withZone.length >= 2, JSON.stringify(p.stepLocs))
  assert.ok(withZone.every((l) => l.zone === 'Rivervale'))
  assert.ok(p.steps.some((s) => s.includes('Rivervale (-49, -177)')), p.steps.join(' | '))
})

test('TICK LAW: rendering {{Loc}} moves no step — every cached page has the step COUNT it had without it', () => {
  const pages = JSON.parse(readFileSync(join(CACHE, 'quest-pages.json'), 'utf8')) as { pageid: number; title: string }[]
  let checked = 0
  for (const p of pages) {
    let wt: string
    try {
      wt = page(p.pageid)
    } catch {
      continue
    }
    if (!/\{\{\s*loc\s*\|/i.test(wt)) continue
    checked++
    // The old behaviour: the template simply vanished.
    const before = parseQuestPage(p.title, wt.replace(/\{\{\s*loc\s*\|[^{}]*\}\}/gi, ' ')).steps
    const after = parseQuestPage(p.title, wt).steps
    assert.equal(after.length, before.length, p.title)
  }
  assert.ok(checked >= 25, `pages with a {{Loc}}: ${String(checked)}`)
})

test('CATALOG LAW: stepLinks and stepLocs are index-aligned with steps, and every offset is in range', () => {
  for (const q of catalog) {
    const n = q.steps?.length ?? 0
    if (q.stepLinks) assert.equal(q.stepLinks.length, n, q.page)
    if (q.stepLocs) assert.equal(q.stepLocs.length, n, q.page)
    q.stepLocs?.forEach((locs, i) => {
      for (const l of locs) assert.ok(l.at >= 0 && l.at < (q.steps?.[i]?.length ?? 0), `${q.page} #${String(i)}`)
    })
  }
})

test('CATALOG LAW: the per-step facts exist where the wiki states them (floors, not counts)', () => {
  const withLocs = catalog.filter((q) => q.stepLocs).length
  const points = catalog.flatMap((q) => q.stepLocs ?? []).flat().length
  assert.ok(withLocs >= 400, `quests with a stated coordinate: ${String(withLocs)}`)
  assert.ok(points >= 700, `stated coordinates: ${String(points)}`)
  // Every {{Loc}} on the cached pages survives as a coordinate with its zone.
  assert.ok(catalog.flatMap((q) => q.stepLocs ?? []).flat().filter((l) => l.zone !== undefined).length >= 50)
})
