// ============================================================================
// smokeLog.mts — the MOCKED EverQuest log the post-release smoke test plants.
// ============================================================================
//
// PURE. Zero imports, no `node:`, no Electron, no fs. It hands back lines and a rendered
// string; whoever writes them to disk is somebody else's problem. That is what lets
// `tests/smokeFeedback.test.mts` run every generated line through the REAL shared scrub
// (`src/shared/logScrub.ts`) and prove the two classes are what this file claims they are.
//
// WHY A MOCK AT ALL. The smoke test runs in a pristine Windows Sandbox: no EverQuest, no
// logs, nothing for the app to slice. Without a log the report would attach nothing and the
// most interesting half of the pipeline — build a slice, scrub it, presign, upload, and prove
// on the other end that the scrub actually happened — would never run. So we synthesize a log
// that is deliberately BOOBY-TRAPPED:
//
//   * every COMBAT line carries the run's NONCE. The scrub must keep them, so the slice that
//     lands in S3 must contain the nonce. That is the proof the pipeline carried real content.
//   * every CHAT line carries `CHAT_MARKER` and NO nonce. The scrub must drop them, so the
//     slice that lands in S3 must NOT contain the marker. That is the proof the scrub ran on
//     the real path — not in a unit test, but through the shipped installer, the live Lambda
//     and the live bucket.
//   * FILLER lines carry neither. They exist so the slice looks like a real play window
//     rather than 200 copies of one sentence (gzip would make that meaningless as a size or
//     line-count signal).
//
// The line SHAPES are copied from `tests/fixtures/*.log` — the committed extracts of the real
// 1.02M-line log — never invented, for the same reason the scrub's families were enumerated by
// sweeping that log instead of guessing.
//
// THE SYNTHESIS HAPPENS ON THE HOST, not in the guest: the sandbox is a pristine Windows with
// no Node and no tsx, and a second PowerShell implementation of this file is exactly the
// "two lists that diverge" failure the shared scrub exists to prevent. The host writes the
// rendered log into the mapped results folder and the guest merely COPIES it to the discovery
// path. One synthesizer, one test, one artifact.

/** The character the mocked log belongs to — also the slice's `selfName`. */
export const SMOKE_SELF = 'Smoketest'
/** Its server, which only ever shows up in the log's filename. */
export const SMOKE_SERVER = 'freeport'
/** `eqlog_<Character>_<server>.txt` — the shape `parseLogName` (src/main/log/config.ts) reads. */
export const SMOKE_LOG_NAME = `eqlog_${SMOKE_SELF}_${SMOKE_SERVER}.txt`

/**
 * The token every CHAT line carries and no other line does. If this string is anywhere in the
 * slice that came back out of S3, the scrub did not run — which is a failure of the ONE
 * privacy promise this feature makes, and the smoke test says so in those words.
 *
 * No hyphens or spaces: it has to survive being grepped by PowerShell, by `Select-String` and
 * by a plain `String.includes`, and it must never be mistaken for a nonce.
 */
export const CHAT_MARKER = 'EQSMOKECHATLEAK'

/** Minutes of play the mocked log spans. The report attaches a 15-minute window, so 10 fits. */
export const SMOKE_SPAN_MINUTES = 10
/** Roughly how many lines to synthesize. Enough to look like play, small enough to eyeball. */
export const SMOKE_LINE_COUNT = 200

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

const pad2 = (n: number): string => String(n).padStart(2, '0')

/**
 * `Sat Aug 01 19:02:06 2026` — the exact prefix body `parseEqTimestamp` (src/main/log/parser.ts)
 * parses, built by hand rather than through `toDateString()` so it cannot drift with a locale.
 * LOCAL time, like the game writes it.
 */
export function eqStamp(ms: number): string {
  const d = new Date(ms)
  return (
    `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ` +
    String(d.getFullYear())
  )
}

/** What a synthesized line is FOR — and therefore what the scrub must do with it. */
export type SmokeLineKind = 'combat' | 'chat' | 'filler'

export interface SmokeLine {
  /** Epoch millis of the line's timestamp prefix. */
  readonly ts: number
  /** The line body, timestamp NOT included. */
  readonly body: string
  readonly kind: SmokeLineKind
}

/**
 * Keep-class combat, every variant carrying the nonce inside the mob's name.
 *
 * The mob name starts LOWERCASE on purpose in the two lines where it leads: the scrub's
 * social-emote rule is `^[A-Z][a-z'`]+ (waves|bows|…)`, and a capitalised subject is the one
 * shape that has to be reasoned about. Real EQ mob names are lowercase ("a lava duct crawler
 * bashes Sanvuk for 7 points of damage."), so this is what the log looks like anyway.
 */
function combatBody(nonce: string, i: number): string {
  const mob = `a smoketest golem ${nonce}`
  const dmg = 40 + ((i * 17) % 160)
  switch (i % 5) {
    case 0:
      return `You hit ${mob} for ${String(dmg)} points of damage.`
    case 1:
      return `You crush ${mob} for ${String(dmg)} points of damage.`
    case 2:
      return `${mob} hits YOU for ${String(dmg)} points of damage.`
    case 3:
      return `You have slain ${mob}!`
    default:
      return `${mob} has been slain by ${SMOKE_SELF}!`
  }
}

/**
 * Scrub-class chat, every variant carrying CHAT_MARKER and never the nonce.
 *
 * All five are the QUOTED-SPEECH family (`<sender> <verb>, '<text>'`) — the family a whole-log
 * sweep proved is completely characterised by "contains `, '`" — spread across the channels a
 * real player actually leaks into a bug report: a direct tell in both directions, open say,
 * and the two group forms.
 */
function chatBody(i: number): string {
  const tail = `${CHAT_MARKER} this line must never leave the machine`
  switch (i % 5) {
    case 0:
      return `Chatterbox tells you, '${tail}'`
    case 1:
      return `You told Chatterbox, '${tail}'`
    case 2:
      return `Chatterbox says, '${tail}'`
    case 3:
      return `Chatterbox tells the group, '${tail}'`
    default:
      return `You tell your party, '${tail}'`
  }
}

/** Keep-class background noise carrying NEITHER token: what a real window is mostly made of. */
function fillerBody(i: number): string {
  switch (i % 6) {
    case 0:
      return 'You are thirsty.'
    case 1:
      return 'You are hungry.'
    case 2:
      return 'Your Spirit of Wolf spell has worn off.'
    case 3:
      return 'You begin casting Center.'
    case 4:
      return 'You gain experience!!'
    default:
      return 'The cool breeze fades.'
  }
}

/**
 * Which kind line `i` is. Every 7th is chat (~28 of 200 — enough that a scrub failure is
 * unmissable, few enough that the window still reads as combat), then alternating
 * combat/filler. Deterministic: the same index always yields the same kind, so the test and
 * the artifact agree without either of them sharing state.
 */
function kindFor(i: number): SmokeLineKind {
  if (i % 7 === 3) return 'chat'
  return i % 2 === 0 ? 'combat' : 'filler'
}

export interface SmokeLogOptions {
  /** The run's nonce. Every combat line embeds it; nothing else does. */
  readonly nonce: string
  /** The timestamp of the LAST line. The slice anchors on it (feedback/slice.ts). */
  readonly nowMs: number
  readonly lineCount?: number
  readonly spanMinutes?: number
}

/**
 * The lines, in order, oldest first — the last one stamped exactly `nowMs`.
 *
 * The window anchor is the last line's timestamp, never `Date.now()` (slice.ts step 2), so
 * what matters here is that the SPAN is under the attached window, not that the clock agrees
 * with the host's. It is generated at launch time anyway, so both hold.
 *
 * Every timestamp is FLOORED TO THE SECOND. An EverQuest stamp has one-second resolution, so a
 * millisecond component would be silently lost on the way to disk and the file would no longer
 * round-trip through its own prefix — which is exactly what the test asserts, and exactly what
 * the app's slicer reads back.
 */
export function smokeLines(opts: SmokeLogOptions): SmokeLine[] {
  const count = Math.max(2, opts.lineCount ?? SMOKE_LINE_COUNT)
  const spanMs = (opts.spanMinutes ?? SMOKE_SPAN_MINUTES) * 60_000
  const startMs = opts.nowMs - spanMs
  const out: SmokeLine[] = []
  for (let i = 0; i < count; i++) {
    const ts = Math.floor((startMs + (i * spanMs) / (count - 1)) / 1000) * 1000
    const kind = kindFor(i)
    const body =
      kind === 'combat' ? combatBody(opts.nonce, i) : kind === 'chat' ? chatBody(i) : fillerBody(i)
    out.push({ ts, body, kind })
  }
  return out
}

/** `[Sat Aug 01 19:02:06 2026] <body>` — one synthesized line as it appears on disk. */
export function renderSmokeLine(line: SmokeLine): string {
  return `[${eqStamp(line.ts)}] ${line.body}`
}

/** The whole file, newline-terminated like the game's own log. */
export function synthesizeSmokeLog(opts: SmokeLogOptions): string {
  return `${smokeLines(opts).map(renderSmokeLine).join('\n')}\n`
}
