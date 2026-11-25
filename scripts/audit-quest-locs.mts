/**
 * AUDIT, NOT SHIPPED: every coordinate a quest step states, the zone the resolver gave it, and
 * the rule that decided (src/shared/questLocZones.ts). Read the output when a rule changes.
 *
 *   node --import tsx scripts/audit-quest-locs.mts            # every coordinate step
 *   node --import tsx scripts/audit-quest-locs.mts --summary  # the counts only
 *
 * Offline: reads the committed quests.json and mobs.json, nothing else.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MobData, QuestData, QuestEntry } from '../src/shared/types'
import { buildMobIndex, questLocations, type MobIndex, type QuestLocChip, type QuestLocations } from '../src/shared/questLocations'
import { SAME_POINT, zonesNamed } from '../src/shared/questLocZones'

const DATA = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'data', 'eqlegends')
const quests = (JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf8')) as QuestData).quests
const mobs = (JSON.parse(readFileSync(join(DATA, 'mobs.json'), 'utf8')) as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))
const summaryOnly = process.argv.includes('--summary')

const fmt = (l: { ns: number; ew: number; z?: number }): string => `(${[l.ns, l.ew, ...(l.z === undefined ? [] : [l.z])].join(', ')})`

/** The prefix rules, in order: the first `why` pattern that matches names the rule. */
const RULES: [RegExp, string][] = [
  [/but the bestiary puts/, 'REFUSED: another zone’s mob stands at this point'],
  [/own page puts them at this point/, 'a named mob’s own point picks the zone'],
  [/but the point lies outside/, "VETO: point outside the zone's known spread"],
  [/but its NPC's page says/, 'REFUSED: named zone vs the linked NPC’s own zone'],
  [/^the \{\{Loc\}\} template says/, '{{Loc}} zone sharpened by the words'],
  [/^the \{\{Loc\}\}/, '{{Loc}} template zone'],
  [/the walkthrough was last in/, 'trail zone (step names no zone; last zone entered)'],
  [/^the step names no zone/, 'quest start zone (step names no zone)'],
  [/ says .*; its NPC lives in/, 'city name + NPC zone inside it'],
  [/names \d+ zones; its NPC lives in/, 'several zones, the linked NPC picks one'],
  [/links NPCs in/, 'linked NPCs in different zones'],
  [/^the step mentions /, 'fallback refused: the step mentions another zone'],
  [/^the sentence mentions/, 'refused: the sentence mentions another zone'],
  [/linked in the (sentence|clause)/, 'NPC linked in the clause/sentence'],
  [/linked in the step/, 'NPC linked in the step'],
  [/^the (sentence|step|clause) names .*, /, 'several zones named'],
  [/^the (sentence|step|clause) names /, 'one zone named']
]

function rule(why: string): string {
  return RULES.find(([re]) => re.test(why))?.[1] ?? why
}

function outcome(c: QuestLocChip): string {
  if (c.zone !== undefined) return 'MAP'
  return c.zoneName === undefined ? 'NO ZONE' : 'ZONE, NO MAP'
}

function describe(c: QuestLocChip, ix: MobIndex): string {
  const outside = c.zone !== undefined && c.loc !== undefined && ix.within(c.zone, c.loc) === false ? ' OUTSIDE-SPREAD' : ''
  const named = c.zoneName === undefined ? 'NO ZONE' : `${c.zoneName} (no map)`
  const where = c.zone === undefined ? named : `${c.zoneName ?? ''} -> ${c.zone}${outside}`
  return `  ${fmt(c.loc ?? { ns: 0, ew: 0 })}${c.name ? ` ${c.name}` : ''} => ${where}  [${c.sources.join('+')}] because ${c.why}`
}

const counts = { coordSteps: 0, coords: 0, mapped: 0, named: 0, questsWithChip: 0, questsWithJump: 0, itemRefs: 0, itemsWithSource: 0, itemsLocated: 0 }
const reasons = new Map<string, number>()

const jumpable = (c: QuestLocChip): boolean => c.zone !== undefined && c.loc !== undefined

function tallyQuest(q: QuestEntry, locs: QuestLocations): void {
  const all = [...locs.steps.flat(), ...locs.npcs.flatMap((n) => n.chips)]
  const located = locs.items.filter((i) => i.rows.some((r) => r.zone !== undefined && r.points.length > 0))
  if (all.length > 0 || locs.items.length > 0) counts.questsWithChip++
  if (all.some(jumpable) || located.length > 0) counts.questsWithJump++
  counts.itemRefs += q.requiredItems?.length ?? 0
  counts.itemsWithSource += locs.items.length
  counts.itemsLocated += located.length
}

function tallyCoord(c: QuestLocChip): void {
  counts.coords++
  if (c.zone !== undefined) counts.mapped++
  else if (c.zoneName !== undefined) counts.named++
  const bucket = `${outcome(c)} · ${rule(c.why)}`
  reasons.set(bucket, (reasons.get(bucket) ?? 0) + 1)
  if (!summaryOnly) console.log(describe(c, index))
}

function auditSteps(q: QuestEntry, locs: QuestLocations): void {
  ;(q.stepLocs ?? []).forEach((stepLocs, i) => {
    if (stepLocs.length === 0) return
    counts.coordSteps++
    if (!summaryOnly) console.log(`\n[${q.page}] step ${String(i + 1)} (start zone: ${q.startZone ?? '-'})\n  ${q.steps?.[i] ?? ''}`)
    for (const c of locs.steps[i].filter((x) => x.sources.includes('quest'))) tallyCoord(c)
  })
}

/**
 * THE CROSS-CHECKS (review of 4b66753). (1) Every quest coordinate that got a map, against the
 * bestiary: a mob of ANOTHER zone standing within SAME_POINT units while none of the chosen zone
 * does is a conflict. (2) Every coordinate placed by the quest's START zone, against the zones its
 * earlier steps name at all: a different zone named earlier is a fallback worth reading.
 */
const conflicts: string[] = []
const fallbackDoubts: string[] = []
const coincidences: string[] = []

function crossChecks(q: QuestEntry, locs: QuestLocations): void {
  locs.steps.forEach((chips, i) => {
    for (const c of chips) {
      if (!c.sources.includes('quest') || c.zone === undefined || c.loc === undefined) continue
      const near = index.nearby(c.loc, SAME_POINT)
      if (near.length > 0 && !near.some((m) => m.zone.stem === c.zone)) {
        // A zone the step's own words state, against an UNNAMED mob elsewhere: chance, read and listed.
        ;(c.why.includes('the step names no zone') ? conflicts : coincidences).push(`[${q.page}] step ${String(i + 1)} ${fmt(c.loc)} -> ${c.zone}; bestiary: ${near.map((m) => `${m.name} (${m.zone.stem ?? m.zone.name})`).join(', ')}`)
      }
      if (!c.why.includes('the quest starts in')) continue
      const before = (q.steps ?? []).slice(0, i).flatMap((s, k) => zonesNamed(s, q.stepLinks?.[k] ?? [], []))
      const other = [...new Set(before.filter((z) => z.stem !== c.zone).map((z) => z.name))]
      if (other.length > 0) fallbackDoubts.push(`[${q.page}] step ${String(i + 1)} ${fmt(c.loc)} -> ${c.zone}; earlier steps name ${other.join(', ')}`)
    }
  })
}

for (const q of quests) {
  const locs = questLocations(q, index)
  tallyQuest(q, locs)
  auditSteps(q, locs)
  crossChecks(q, locs)
}

console.log(`\n===== cross-check 1: quest coordinate vs another zone's bestiary point (±${String(SAME_POINT)}) =====`)
for (const l of conflicts) console.log(`  ${l}`)
console.log(`  ${String(conflicts.length)} conflicts on a fallback zone (must be 0)`)
console.log('  …and against a zone the step STATES (not refused; chance collisions, read them):')
for (const l of coincidences) console.log(`    ${l}`)
console.log(`  ${String(coincidences.length)} coincidences`)
console.log('\n===== cross-check 2: start-zone fallback vs zones named in EARLIER steps =====')
for (const l of fallbackDoubts) console.log(`  ${l}`)
console.log(`  ${String(fallbackDoubts.length)} to read`)

const c = counts
console.log('\n===== summary =====')
console.log(`coordinate steps: ${String(c.coordSteps)} (${String(quests.filter((q) => q.stepLocs).length)} quests), coordinates: ${String(c.coords)}`)
console.log(`  map jump: ${String(c.mapped)}   zone named but no map: ${String(c.named)}   no zone: ${String(c.coords - c.mapped - c.named)}`)
for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
console.log(`quests with >=1 location chip or item source: ${String(c.questsWithChip)} / ${String(quests.length)}  (with a map jump: ${String(c.questsWithJump)})`)
console.log(`required-item refs: ${String(c.itemRefs)}, with a dropping mob: ${String(c.itemsWithSource)}, with a located dropper: ${String(c.itemsLocated)}`)
