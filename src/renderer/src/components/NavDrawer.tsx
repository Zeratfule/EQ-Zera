import type { JSX } from 'react'
import { Box, Chip, Divider, Drawer, List, ListItemButton, ListItemIcon, Typography, type SxProps, type Theme } from '@mui/material'
// The rail's own marks (railIcons.tsx) — drawn for this app, not the Material set. TriageMark is
// dev-only like the row that uses it: a named export whose only use sits inside a `false &&`
// branch is tree-shaken out with the branch.
import {
  AlertsMark,
  BossesMark,
  BuffsMark,
  CombatMark,
  FeedbackMark,
  GearMark,
  LevelingMark,
  LootMark,
  MapsMark,
  MobsMark,
  OverviewMark,
  PoskyMark,
  PreferencesMark,
  QuestsMark,
  TimersMark,
  TriageMark,
  ZoneLootMark
} from './railIcons'
import UpdateChip from './UpdateChip'
import { OWNER_TOOLS } from '../devFlags'
import type { PrefsRouting } from '../appRouting'
import { GEAR_AREA_VIEWS, VIEW_LABELS, loadGearTab, type View } from '../appViews'
import { FONTS, NEON_VERTICAL, PALETTE, withAlpha } from '../../../shared/palette'

// THE CONSOLE RAIL (EQ Zera, 2026-09-06). The nav is a narrow rail of icon-over-label cells in
// the display face — a console's mode selector — rather than the upstream text list. 96px fits
// the longest label ("PLANE OF SKY", "SEND FEEDBACK") on two centred lines at this size.
export const DRAWER_WIDTH = 96

/** One rail cell. The selected cell lights a vertical neon marker on the rail's edge and the
 *  accent on its icon; everything else stays quiet so the lit one is the only thing that reads. */
const CELL_SX: SxProps<Theme> = {
  position: 'relative',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0.4,
  minHeight: 52,
  px: 0.5,
  py: 0.75,
  borderRadius: 0,
  color: 'text.secondary',
  '&::before': {
    content: '""',
    position: 'absolute',
    left: 0,
    top: 10,
    bottom: 10,
    width: 3,
    borderRadius: '0 2px 2px 0',
    backgroundImage: NEON_VERTICAL,
    opacity: 0,
    transition: 'opacity 140ms ease'
  },
  '&.Mui-selected': {
    color: 'primary.main',
    '&::before': { opacity: 1 },
    '& .MuiListItemIcon-root': { color: 'primary.main', filter: `drop-shadow(0 0 5px ${withAlpha(PALETTE.accent, 0.7)})` }
  },
  '& .MuiListItemIcon-root': { minWidth: 0, color: 'inherit', '& svg': { fontSize: 20 } }
}

/** The cell's label: the display face, tiny and tracked, allowed a second line. */
const LABEL_SX: SxProps<Theme> = {
  fontFamily: FONTS.display,
  fontSize: 8.5,
  fontWeight: 500,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  textAlign: 'center',
  lineHeight: 1.3
}

/** A row is a view + an icon. The LABEL is not a field: it comes from `VIEW_LABELS`, the one
 *  place a tab is named, because a drill's Back button now says those names too (navOrigin.ts). */
interface NavRow {
  view: View
  icon: JSX.Element
  /** trailing state chip, when a row has one to state */
  badge?: JSX.Element
  /**
   * ONE ROW, SEVERAL VIEWS (JOS-324). A row whose destination is an AREA rather than a single
   * view lists every view drawn inside it here, and reads `selected` while ANY of them is up —
   * so the drawer keeps agreeing with the screen when the in-area tab bar moves you sideways.
   * Absent ⇒ the ordinary rule, and the ordinary rule is still the one nearly every row follows.
   */
  area?: readonly View[]
  /**
   * Which view the row OPENS, when that is not simply `view`. The gear row opens the area at the
   * tab you last stood on (appViews.ts `loadGearTab`) — a function rather than a value because
   * that answer is read from localStorage at CLICK time, not at module load.
   */
  opens?: () => View
}

/* State, not process: this tab is newer than the rest, and the chip says exactly how much.
 * "beta" replaced "in dev" for the release-hardening pass (owner directive 2026-08-13): Timers,
 * Buffs and Exaltations graduated with no chip at all, and Gear — the youngest tab — wears the
 * one remaining caveat. Since JOS-324 that row is the whole gear AREA, and the chip stays on it:
 * two of the four tabs behind it are younger than the chip was, and one of them is a placeholder.
 * A chip comes OFF by deleting the badge from its row, never by softening the word. */
const BETA = (
  <Chip
    size="small"
    label="beta"
    variant="outlined"
    sx={{ height: 14, fontSize: 8, color: 'text.secondary', '& .MuiChip-label': { px: 0.5 } }}
  />
)

// Row ORDER is the nav's order. Overview leads: it is the at-a-glance landing surface.
//
// LOOT SITS BESIDE MOBS (owner decision, 2026-08-04) and everything else keeps its place. The
// two tabs answer halves of one question — what drops it, and what did I get — and they link
// into each other constantly (a mob page's drop rows open an item, the Overview's drop rows open
// the loot detail). Loot's old home at the bottom of the list put five unrelated tabs between
// them.
//
// AND ONE ROW IS NOT ONE VIEW ANY MORE (JOS-324, owner ruling 2026-08-13). The drawer's old law —
// exactly one row per view, no exceptions — held right up until three of the rows turned out to be
// three faces of a single question: what should I be wearing (Gear), what am I farming for
// (Exaltations) and what am I wearing right now (the dev-only Character sheet). Two of them sat
// consecutively here and the third hung off the bottom behind a flag, and nothing in a vertical
// list said any of them had anything to do with the others. They are now ONE row — Gear — over an
// in-area tab bar (components/GearAreaTabs.tsx) that also carries the fourth face the list had no
// room to grow, a Wish list. The row reads `selected` while any of the four is on screen, and it
// opens the one you last used. The law that survives is the one that mattered: a row is a
// DESTINATION, and clicking it takes you somewhere real.
const ROWS: NavRow[] = [
  { view: 'overview', icon: <OverviewMark /> },
  { view: 'combat', icon: <CombatMark /> },
  { view: 'mobs', icon: <MobsMark /> },
  { view: 'loot', icon: <LootMark /> },
  // QUESTS (EQ Zera, 2026-09-06): the scraped quest catalog with its steps, joined to the loot
  // history. It follows Loot because that is the join a player comes here to make — "I looted
  // this; what is it for?" — and it is one file plus this row (features/quests/QuestsView.tsx).
  { view: 'quests', icon: <QuestsMark /> },
  // ZONE LOOT (EQ Zera, ROADMAP §2): pick a zone, see every mob in it and what each drops, with
  // your own counts and per-hour beside the wiki's list. It follows Quests for the reason Loot
  // follows Mobs — it is another face of "what drops it, and did I get one" over the same
  // committed corpus, and its rows link straight into both of those tabs.
  { view: 'zoneloot', icon: <ZoneLootMark /> },
  // THE GEAR AREA follows Loot for the same reason Loot follows Mobs: it is the far side of one
  // question — what drops it, what did I get, and then what should I wear, farm for and want. It
  // reads the same committed corpus and links back into the same Loot drill-down. The row keeps
  // Gear's icon, Gear's testid (`nav-gear`) and Gear's beta chip; the tabs behind it are named by
  // `VIEW_LABELS`, the one place any of this app's tabs is named.
  {
    view: 'gear',
    icon: <GearMark />,
    badge: BETA,
    area: GEAR_AREA_VIEWS,
    opens: loadGearTab
  },
  { view: 'maps', icon: <MapsMark /> },
  { view: 'bosses', icon: <BossesMark /> },
  { view: 'posky', icon: <PoskyMark /> },
  { view: 'alerts', icon: <AlertsMark /> },
  { view: 'leveling', icon: <LevelingMark /> },
  { view: 'buffs', icon: <BuffsMark /> },
  // Respawn clocks (JOS-194) sit beside Buffs because both tabs are the same shape of answer —
  // a list of things counting down — and a player checking one is usually checking the other.
  { view: 'timers', icon: <TimersMark /> }
]

/** Bottom-aligned, outside ROWS — it is not a feature view and never moves. */
const PREFERENCES: NavRow = { view: 'preferences', icon: <PreferencesMark /> }

/** One nav row. `data-testid="nav-<view>"` is the stable handle the e2e clicks. */
function NavRowButton({
  row,
  view,
  onSelect
}: {
  row: NavRow
  view: View
  onSelect: (v: View) => void
}): JSX.Element {
  return (
    <ListItemButton
      data-testid={`nav-${row.view}`}
      selected={row.area ? row.area.includes(view) : view === row.view}
      onClick={() => onSelect(row.opens ? row.opens() : row.view)}
      sx={CELL_SX}
    >
      <ListItemIcon>{row.icon}</ListItemIcon>
      <Typography component="span" sx={LABEL_SX}>
        {VIEW_LABELS[row.view]}
      </Typography>
      {row.badge && <Box sx={{ position: 'absolute', top: 4, right: 4 }}>{row.badge}</Box>}
    </ListItemButton>
  )
}

/**
 * The permanent left nav: one row per destination — usually a view, and since JOS-324 once an
 * AREA of four (see `ROWS`) — with Preferences bottom-aligned and the ambient update chip beneath
 * it.
 *
 * Frameless: the drawer is a normal in-flow child (no fixed OS bar above it), so it fills
 * the space under the title bar — `position: relative` + `height: 100%` keeps it inside
 * the flex row.
 */
export default function NavDrawer({
  view,
  onSelect,
  onSendFeedback,
  prefs
}: {
  view: View
  onSelect: (v: View) => void
  /** Opens the feedback DIALOG (Task #65). Feedback is not a view — appViews.ts is untouched —
   *  so this row carries a callback instead of a `View`, and never shows a selected state. */
  onSendFeedback: () => void
  /** The Preferences SECTION router (JOS-254), for the patch-notes icon beside the version
   *  number in the chip below. A section is not a view, so it cannot travel through `onSelect`
   *  — and the drawer names its own destination the way `BottomStrips` does in App.tsx rather
   *  than taking one opaque callback per section a future row might want. */
  prefs: PrefsRouting
}): JSX.Element {
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          boxSizing: 'border-box',
          position: 'relative',
          height: '100%',
          borderTop: 'none',
          borderRight: `1px solid ${withAlpha(PALETTE.accent, 0.18)}`,
          bgcolor: 'background.paper',
          // Thirteen cells outrun a short window; the rail still scrolls, but a 12px gutter
          // beside 96px of rail is a quarter of it gone, so this one scroller hides its bar.
          '&::-webkit-scrollbar': { display: 'none' }
        }
      }}
    >
      <List>
        {ROWS.map((row) => (
          <NavRowButton key={row.view} row={row} view={view} onSelect={onSelect} />
        ))}
        {/* UNRELEASED (JOS-45) USED TO HAVE A ROW HERE, and JOS-324 moved it INTO the gear area:
            the character sheet is now the area's last TAB, gated by the same `UNRELEASED` flag in
            the same way (appViews.ts drops `character` from `KNOWN_VIEWS` in a build without it,
            and `GEAR_AREA_VIEWS` is derived from that list, so the tab is absent from the bar and
            the view is absent from the bundle). The gate itself is untouched and still measured —
            `tests/e2e/character-sheet.e2e.mts` now asserts the TAB is absent in a production-shaped
            build, which is a stronger reading than the old row check because the bar it looks at is
            demonstrably mounted at the time. JOS-327 graduates it by deleting the flag. */}
        {/* OWNER-ONLY: the feedback-triage tab. `OWNER_TOOLS` (JOS-72) is `DEV_TOOLS` AND the
            `EQ_OWNER_TOOLS=1` opt-in, so this row is absent from a fresh checkout's `npm run
            dev` as well as from every build — the tab reads the owner's AWS backlog, and a
            self-compiled copy of this public repo used to show it. `DEV_TOOLS` is still the
            left-hand term, so in `electron-vite build` this reads `false && …` and rollup
            deletes the branch: the row, its label, its chip and its icon are not in the shipped
            bundle at all. Built INSIDE the branch rather than hoisted to a module const on
            purpose: a top-level `jsx()` call is not something rollup can prove is side-effect
            free, and it would keep the strings alive. The e2e suite asserts `nav-triage` is
            ABSENT in a production-shaped build. */}
        {OWNER_TOOLS && (
          <NavRowButton
            row={{
              view: 'triage',
              icon: <TriageMark />,
              badge: (
                <Chip
                  size="small"
                  label="owner only"
                  variant="outlined"
                  color="warning"
                  sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.75 } }}
                />
              )
            }}
            view={view}
            onSelect={onSelect}
          />
        )}
      </List>

      {/* Bottom-aligned Preferences (Task #55) — replaces the old update-channel block. */}
      <Box sx={{ mt: 'auto' }}>
        <Divider />
        <List disablePadding>
          {/* Send feedback (Task #65): a dialog, so it is a plain action row — no `selected`
              state to own, because nothing in the nav stays "on" while it is open. */}
          <ListItemButton data-testid="nav-feedback" onClick={onSendFeedback} sx={CELL_SX}>
            <ListItemIcon>
              <FeedbackMark />
            </ListItemIcon>
            <Typography component="span" sx={LABEL_SX}>
              Send feedback
            </Typography>
          </ListItemButton>
          <NavRowButton row={PREFERENCES} view={view} onSelect={onSelect} />
        </List>
        {/* …and directly beneath it, the AMBIENT update affordance (Task #60):
            an accent-coloured "Restart to update" chip when a build is downloaded and
            staged, otherwise a muted "checked 2h ago" line. Never a nag —
            ignoring it just means apply-on-quit does the work silently.
            That muted line is also where the app states the version you are
            running, so it carries the patch-notes icon (JOS-254). */}
        <UpdateChip onWhatsNew={() => prefs.openSection('whatsnew')} />
      </Box>
    </Drawer>
  )
}
