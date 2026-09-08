// GraphicsSetting — Preferences → Graphics (JOS-40).
//
// TWO SWITCHES FOR ONE SITUATION: the app, or its floating overlays, are drawing wrong on this
// machine's graphics driver. A player on a brand-new card reported the overlays producing
// black-screen artifacting; it cannot be reproduced here and they left no contact, so what ships
// is a way for anyone to fix it themselves. They are in ONE section because they are one story —
// try the cheap one, and if that is not it, try the other.
//
// STATE, NEVER PROCESS (the repo's UI law) AND THE CAVEAT DIET (AGENTS.md): each label is one
// plain sentence, and the sentence says WHEN it applies, because "I flipped it and nothing
// happened" is the only way either of these switches can be misread. Nothing here explains
// compositing, drivers or the GPU process — the user asked for a picture that works.
//
// …AND SINCE JOS-31 A SWITCH CAN BE ON WITHOUT ANYONE HAVING TOUCHED IT. A player running under
// Wine reported the celebration overlay becoming a stuck black box after a level-up
// (01KZGQZJ2HMZGRY28A7CVRG4QT), so the app now DETECTS a Wine prefix and takes the compatibility
// path by itself. That is a much better default and a much worse secret: a compatibility mode that
// engages silently is indistinguishable, from the user's chair, from the app being broken in a new
// way. So each caption states WHO decided — the honesty convention, applied to a decision the app
// made about the user rather than the other way round.
//
// …AND SINCE JOS-352 THE DETECTION SAYS THE OPPOSITE THING ABOUT THE FIRST SWITCH. A Wine prefix
// asks for opaque overlays and asks safe mode to stay OFF: on Windows, "draw without the graphics
// card" means Chromium's D3D11 WARP renderer, which Wine does not implement at all — the reported
// symptom is a white client area, from the compatibility path itself. So under Wine this card
// warns about the switch it used to set (SAFE_MODE_WINE_COPY below) instead of explaining it.
//
// THE TOGGLE IS THEIRS EITHER WAY. What each Switch shows is the EFFECTIVE state, and flipping one
// writes an EXPLICIT 'on'/'off' that outranks the detection in both directions (the stored value is
// three-state — shared/graphicsPrefs.ts). So the Wine user who prefers see-through overlays turns
// this off once and is obeyed, and the detection never becomes a one-way door on a whole platform.
//
// ONE BORDER: PreferencesView already wraps each item in an outlined Paper, so this renders bare
// Stacks.

import { type JSX, useCallback, useState } from 'react'
import { FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import MonitorIcon from '@mui/icons-material/Monitor'
import {
  resolveGraphics,
  type GraphicsPrefs,
  type ResolvedGraphics,
  type ResolvedSwitch
} from '@shared/graphicsPrefs'
import type { GraphicsEnvironment } from '@shared/wineDetect'
import { recordPref, usePrefsSeed } from './prefsHydration'
import type { PrefSection } from './PreferencesView'

interface GraphicsState {
  prefs: GraphicsPrefs
  env: GraphicsEnvironment
  /** The prefs folded against the machine, through the SAME function main used to build the
   *  windows — so the card cannot describe a precedence the app did not apply. */
  resolved: ResolvedGraphics
}

/**
 * The blob, SEEDED from the pane's hydration snapshot and written back on every change. The local
 * write is optimistic (a switch must not lag an IPC round trip) and main's reply is authoritative,
 * being what was actually stored.
 *
 * IT USED TO MOUNT ON `DEFAULT_GRAPHICS_PREFS` PLUS `NO_GRAPHICS_ENVIRONMENT` AND CORRECT BOTH
 * (JOS-340), which made this card the loudest flicker in the pane: on a Wine machine the two
 * switches painted OFF with an "off, your graphics card draws it" caption, and a moment later
 * flipped ON with the "Wine detected" one. Two reads, two corrections, one card that appeared to
 * change its mind about the machine it was running on. Both now arrive in the gate's snapshot
 * (./prefsHydration.tsx), so the first painted frame is the resolved truth.
 *
 * The ENVIRONMENT is still read once and never again: it is a fact about this launch (whether this
 * process is running inside a Wine prefix), and nothing the user does in Preferences can change it
 * — which is exactly why it belongs in a load-time snapshot.
 */
function useGraphicsPrefs(): [GraphicsState, (patch: Partial<GraphicsPrefs>) => void] {
  const seed = usePrefsSeed()
  const [prefs, setPrefs] = useState<GraphicsPrefs>(seed.graphics)
  const env: GraphicsEnvironment = seed.graphicsEnv

  const update = useCallback((patch: Partial<GraphicsPrefs>) => {
    setPrefs((cur) => ({ ...cur, ...patch }))
    void window.eq.setGraphicsPrefs(patch).then((stored) => {
      setPrefs(stored)
      recordPref('graphics', stored)
    })
  }, [])

  return [{ prefs, env, resolved: resolveGraphics(prefs, env.auto) }, update]
}

/**
 * The caption under one switch: what is true now, and who decided it.
 *
 * FOUR STATES AND NOT ONE OF THEM IS A PROCESS DESCRIPTION. `on`/`off` is the ordinary pair
 * JOS-40 shipped; `auto` is the app explaining a switch it set itself; and the fourth — an
 * explicit OFF on a machine where the detection wanted ON — is the one that would otherwise read
 * as the app ignoring the user. It says the detection saw something and that the user's answer
 * stands, which is exactly what happened.
 */
function caption(r: ResolvedSwitch, wanted: boolean, text: GraphicsCopy): string {
  if (r.source === 'auto') return text.auto
  if (r.on) return text.on
  return wanted ? text.overridden : text.off
}

interface GraphicsCopy {
  on: string
  off: string
  auto: string
  overridden: string
}

/**
 * The section descriptor, living with its card like `perfSection` does — PreferencesView is at
 * the 400-code-line factoring ceiling, and the words someone types to find this setting belong
 * beside the setting. The keywords carry the SYMPTOM vocabulary ("black", "flicker", "artifact",
 * "nvidia") as well as the mechanism, because a user in this situation searches for what they
 * are seeing, not for what it is called.
 */
export function graphicsSection(): PrefSection {
  return {
    id: 'graphics',
    label: 'Graphics',
    icon: <MonitorIcon fontSize="small" />,
    items: [
      {
        id: 'graphics-compat',
        label: 'Graphics compatibility',
        keywords:
          'graphics gpu video card driver nvidia amd intel rtx software rendering render acceleration hardware black blank screen flicker flickering artifact artifacting glitch corrupt transparent transparency opaque solid overlay overlays meter meters compatibility safe mode wine linux proton',
        content: <GraphicsSetting />
      }
    ]
  }
}

/**
 * The safe-mode caption in all four states, on an ordinary machine.
 *
 * TWO OF THESE ARE CURRENTLY UNREACHABLE AND THAT IS ON PURPOSE (JOS-352). Nothing recommends safe
 * mode any more — the Wine recommendation was INVERTED, because drawing without the graphics card
 * on Windows means D3D11 WARP and Wine does not implement it — so `auto` and `overridden` can only
 * be reached by some future detection. They are written for that reader rather than deleted: the
 * resolver still has four states, and copy that describes three of them would be the next reader's
 * bug.
 */
const SAFE_MODE_COPY: GraphicsCopy = {
  on: 'On from the next launch. Try this first if the app itself flickers, goes black, or will not paint.',
  off: 'Off. The app draws with your graphics card, which is what you want unless it is misbehaving.',
  auto: 'The app turned this on for this machine - it draws without the graphics card. Turn it off to use the graphics card anyway, from the next launch.',
  overridden:
    'Off, because you turned it off, on a machine where the app would have drawn without the graphics card.'
}

/**
 * …and the two states that read differently under Wine, where this switch is a TRAP rather than a
 * remedy (JOS-352). The old advice for a window that will not paint was "turn safe mode on", and
 * under Wine that is precisely what produces the white window: safe mode pins Chromium to a
 * software renderer Wine cannot provide, while the graphics card path works. Anyone arriving here
 * from that advice reads the sentence that matches their machine.
 */
const SAFE_MODE_WINE_COPY: GraphicsCopy = {
  ...SAFE_MODE_COPY,
  on: 'On, because you turned it on - and under Wine this is the setting that leaves the window blank or white. Turn it back off if nothing paints.',
  off: 'Off. The app draws with your graphics card, which is the path that works under Wine.'
}

/** The opaque-overlay caption in all four states — the one JOS-31 exists for. */
const OPAQUE_COPY: GraphicsCopy = {
  on: 'On for overlays you open from now on. Same meters, same colours, no see-through - reopen an overlay to apply it.',
  off: 'Off. Overlays float see-through over the game. Turn this on if they go black or leave marks on screen.',
  auto: 'Wine detected - overlays run opaque. Same meters, same colours, no see-through: under Wine a see-through overlay can stick on screen as a black box. Turn this off to keep them see-through.',
  overridden:
    'Off, because you turned it off. Wine was detected, where a see-through overlay can stick on screen as a black box.'
}

export function GraphicsSetting(): JSX.Element {
  const [{ env, resolved }, update] = useGraphicsPrefs()
  return (
    <Stack spacing={2} data-testid="pref-graphics">
      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-graphics-safe-mode"
              checked={resolved.safeMode.on}
              // A flip is a STATEMENT, never a return to 'auto': whichever way it goes it stores an
              // explicit value that outranks the detection from then on.
              onChange={(e) => update({ safeMode: e.target.checked ? 'on' : 'off' })}
            />
          }
          label={
            <Typography variant="body2">
              Draw without the graphics card, starting next launch
            </Typography>
          }
        />
        <Typography variant="caption" color="text.secondary" data-testid="pref-graphics-safe-mode-note">
          {caption(
            resolved.safeMode,
            env.auto.safeMode,
            env.wine ? SAFE_MODE_WINE_COPY : SAFE_MODE_COPY
          )}
        </Typography>
      </Stack>

      <Stack spacing={0.5}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              data-testid="pref-graphics-opaque-overlays"
              checked={resolved.opaqueOverlays.on}
              onChange={(e) => update({ opaqueOverlays: e.target.checked ? 'on' : 'off' })}
            />
          }
          label={
            <Typography variant="body2">
              Give floating overlays a solid background, from the next time you open one
            </Typography>
          }
        />
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="pref-graphics-opaque-overlays-note"
        >
          {caption(resolved.opaqueOverlays, env.auto.opaqueOverlays, OPAQUE_COPY)}
        </Typography>
      </Stack>
    </Stack>
  )
}
