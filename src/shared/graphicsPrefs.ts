// shared/graphicsPrefs.ts — THE PURE HALF of graphics compatibility (JOS-40).
//
// WHY THIS EXISTS. A player on an RTX 5080 (driver 591.86, Windows 11) reported the floating
// overlays producing black-screen artifacting. The overlays are transparent, frameless,
// always-on-top windows — the one window shape whose correctness depends entirely on the
// driver's per-pixel alpha compositing — and there is no way to reproduce that here. So the app
// ships the two SELF-SERVE switches that between them retire both halves of the risk:
//
//   safeMode        — draw without the graphics card at all (`app.disableHardwareAcceleration()`).
//                     Whole-app, decided before Electron is ready, so it is a NEXT-LAUNCH setting
//                     by construction rather than by policy.
//   opaqueOverlays  — build the overlay windows WITHOUT transparency, on a solid background the
//                     same colour they already paint. Per-window, so it applies when an overlay
//                     is next opened.
//
// It is a ZERO-IMPORT module for the same reason `shared/perf.ts` and `shared/telemetry.ts` are:
// `storeMigrations.ts` runs from store.ts's module scope, before electron-store exists, and needs
// this normalizer without dragging the LogEvent union in behind it. No Electron, no Node — so
// `tests/graphicsPrefs.test.mts` pins every rule that decides what a switch MEANS.
//
// GENERIC ON PURPOSE — NO WINE DETECTION HERE. The env var below is the door a launcher script, a
// Wine prefix or a support reply can reach without the app's UI, which matters precisely in the
// case these switches exist for: a window you cannot see is a window whose Preferences you cannot
// open. Nothing in this module knows what a Wine prefix is, and nothing should.
//
// JOS-31 KEPT THAT PROMISE AND STILL AUTOMATED THE FALLBACK. The env door turned out not to be
// enough on its own: a user whose overlay is a stuck black box does not know there is a variable,
// and telling them to find one is a support reply we would have to write for every one of them.
// So this module grew a THIRD state per switch — `auto` — and a pure `resolveGraphics` that folds
// a stored preference together with what the RUNTIME recommends. What does the recommending is
// somebody else's problem (src/shared/wineDetect.ts decides, src/main/wine.ts wires it): this file
// takes a `GraphicsAuto` of two booleans and could not tell you where they came from. That is the
// same seam `envDisablesGpu` already drew, one level up.

/**
 * One switch's stored value. THREE states, because two cannot express the thing this ticket
 * needs: "leave it to the app" and "off, and I mean it" are different answers, and under a
 * detected Wine prefix they produce opposite windows.
 *
 *   'auto' — the default. The app decides from the environment it finds itself in (today: a Wine
 *            prefix turns OPAQUE OVERLAYS on and leaves safe mode off — JOS-352 inverted the
 *            second half, since safe mode is itself what blanks a window under Wine; everywhere
 *            else `auto` resolves to OFF).
 *   'on'   — the user asked for the compatibility path, wherever they are running.
 *   'off'  — the user REFUSED it, wherever they are running. This is the state that did not exist
 *            before, and without it detection would be a trap rather than a default: a Wine user
 *            who prefers see-through overlays could never get them back.
 */
import { PALETTE } from './palette'

export type GraphicsSwitch = 'auto' | 'on' | 'off'

/** Every legal value, for the normalizer and for anything that wants to enumerate them. */
export const GRAPHICS_SWITCHES: readonly GraphicsSwitch[] = ['auto', 'on', 'off']

/**
 * The two switches, persisted as one top-level `graphics` blob (store schema v11).
 *
 * BOTH DEFAULT TO `auto`, and the policy underneath is unchanged from JOS-40: on a machine that
 * shows no sign of needing a compatibility mode, `auto` resolves to OFF. Hardware acceleration
 * and a see-through overlay are still what everyone gets by default; `auto` only means the app is
 * allowed to notice a machine that cannot have them.
 */
export interface GraphicsPrefs {
  /**
   * Draw the whole app in software (`app.disableHardwareAcceleration()`), from the next launch.
   * NEXT LAUNCH IS STRUCTURAL: Electron only accepts that call before the `ready` event, so
   * there is no version of this switch that could take effect mid-session.
   */
  safeMode: GraphicsSwitch
  /**
   * Build the floating overlays as ordinary opaque windows on a solid background instead of
   * transparent ones. Applies to each overlay the next time it is OPENED — a window's
   * transparency is fixed at construction and cannot be changed on a live one.
   */
  opaqueOverlays: GraphicsSwitch
}

export const DEFAULT_GRAPHICS_PREFS: GraphicsPrefs = { safeMode: 'auto', opaqueOverlays: 'auto' }

/**
 * The environment variable that forces safe mode for ONE launch, whatever the stored setting
 * says. Its whole reason for existing is the case where the app's own UI is unreachable.
 */
export const GPU_ENV_VAR = 'EQ_DISABLE_GPU'

/** The truthy spellings accepted for `EQ_DISABLE_GPU`. A support reply says "set it to 1"; a
 *  shell script may well say `true`. Both are the same instruction, and `0`/`false`/empty are
 *  the same non-instruction — an env var that is SET TO OFF must not turn the thing on. */
const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

/**
 * Does this environment force graphics safe mode? Takes the env map rather than reading
 * `process.env` so it is pure and testable, and so JOS-31 can ask the same question of a
 * launcher's environment without a second opinion about what counts as "set".
 */
export function envDisablesGpu(env: Record<string, string | undefined>): boolean {
  const raw = env[GPU_ENV_VAR]
  return typeof raw === 'string' && TRUTHY.has(raw.trim().toLowerCase())
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * One field, from `unknown`. A legal spelling survives; anything else is the default.
 *
 * A BOOLEAN IS READ AS A LITERAL CHOICE (`true` → 'on', `false` → 'off') and NOT as 'auto'. That
 * is the only reading available to a function with no history: a boolean arriving here now is a
 * hand-edited file or an old renderer, and both of them mean the two things a boolean can mean.
 * The one place where `false` means something ELSE — a v10 store, where `false` was equally the
 * value nobody ever touched — is the 10 → 11 migration, which is exactly where a question about
 * history belongs. It converts before this function ever sees the blob.
 */
function switchOf(value: unknown, fallback: GraphicsSwitch): GraphicsSwitch {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string' && (GRAPHICS_SWITCHES as readonly string[]).includes(value)) {
    return value as GraphicsSwitch
  }
  return fallback
}

/** Defaulted field by field, from `unknown`: the same value arrives from the store file, from a
 *  renderer toggle and from the 10 → 11 migration. Never throws, never returns a partial. */
export function normalizeGraphicsPrefs(value: unknown): GraphicsPrefs {
  const v = isPlainObject(value) ? value : {}
  return {
    safeMode: switchOf(v.safeMode, DEFAULT_GRAPHICS_PREFS.safeMode),
    opaqueOverlays: switchOf(v.opaqueOverlays, DEFAULT_GRAPHICS_PREFS.opaqueOverlays)
  }
}

// ---- Resolution: stored preference + what the environment recommends -> what this launch does --
//
// PRECEDENCE, and there are only three rungs: an explicit user preference wins over everything,
// detection speaks only into `auto`, and `auto` with nothing detected is OFF. Every consumer —
// the composition root deciding safe mode, the window factory deciding transparency, and the
// Preferences card explaining itself — reads THIS function, so none of them can hold a fourth
// opinion about who wins.

/**
 * What the runtime environment recommends for each switch when the stored value is `auto`.
 * Two booleans and no provenance: this module does not know, and must not know, whether the
 * recommendation came from a Wine prefix, a driver blocklist or a coin.
 */
export interface GraphicsAuto {
  safeMode: boolean
  opaqueOverlays: boolean
}

/** The recommendation on an ordinary machine: nothing to compensate for. */
export const NO_GRAPHICS_AUTO: GraphicsAuto = { safeMode: false, opaqueOverlays: false }

/**
 * WHY a switch is on or off for this launch — the honesty half, and the reason the Preferences
 * card can say "Wine detected" instead of silently disagreeing with its own toggle.
 *
 *   'user'    — the stored preference said 'on' or 'off'.
 *   'auto'    — the preference was 'auto' and the environment asked for the compatibility path.
 *   'default' — the preference was 'auto' and nothing asked for anything.
 */
export type GraphicsSource = 'user' | 'auto' | 'default'

export interface ResolvedSwitch {
  /** Is the compatibility path on for this launch? */
  on: boolean
  source: GraphicsSource
}

export interface ResolvedGraphics {
  safeMode: ResolvedSwitch
  opaqueOverlays: ResolvedSwitch
}

/** One switch, resolved. `off` is a real answer that beats detection — see `GraphicsSwitch`. */
export function resolveGraphicsSwitch(pref: GraphicsSwitch, auto: boolean): ResolvedSwitch {
  if (pref === 'on') return { on: true, source: 'user' }
  if (pref === 'off') return { on: false, source: 'user' }
  return auto ? { on: true, source: 'auto' } : { on: false, source: 'default' }
}

/** Both switches, resolved against one environment recommendation. */
export function resolveGraphics(
  prefs: GraphicsPrefs,
  auto: GraphicsAuto = NO_GRAPHICS_AUTO
): ResolvedGraphics {
  return {
    safeMode: resolveGraphicsSwitch(prefs.safeMode, auto.safeMode),
    opaqueOverlays: resolveGraphicsSwitch(prefs.opaqueOverlays, auto.opaqueOverlays)
  }
}

/** A transparent window's `backgroundColor`: fully transparent black, so element rgba does all
 *  of the translucency (windows.ts has always said so — this is that value, named). */
export const TRANSPARENT_OVERLAY_BG = '#00000000'

/**
 * The SOLID background an opaque overlay is built on — deliberately the exact RGB every overlay
 * already paints (`withAlpha(PALETTE.bg, bgAlpha)` in OverlayMeter / HealMeter / EventLogOverlay).
 *
 * That identity is what makes this a compatibility switch rather than a theme: the page's own
 * translucent panel composites onto a window of the SAME colour, so the result is the overlay at
 * full opacity — the bgAlpha look with the alpha taken out — instead of some second palette
 * nobody chose. The alpha slider keeps working; it simply has nothing left to show through to.
 */
export const OPAQUE_OVERLAY_BG: string = PALETTE.bg

/** The `backgroundColor` an overlay window is constructed with, given the switch. */
export function overlayBackgroundColor(opaque: boolean): string {
  return opaque ? OPAQUE_OVERLAY_BG : TRANSPARENT_OVERLAY_BG
}
