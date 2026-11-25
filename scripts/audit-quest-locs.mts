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

const DATA = join(import.meta.dirname, '..', 'src', 'renderer', 'src', 'data', 'eqlegends')
const quests = (JSON.parse(readFileSync(join(DATA, 'quests.json'), 'utf8')) as QuestData).quests
const mobs = (JSON.parse(readFileSync(join(DATA, 'mobs.json'), 'utf8')) as MobData).mobs
const index = buildMobIndex(mobs, quests.map((q) => q.page))
const summaryOnly = process.argv.includes('--summary')

const fmt = (l: { ns: number; ew: number; z?: number }): string => `(${[l.ns, l.ew, ...(l.z === undefined ? [] : [l.z])].join(', ')})`

/** The prefix rules, in order: the first `why` pattern that matches names the rule. */
const RULES: [RegExp, string][] = [
  [/but the point lies outside/, "VETO: point outside the zone's known spread"],
  [/^the \{\{Loc\}\} template says/, '{{Loc}} zone sharpened by the words'],
  [/^the \{\{Loc\}\}/, '{{Loc}} template zone'],
  [/already left/, 'start zone refused: the walkthrough moved on'],
  [/^the step names no zone/, 'quest start zone (step names no zone)'],
  [/ says .*; its NPC lives in/, 'city name + NPC zone inside it'],
  [/names \d+ zones; its NPC lives in/, 'several zones, the linked NPC picks one'],
  [/links NPCs in/, 'linked NPCs in different zones'],
  [/mentions .*, not the start zone/, 'start zone refused: the step mentions another zone'],
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

for (const q of quests) {
  const locs = questLocations(q, index)
  tallyQuest(q, locs)
  auditSteps(q, locs)
}

const c = counts
console.log('\n===== summary =====')
console.log(`coordinate steps: ${String(c.coordSteps)} (${String(quests.filter((q) => q.stepLocs).length)} quests), coordinates: ${String(c.coords)}`)
console.log(`  map jump: ${String(c.mapped)}   zone named but no map: ${String(c.named)}   no zone: ${String(c.coords - c.mapped - c.named)}`)
for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`)
console.log(`quests with >=1 location chip or item source: ${String(c.questsWithChip)} / ${String(quests.length)}  (with a map jump: ${String(c.questsWithJump)})`)
console.log(`required-item refs: ${String(c.itemRefs)}, with a dropping mob: ${String(c.itemsWithSource)}, with a located dropper: ${String(c.itemsLocated)}`)
