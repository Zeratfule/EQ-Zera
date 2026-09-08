// E2E FIXTURE EXTRACTOR — one committed log per e2e spec (docs/plans/e2e-parallel.md, wave E2).
//
// WHY IT EXISTS. Until this landed, every spec in tests/e2e/ launched the app against the
// OWNER'S LIVE LOG: 1.4M lines, still growing, different on every machine and different from
// itself an hour later. That made a red spec ambiguous ("bug, or quiet log?"), made ~10.8 s of
// redundant hydration the price of every one of the suite's launches, and pushed a dozen
// assertions down to "note()" branches that never actually assert anything. Each spec now
// replays a SMALL, COMMITTED slice instead — the same bytes on every machine, forever — and
// the "live gameplay" half is scripted by the harness appending lines to the tailed copy
// (tests/e2e/logFixture.mts, the append driver).
//
// WHAT IS EMITTED. One `tests/fixtures/e2e-<spec>.log` per spec, cut from the REAL log and
// routed through the shared scrub (tests/fixture-scrub.mjs → src/shared/logScrub.ts) exactly
// like every other extractor in this directory. Never hand-copy a raw span in here: the repo
// is public and the scrub is the only thing standing between a bystander's chat and GitHub.
//
// THE SPANS ARE STATED, NOT GUESSED. Each entry below names the real line range it cuts and
// what that range CONTAINS — the fights, the zone changes, the loot, the dings — because that
// content is what the spec's assertions rest on. The ranges are re-derivable: the anchors are
// printed as the first/last kept line of every emitted file.
//
// A fixture is MINIMAL on purpose. The smallest slice that still supports the spec's
// assertions is the right one: it replays in milliseconds, it is readable by hand when a
// spec goes red, and it keeps a public repo from carrying a hundred megabytes of one person's
// evenings.
//
// Usage (the loader matters — the shared scrub is TypeScript):
//   node --import tsx tests/extract-e2e-fixtures.mjs "<path to eqlog_Primitive_freeport.txt>"

import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { scrubKeep } from './fixture-scrub.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const LOG = process.argv[2]
if (!LOG) {
  console.error('usage: node --import tsx tests/extract-e2e-fixtures.mjs "<path to eqlog_*.txt>"')
  process.exit(1)
}
const lines = readFileSync(LOG, 'utf8').split(/\r?\n/)

/** The leveling tab's inputs: what the progression + leveling + combo modules actually read. */
const LEVELING_KEEP = [
  /You have gained a level! Welcome to level \d+!$/,
  // BOTH gain shapes — the singular "an ability point" is the common one on this character.
  /You have gained (?:an|\d+) ability point/,
  /You have gained the ability "/,
  /You have improved .+ \d+ at a cost of/,
  // Zone lines drive the band strip AND the range panel's per-zone rows.
  /You have entered /,
  // The progression columns the range panel reports: experience and credited kills.
  /You gain (?:party )?experience/,
  /has been slain by|You have slain /,
  // The self /who — the ONLY line that states the class loadout, and what the combo module
  // needs before "New at this level" can name a loadout instead of refusing.
  /^\[[^\]]+\] \[\d+ [A-Z]{3}(?:\/[A-Z]{3})*\] Primitive /
]

/** A world-only slice: where you are and what you killed. Enough to mount every feature view. */
const WORLD_KEEP = [
  /You have entered /,
  /You gain (?:party )?experience/,
  /has been slain by|You have slain /,
  /--You have looted/
]

/**
 * ONE fixture: the file it writes, the real line spans it cuts (in time order — a gap between
 * spans reads exactly like a player logging off), an optional keep-filter on top of the scrub,
 * and the sentence that says what the spec needs out of it.
 */
const FIXTURES_SPEC = [
  {
    out: 'e2e-combat.log',
    why: 'combat-dashboard: two credited kills (a fire giant warrior, Lord Nagafen), three zone lines (so the selector has finalized zone sessions AND finalized fights), three loot lines, procs, stances, heals.',
    spans: [[1396400, 1399240]]
  },
  {
    out: 'e2e-overview.log',
    why: 'overview: a credited Lord Nagafen kill with damage (the DPS card), two loot lines (the drops feed + its deep link into the Loot pane) and two zone lines (the zone strip).',
    spans: [[1393700, 1394400]]
  },
  {
    out: 'e2e-deep-link.log',
    why: 'deep-link-back: the Overview needs a DROP row and a KILL row to click through, so this is the tightest slice that has both — two loot lines off a credited Lord Nagafen kill, plus the zone lines around them.',
    spans: [[1393850, 1394200]]
  },
  {
    out: 'e2e-timeline.log',
    why: 'timeline: one long Lord Nagafen fight with a dense per-event ring — the timeline needs a selection that HAS a ring — plus the zone changes that finalize it.',
    spans: [[1398000, 1399240]]
  },
  {
    out: 'e2e-copy.log',
    why: 'copy: a single dense fight, so the meter always has rows to serialize and a copy affordance to click.',
    spans: [[1397000, 1398200]]
  },
  {
    out: 'e2e-overlay.log',
    why: 'overlay-sync: at least one FINALIZED fight (the fire giant warrior dies mid-slice) for the cross-window selection steps, and bars for the overlay drill.',
    spans: [[1396800, 1398400]]
  },
  {
    out: 'e2e-leveling.log',
    why: 'leveling: three dings (48→50), seventeen AA gains and five purchases (the ledger + its reconciliation identity), 47 zone lines (the band strip and the range panel’s zone rows), experience and kill lines (the range panel’s hero cards) — plus the Jul 31 self /who, the ONE line that states the class loadout the unlock panel computes against.',
    spans: [
      [782732, 782732],
      [1240000, 1382000]
    ],
    keep: LEVELING_KEEP
  },
  {
    out: 'e2e-maps.log',
    why: 'maps: the zone lines alone. The last one (The Southern Desert of Ro) is the zone the viewer must auto-open, and it is a zone every EQ map pack ships.',
    spans: [[1399150, 1399300]],
    keep: WORLD_KEEP
  },
  {
    out: 'e2e-planner.log',
    why: 'planner: the pane is computed from the committed item DB, so this only has to make the app have a character at all — the smallest world slice there is.',
    spans: [[1399150, 1399300]],
    keep: WORLD_KEEP
  },
  {
    out: 'e2e-feedback.log',
    why: 'feedback: a DENSE tail. main’s slice anchors on the last timestamped line and windows BACKWARDS from it (never Date.now()), so what this fixture has to guarantee is that the minutes before its final line are full — a slice window that lands in a quiet stretch produces the honest "nothing to send" state and asserts nothing.',
    spans: [[1398500, 1399240]]
  },
  {
    out: 'e2e-perf.log',
    why: 'perf: a slice with enough events that the replay phase is a real phase (eventsReplayed > 0) without making the launch wait on one.',
    spans: [[1397500, 1398600]]
  },
  {
    out: 'e2e-telemetry.log',
    why: 'telemetry: four launches, none of which reads the log at all — the smallest world slice keeps all four fast.',
    spans: [[1399150, 1399300]],
    keep: WORLD_KEEP
  },
  {
    out: 'e2e-toast.log',
    why: 'toast: the deep links need a mounted feature view and nothing else from the log.',
    spans: [[1399150, 1399300]],
    keep: WORLD_KEEP
  },
  {
    out: 'e2e-voice.log',
    why: 'voice-alerts: alerts are seeded from the store, not the log; this only has to make the app have a character.',
    spans: [[1399150, 1399300]],
    keep: WORLD_KEEP
  }
]

/** Cut one fixture and report what it actually captured, so a moved span is visible. */
function emit({ out, spans, keep }) {
  const seg = []
  for (const [from, to] of spans) {
    for (let i = from - 1; i < to && i < lines.length; i++) {
      const l = lines[i]
      if (!l.startsWith('[')) continue
      if (!scrubKeep(l)) continue
      if (keep && !keep.some((re) => re.test(l))) continue
      seg.push(l)
    }
  }
  writeFileSync(join(FIXTURES, out), `${seg.join('\n')}\n`)
  const kb = Math.round(seg.join('\n').length / 1024)
  console.log(`${out}: ${seg.length} lines (${kb} KB)`)
  console.log(`  from ${seg[0]?.slice(0, 26) ?? '?'}  to ${seg[seg.length - 1]?.slice(0, 26) ?? '?'}`)
}

for (const f of FIXTURES_SPEC) emit(f)
