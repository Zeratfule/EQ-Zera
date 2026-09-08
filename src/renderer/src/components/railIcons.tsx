// THE RAIL'S OWN ICON SET (EQ Zera, 2026-09-06). Sixteen marks drawn for this app — not the
// Material set the upstream nav used — on a 24px grid, 1.8px round strokes, one silhouette each
// so a cell reads at 20px with a two-word label under it. Every mark is a THING from the game or
// the tab's job (a CRT for the overview, a chest for loot, a scroll for quests), never an
// abstract glyph, which is what keeps them tellable apart at a glance.
//
// Built on MUI's SvgIcon so `fontSize` / `color` / `sx` behave exactly as the old icons did in
// the rail's ListItemIcon; the root's `fill: none` + `stroke: currentColor` is what turns the
// paths into outlines, and a mark that wants a solid piece says `fill="currentColor"` itself.

import type { JSX } from 'react'
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon'
import { PALETTE } from '../../../shared/palette'

const OUTLINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Mark({ children, ...props }: SvgIconProps): JSX.Element {
  return (
    <SvgIcon {...props} sx={OUTLINE}>
      {children}
    </SvgIcon>
  )
}

/** Overview — a CRT with a signal trace. */
export function OverviewMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 20h6M12 17v3" />
      <path d="M6.5 12.5l2.5-3 3 4 3-5 2.5 4" />
    </Mark>
  )
}

/** Combat — two crossed blades, hilts down. */
export function CombatMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M19 5L5 19M5 5l14 14" />
      <path d="M3.5 16.5l4 4M20.5 16.5l-4 4" />
      <path d="M17 3l4 4M3 7l4-4" />
    </Mark>
  )
}

/** Mobs — a horned skull. */
export function MobsMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M8 5c-4 0-4.5 7.5-1.5 9.5V19h11v-4.5C20.5 12.5 20 5 16 5z" />
      <circle cx="9.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="11" r="1.3" fill="currentColor" stroke="none" />
      <path d="M7.5 6.5L4.5 3M16.5 6.5l3-3.5M10.5 19v-2.5M13.5 19v-2.5" />
    </Mark>
  )
}

/** Loot — a treasure chest, lid closed, hasp centred. */
export function LootMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M4 10V8.5A4.5 4.5 0 0 1 8.5 4h7A4.5 4.5 0 0 1 20 8.5V10" />
      <path d="M4 10h16v9H4z" />
      <path d="M12 10v2.5" />
      <rect x="10" y="12.5" width="4" height="3" rx="0.8" fill="currentColor" stroke="none" />
    </Mark>
  )
}

/** Quests — a scroll with a curled edge and three lines of text. */
export function QuestsMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M7 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8" />
      <path d="M7 4a2.5 2.5 0 0 0-2.5 2.5V9H7M8 20a2 2 0 0 1-2-2v-2" />
      <path d="M10 9h6M10 12.5h6M10 16h3.5" />
    </Mark>
  )
}

/** Zone Loot — a map pin standing over a small chest: what drops WHERE. Two of the rail's own
 *  vocabularies (the compass rose's place, the loot chest's haul) reduced to one silhouette, so
 *  it reads next to both of them without being mistaken for either. */
export function ZoneLootMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M12 3a4 4 0 0 0-4 4c0 2.8 4 6.5 4 6.5S16 9.8 16 7a4 4 0 0 0-4-4z" />
      <circle cx="12" cy="7" r="1.3" fill="currentColor" stroke="none" />
      <path d="M4.5 16.5h15v4h-15z" />
      <path d="M12 16.5v4" />
    </Mark>
  )
}

/** Gear — a breastplate. */
export function GearMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M6 4l3 2h6l3-2 2.5 5.5L18 10.5V19H6v-8.5L3.5 9.5z" />
      <path d="M12 10.5V19" />
    </Mark>
  )
}

/** Maps — a compass rose. */
export function MapsMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.5l1.8 5.5L12 17.5 10.2 12z" fill="currentColor" stroke="none" />
      <path d="M12 2.5v1.5M12 20v1.5M2.5 12H4M20 12h1.5" />
    </Mark>
  )
}

/** Raid targets — a crown. */
export function BossesMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M4 17L3 8l5 4 4-6.5L16 12l5-4-1 9z" />
      <path d="M4.5 17v3h15v-3" />
    </Mark>
  )
}

/** Plane of Sky — a pyramid riding a cloud. */
export function PoskyMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M12 3l4.5 7.5h-9z" />
      <path d="M5.5 19a3 3 0 0 1 .8-5.9A4.2 4.2 0 0 1 14.5 12a3 3 0 0 1 4 7z" />
    </Mark>
  )
}

/** Alerts — a war horn sounding. */
export function AlertsMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M3.5 10v4h3l7 4.5v-13l-7 4.5z" />
      <path d="M16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10" />
    </Mark>
  )
}

/** Leveling — three chevrons climbing. */
export function LevelingMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M6 20l6-5 6 5" opacity="0.45" />
      <path d="M6 14l6-5 6 5" opacity="0.75" />
      <path d="M6 8l6-5 6 5" />
    </Mark>
  )
}

/** Buffs — a potion flask. */
export function BuffsMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M9.5 3h5M10.5 3v5.5L6 16a3.2 3.2 0 0 0 2.8 5h6.4A3.2 3.2 0 0 0 18 16l-4.5-7.5V3" />
      <circle cx="11" cy="16.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="0.8" fill="currentColor" stroke="none" />
    </Mark>
  )
}

/** Timers — an hourglass. */
export function TimersMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M6 3h12M6 21h12" />
      <path d="M7.5 3c0 6 4.5 7 4.5 9s-4.5 3-4.5 9M16.5 3c0 6-4.5 7-4.5 9s4.5 3 4.5 9" />
      <path d="M9.5 19.5h5" fill="currentColor" />
    </Mark>
  )
}

/** Preferences — three slider tracks with knobs. */
export function PreferencesMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      {/* Knobs are punched out of the track in the rail's own paper, so they read as knobs. */}
      <circle cx="9" cy="7" r="2.2" fill={PALETTE.paper} />
      <circle cx="15.5" cy="12" r="2.2" fill={PALETTE.paper} />
      <circle cx="7" cy="17" r="2.2" fill={PALETTE.paper} />
    </Mark>
  )
}

/** Send feedback — a speech bubble with two lines. */
export function FeedbackMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M4 5h16v10h-9l-4 4v-4H4z" />
      <path d="M8 9h8M8 12h5" />
    </Mark>
  )
}

/** Triage (owner only) — a clipboard with a tick. */
export function TriageMark(p: SvgIconProps): JSX.Element {
  return (
    <Mark {...p}>
      <path d="M8.5 4h7v2.5h-7z" />
      <path d="M6 6.5h12V20H6z" />
      <path d="M9 13.5l2.2 2.2L15.5 11" />
    </Mark>
  )
}
