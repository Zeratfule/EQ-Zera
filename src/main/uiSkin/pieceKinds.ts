/**
 * What a named UI piece IS, read from its `<Ui2DAnimation>` name: a frame edge, a title bar
 * segment, a button in some state, a slot... The painter (paint.ts) draws each kind
 * in the EQ Zera style. A name this table does not know is not chrome the skin draws, and the
 * builder leaves those pixels exactly as the base skin has them.
 */

export type Dir =
  | 'TopLeft'
  | 'TopRight'
  | 'BottomLeft'
  | 'BottomRight'
  | 'LeftTop'
  | 'RightTop'
  | 'LeftBottom'
  | 'RightBottom'
  | 'Top'
  | 'Bottom'
  | 'Left'
  | 'Right'
  | 'Middle'
  | 'Up'
  | 'Down'

export type State = 'normal' | 'flyby' | 'pressed' | 'pressedFlyby' | 'disabled' | 'pressedDisabled'

export type Glyph = 'x' | 'minus' | 'plus' | 'square' | 'tile' | 'question' | 'left' | 'right' | 'up' | 'down'

export type FrameVariant = 'solid' | 'trans' | 'tooltip' | 'black' | 'inner' | 'highlight'

export type Piece =
  | { kind: 'frame'; dir: Dir; variant: FrameVariant }
  | { kind: 'title'; dir: Dir }
  | { kind: 'button'; state: State }
  | { kind: 'glyphButton'; state: State; glyph: Glyph }
  | { kind: 'glyph'; glyph: Glyph }
  | { kind: 'check'; state: State }
  | { kind: 'radio'; state: State }
  | { kind: 'sliderTrack'; dir: Dir | null }
  | { kind: 'sliderThumb'; state: State }
  | { kind: 'thumb'; dir: Dir }
  | { kind: 'slot'; label: string }
  | { kind: 'hotslot'; state: State }
  | { kind: 'divider'; vertical: boolean }
  | { kind: 'header'; dir: Dir }
  | { kind: 'blank' }

const STATES: [RegExp, State][] = [
  [/PressedFlyby$/i, 'pressedFlyby'],
  [/PressedDisabled$/i, 'pressedDisabled'],
  [/NormalDisabled$/i, 'disabled'],
  [/(Normal)$/i, 'normal'],
  [/(Flyby|Selected)$/i, 'flyby'],
  [/Pressed$/i, 'pressed'],
  [/Disabled$/i, 'disabled']
]

/** Trailing words that name a variant of a piece rather than what it is. */
const MODIFIERS = /(Trans|Tooltip|Black|WithArrow|NoArrow|Large|Dark|_?Small|_?Medium|_Double|_CC|_merge|_wide|_widefilled|filled|_transparent|Auto)$/

const DIRS: Dir[] = ['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight', 'LeftTop', 'RightTop', 'LeftBottom', 'RightBottom', 'Top', 'Bottom', 'Left', 'Right', 'Middle', 'Up', 'Down']

function trailingDir(name: string): Dir | null {
  return DIRS.find((d) => name.endsWith(d)) ?? null
}

interface Parsed {
  base: string
  state: State
  mods: string[]
}

/** Strips `A_`, the state word and any variant words; keeps what was stripped. */
export function parseName(full: string): Parsed {
  let base = full.replace(/^A_/, '')
  let state: State = 'normal'
  const mods: string[] = []
  for (let guard = 0; guard < 4; guard++) {
    const m = MODIFIERS.exec(base)
    const s = STATES.find(([re]) => re.test(base))
    if (m) {
      mods.push(m[1] ?? '')
      base = base.slice(0, m.index)
    } else if (s && state === 'normal') {
      state = s[1]
      base = base.replace(s[0], '')
    } else break
  }
  // Chat buttons spell their states as one trailing letter: ChatCloseH (hover), ChatCloseP.
  const chat = /^(Chat(?:Close|Min|Max))([HP])$/.exec(base)
  if (chat) return { base: chat[1] ?? base, state: chat[2] === 'H' ? 'flyby' : 'pressed', mods }
  return { base, state, mods }
}

const GLYPHS: [RegExp, Glyph][] = [
  [/^(CloseBtn|ChatClose)$/, 'x'],
  [/^(MinimizeBtn|ChatMin|MinusBtn|ZoomOutButton)$/, 'minus'],
  [/^(MaximizeBtn|ChatMax)$/, 'square'],
  [/^TileBtn$/, 'tile'],
  [/^(QMarkBtn|ChatQMarkBtn)$/, 'question'],
  [/^(PlusBtn|ZoomInButton)$/, 'plus'],
  [/^(LeftArrowBtn|PanLeftButton|RotateLeftButton|SBW_LeftSplBkBtn|HSBLeft)$/, 'left'],
  [/^(RightArrowBtn|PanRightButton|RotateRightButton|SBW_RightSplBkBtn|HSBRight)$/, 'right'],
  [/^(PanUpButton|RotateUpButton|VSBUp)$/, 'up'],
  [/^(PanDownButton|RotateDownButton|VSBDown)$/, 'down']
]

const SLOT_LABELS: Record<string, string> = {
  Ear: 'EAR', Neck: 'NECK', Head: 'HEAD', Face: 'FACE', Chest: 'CHEST', AboutBody: 'BODY', Back: 'BACK',
  Arms: 'ARMS', Shoulders: 'SHLDR', Wrist: 'WRIST', Waist: 'WAIST', Hands: 'HANDS', Ring: 'RING',
  Legs: 'LEGS', Feet: 'FEET', Primary: 'MAIN', Secondary: 'OFF', Range: 'RANGE', Ammo: 'AMMO',
  Charm: 'CHARM', PowerSource: 'POWER'
}

function slotLabel(base: string): string {
  const key = base.replace(/^(Stone)?Inv/, '').replace(/\d+$/, '')
  return SLOT_LABELS[key] ?? ''
}

const FRAME = /(Frame|Border|Filigree\d?|StoneUI|FakeInset|Resize|Inset|Tab|HighlightThin|Transparent)/

function frameVariant(base: string, mods: string[]): FrameVariant {
  if (base.includes('HighlightThin')) return 'highlight'
  if (mods.includes('Black')) return 'black'
  if (/Inner|Inset|Tiny/.test(base)) return 'inner'
  if (mods.includes('Tooltip')) return 'tooltip'
  if (mods.includes('Trans') || base.includes('Transparent')) return 'trans'
  return 'solid'
}

type Rule = (p: Parsed) => Piece | null

const RULES: Rule[] = [
  (p) => {
    const g = GLYPHS.find(([re]) => re.test(p.base))
    return g ? { kind: 'glyphButton', state: p.state, glyph: g[1] } : null
  },
  (p) => (p.base === 'CascadeSubmenuIndicator' ? { kind: 'glyph', glyph: 'right' } : null),
  (p) => (/^(VSB|HSB)Thumb/.test(p.base) ? { kind: 'thumb', dir: trailingDir(p.base) ?? 'Middle' } : null),
  (p) => (p.base.includes('CheckBox') ? { kind: 'check', state: p.state } : null),
  (p) => (p.base.includes('RadioBtn') ? { kind: 'radio', state: p.state } : null),
  (p) => (p.base.includes('SliderThumb') ? { kind: 'sliderThumb', state: p.state } : null),
  (p) => (/Slider(Background|EndCap(Left|Right))$/.test(p.base) ? { kind: 'sliderTrack', dir: p.base.includes('EndCap') ? trailingDir(p.base) : null } : null),
  (p) => (/Title(Left|Middle|Right)$|TitlePiece$/.test(p.base) ? { kind: 'title', dir: trailingDir(p.base.replace(/TitlePiece$/, '').replace(/^Stretchy$/, 'Middle')) ?? 'Middle' } : null),
  (p) => {
    const dir = trailingDir(p.base)
    return dir && FRAME.test(p.base) ? { kind: 'frame', dir, variant: frameVariant(p.base, p.mods) } : null
  },
  (p) => (/^(Stone)?Inv[A-Z]/.test(p.base) ? { kind: 'slot', label: slotLabel(p.base) } : null),
  (p) => (/SpellGem(Holder|Background)|^Spell_Gem_Background|RecessedBox|SpellBookSlot|PlayerNameBG/.test(p.base) ? { kind: 'slot', label: '' } : null),
  (p) => (/^HotButton\d*$/.test(p.base) ? { kind: 'hotslot', state: p.state } : null),
  (p) => (/^(Btn|SmallBtn|BigBtn|SquareBtn|ToolbarButton)$/.test(p.base) ? { kind: 'button', state: p.state } : null),
  (p) => (p.base.startsWith('Divider') || p.base === 'CascadeMenuSeparator' ? { kind: 'divider', vertical: p.base === 'DividerVertical' } : null),
  (p) => (p.base.startsWith('ListHeader') ? { kind: 'header', dir: trailingDir(p.base) ?? 'Middle' } : null),
  (p) => (p.base.endsWith('Blank') ? { kind: 'blank' } : null)
]

/** The kind of chrome a piece name names, or null when the skin does not draw it. */
export function classifyPiece(name: string): Piece | null {
  const parsed = parseName(name)
  // GAUGES ARE NEVER DRAWN (owner, in game): every gauge keeps the base skin's own pieces.
  if (parsed.base.includes('Gauge')) return null
  for (const rule of RULES) {
    const hit = rule(parsed)
    if (hit) return hit
  }
  return null
}
