// The celebration toast's PAYLOAD contract (docs/plans/celebration-toasts.md §2).
//
// `toast:show` is a renderer→main channel, so its argument is re-validated at the handler like
// every other renderer-supplied string in this app — never trusted because today's only caller
// is the app's own detectors. What is pinned here is what that validator PROMISES the rest of
// the pipeline: a closed kind, a closed focus view, capped text, no stray properties, and a
// null (not a throw, not a half-built object) when the request cannot be honoured.
//
// Plus the item card's pre-formatting, which is the other half of "the overlay fetches
// nothing": the exact lines a Sky reward prints are decided HERE, in main, and pinned here.
//
// Pure — no Electron, no fixtures, never skips.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TOAST_CONFIG,
  TOAST_INTRO_BODY,
  TOAST_INTRO_ID,
  TOAST_INTRO_MS,
  TOAST_MAX_DURATION_MS,
  TOAST_MAX_LINES,
  TOAST_MAX_QUESTS,
  TOAST_MAX_TEXT,
  TOAST_MIN_DURATION_MS,
  introToastPayload,
  normalizeToastConfig,
  toastActionLabel,
  toastItemCard,
  validateToastRequest
} from '../src/shared/toast'
import { parseStatsBlock } from '../src/shared/itemStats'
import type { ItemKnowledge } from '../src/shared/types'

const boss = {
  id: 'boss:Lord Nagafen:1',
  kind: 'bossKill',
  title: 'Lord Nagafen defeated',
  subtitle: 'D2 · Adaptive · Nagafen’s Lair'
}

test('a well-formed boss request survives verbatim', () => {
  const out = validateToastRequest(boss)
  assert.deepEqual(out, boss)
})

test('a request with no id, no title or an unknown kind is REFUSED (null, never partial)', () => {
  assert.equal(validateToastRequest({ ...boss, id: '' }), null)
  assert.equal(validateToastRequest({ ...boss, title: '   ' }), null)
  assert.equal(validateToastRequest({ ...boss, kind: 'lootDrop' }), null)
  assert.equal(validateToastRequest({ ...boss, kind: 42 }), null)
  assert.equal(validateToastRequest(null), null)
  assert.equal(validateToastRequest('boss killed'), null)
  assert.equal(validateToastRequest([boss]), null)
})

test('unknown properties are STRIPPED, not passed through to a window that draws them', () => {
  const out = validateToastRequest({
    ...boss,
    html: '<img src=x onerror=alert(1)>',
    item: { name: 'forged', lines: ['fake'] },
    focus: { view: 'mobs', mob: 'Lord Nagafen' }
  })
  assert.ok(out)
  assert.deepEqual(Object.keys(out).sort(), ['focus', 'id', 'kind', 'subtitle', 'title'])
  // `item` in particular: the CARD is main's to resolve (T5). A renderer-supplied one would be
  // an unvalidated block of text rendered in an always-on-top window.
  assert.equal('item' in out, false)
})

test('text is capped, so no payload can push the card off the screen', () => {
  const out = validateToastRequest({ ...boss, title: 'x'.repeat(5000), subtitle: 'y'.repeat(5000) })
  assert.ok(out)
  assert.equal(out.title.length, TOAST_MAX_TEXT)
  assert.equal(out.subtitle?.length, TOAST_MAX_TEXT)
})

test('focus is a CLOSED union — an unlisted view is dropped, not forwarded', () => {
  assert.equal(validateToastRequest({ ...boss, focus: { view: 'triage' } })?.focus, undefined)
  assert.equal(validateToastRequest({ ...boss, focus: 'posky' })?.focus, undefined)
  assert.deepEqual(validateToastRequest({ ...boss, focus: { view: 'posky' } })?.focus, { view: 'posky' })
  assert.deepEqual(validateToastRequest({ ...boss, focus: { view: 'mobs', mob: 'a bat' } })?.focus, {
    view: 'mobs',
    mob: 'a bat'
  })
})

// ---- the level-up kind + its anchors (docs/plans/levelup-whats-new.md §2) --------------

const ding = {
  id: 'level:24:1754300000000',
  kind: 'levelUp',
  title: 'Level 24!',
  subtitle: '3 new spells · 2 new skills'
}

test('a level-up request is a first-class kind, carried verbatim', () => {
  assert.deepEqual(validateToastRequest(ding), ding)
})

test('a level-up carries NO item — a level is not a reward you can hold', () => {
  const out = validateToastRequest({ ...ding, itemName: 'Sword of Nothing' })
  // itemName is a legal field on any request; what matters is that the level-up producer never
  // sends one, and that a card built from one is main's decision either way. The validator's
  // promise here is only that the kind itself survives beside it.
  assert.equal(out?.kind, 'levelUp')
})

test('the leveling anchor is a small positive integer, or it is dropped', () => {
  assert.deepEqual(validateToastRequest({ ...ding, focus: { view: 'leveling', level: 24 } })?.focus, {
    view: 'leveling',
    level: 24
  })
  // No level ⇒ the tab itself, which is a legitimate destination.
  assert.deepEqual(validateToastRequest({ ...ding, focus: { view: 'leveling' } })?.focus, { view: 'leveling' })
  for (const level of [0, -3, 9999, '24', null]) {
    const focus = validateToastRequest({ ...ding, focus: { view: 'leveling', level } })?.focus
    assert.deepEqual(focus, { view: 'leveling' }, `level ${String(level)} must not survive`)
  }
  // A fractional level FLOORS rather than being dropped — the same coercion `durationMs` gets
  // from the same helper. There is no level 24.5, and 24 is the honest reading of one.
  assert.equal(validateToastRequest({ ...ding, focus: { view: 'leveling', level: 24.5 } })?.focus?.level, 24)
})

// ---- the card's call to action (JOS-334) ---------------------------------------------
//
// A LABEL IS A PROMISE, AND A PROMISE IS TESTABLE. The level-up card is the whole click target
// (no reward block to hang an affordance on) and shipped advertising that with a pointer cursor
// alone. The words it prints instead are pinned here rather than in a screenshot, which is the
// same reason TOAST_INTRO_BODY is a constant in a pure module: what the app SAYS to a player is
// a contract, and the overlay window is the hardest place in the app to look at.

test('a level-up card names its destination AND the level, so the click is not a mystery', () => {
  assert.equal(toastActionLabel({ view: 'leveling', level: 24 }), 'See what’s new at 24')
  // The panel this lands on is titled "New at this level"; the label is a sentence it finishes.
  assert.match(toastActionLabel({ view: 'leveling', level: 24 }) ?? '', /new at 24$/)
})

test('…falling back to the un-numbered promise when the focus names no level', () => {
  assert.equal(toastActionLabel({ view: 'leveling' }), 'See what’s new')
})

test('…and printing NOTHING for a destination it cannot name, rather than inventing one', () => {
  // Both of these are legal focuses; neither is a place this label knows how to describe, and an
  // unlabelled card is exactly as clickable as it was before — under-promise, never fabricate.
  assert.equal(toastActionLabel({ view: 'mobs', mob: 'Lord Nagafen' }), undefined)
  assert.equal(toastActionLabel({ view: 'posky', quest: 'Paladin::Test of Spirit' }), undefined)
  assert.equal(toastActionLabel(undefined), undefined)
})

test('the per-quest anchor rides the posky focus as capped text', () => {
  assert.deepEqual(
    validateToastRequest({ ...boss, focus: { view: 'posky', quest: 'Paladin::Test of Sacrifice' } })?.focus,
    { view: 'posky', quest: 'Paladin::Test of Sacrifice' }
  )
  const long = validateToastRequest({ ...boss, focus: { view: 'posky', quest: 'q'.repeat(5000) } })?.focus
  assert.equal(long?.quest?.length, TOAST_MAX_TEXT)
  assert.equal(validateToastRequest({ ...boss, focus: { view: 'posky', quest: 42 } })?.focus?.quest, undefined)
})

test('duration is clamped into a sane window (and a bad one falls back to the config’s)', () => {
  assert.equal(validateToastRequest({ ...boss, durationMs: 9_000_000 })?.durationMs, TOAST_MAX_DURATION_MS)
  assert.equal(validateToastRequest({ ...boss, durationMs: 1 })?.durationMs, 1000)
  assert.equal(validateToastRequest({ ...boss, durationMs: -5 })?.durationMs, undefined)
  assert.equal(validateToastRequest({ ...boss, durationMs: 'long' })?.durationMs, undefined)
})

test('a Sky request carries the reward by NAME — main resolves the card', () => {
  const out = validateToastRequest({
    id: 'quest:Paladin::Test of Sacrifice',
    kind: 'skyQuestComplete',
    title: 'Quest complete: Test of Sacrifice',
    itemName: 'Shining Metallic Robes',
    focus: { view: 'posky' }
  })
  assert.equal(out?.itemName, 'Shining Metallic Robes')
})

// ---- the embedded item card -----------------------------------------------------------

/** A real-shaped stat block (the sample set in shared/itemStats.ts's header). */
const RING = `Djarn's Amethyst Ring
---------------------
MAGIC ITEM  LORE ITEM
Slot: FINGER
AGI: +9  HP: +80
WT: 0.1  Size: TINY
Class: ALL
Race: ALL`

function knowledge(over: Partial<ItemKnowledge> = {}): ItemKnowledge {
  return {
    name: "Djarn's Amethyst Ring",
    lore: true,
    quest: false,
    questUses: [],
    cached: true,
    statsBlock: RING,
    stats: parseStatsBlock(RING),
    iconId: 1234,
    ...over
  }
}

test('the reward card is pre-formatted: flags+slot, then the numbers, capped', () => {
  const card = toastItemCard(knowledge())
  assert.equal(card.name, "Djarn's Amethyst Ring")
  assert.equal(card.iconId, 1234)
  assert.ok(card.lines.length > 0 && card.lines.length <= TOAST_MAX_LINES)
  assert.match(card.lines[0], /Magic Item|MAGIC ITEM/i)
  assert.match(card.lines[0], /Slot: FINGER/)
  assert.ok(
    card.lines.some((l) => l.includes('AGI') && l.includes('HP')),
    `the attribute line is missing: ${JSON.stringify(card.lines)}`
  )
})

test('LORE wins the name colour hint; a plain item asks for none', () => {
  assert.equal(toastItemCard(knowledge()).colorFlag, 'lore')
  assert.equal(toastItemCard(knowledge({ lore: false })).colorFlag, 'magic')
  const plain = knowledge({ lore: false, statsBlock: undefined, stats: undefined })
  assert.equal(toastItemCard(plain).colorFlag, undefined)
})

test('an item we know nothing about still draws — as its NAME, with no invented lines', () => {
  const card = toastItemCard({
    name: 'Some Unknown Thing',
    lore: false,
    quest: false,
    questUses: [],
    cached: false,
    notFound: true
  })
  assert.equal(card.name, 'Some Unknown Thing')
  assert.deepEqual(card.lines, [])
  assert.equal(card.iconId, undefined)
})

// ---- the persisted config -------------------------------------------------------------

test('the toast config is TIMING ONLY — a card has no voice of its own', () => {
  // Owner, 2026-08-05: "remove the sound controls from preferences, they are already covered by
  // Alerts module." The config shipped with {sound, volume, durationMs} and a Silent default,
  // which made the picker a way to hear the same boss kill twice. One knob is left — plus the
  // introduction's own remembered bit (JOS-83), which is state and not a preference: it is never
  // shown in Preferences and the only thing that writes it is the overlay showing the card.
  assert.deepEqual(DEFAULT_TOAST_CONFIG, { durationMs: 6000, introduced: false })
})

test('a stored config is normalized: the duration is clamped, retired keys are dropped', () => {
  assert.equal(normalizeToastConfig({ durationMs: 10 ** 9 }).durationMs, TOAST_MAX_DURATION_MS)
  assert.equal(normalizeToastConfig({ durationMs: 1 }).durationMs, 1000)
  assert.deepEqual(normalizeToastConfig(undefined), DEFAULT_TOAST_CONFIG)

  // A store written by the first toast build still carries `sound`/`volume`. Normalizing DROPS
  // them rather than migrating them: nothing reads them, every reader defaults, and the next
  // write of this blob is what removes them from disk.
  const stored = normalizeToastConfig({
    sound: { packId: 'eq-zera-console', soundId: 'boss' },
    volume: 0.4,
    durationMs: 7000
  })
  assert.deepEqual(stored, { durationMs: 7000, introduced: false })
})

// ---- the introduction card (JOS-83) ---------------------------------------------------
//
// A brand-new user met the celebration strip as an unlabelled rectangle, took the app for broken
// and uninstalled it. The overlay now introduces itself once, and what that card must SAY is a
// contract rather than a matter of taste: it names the program, it says the window is not the
// game's, and it points at the switch.

test('the introduction card NAMES THE APP and points at the way out', () => {
  const p = introToastPayload()
  assert.equal(p.id, TOAST_INTRO_ID)
  assert.equal(p.kind, 'intro')
  // The report is "I could not tell what this window was", so the app's name in the title is the
  // literal fix — not a decoration to be reworded away.
  assert.match(p.title, /EQ Zera/)
  assert.match(p.subtitle ?? '', /appear here/)
  // …and the body says whose window it is, and both exits: the × on the card, and Preferences.
  assert.match(TOAST_INTRO_BODY, /EQ Zera/)
  assert.match(TOAST_INTRO_BODY, /not to EverQuest/)
  assert.match(TOAST_INTRO_BODY, /Preferences/)
})

test('the introduction holds LONGER than a celebration, but is still bounded', () => {
  const p = introToastPayload()
  // A card on screen captures the mouse over the strip (ToastOverlay.useMouseCapture), so an
  // introduction that waited forever for a click would be a permanent hole in the game's input.
  assert.equal(p.durationMs, TOAST_INTRO_MS)
  assert.ok(TOAST_INTRO_MS > DEFAULT_TOAST_CONFIG.durationMs, 'longer than an ordinary card')
  assert.ok(TOAST_INTRO_MS <= TOAST_MAX_DURATION_MS, 'never longer than a card may ever hold')
  assert.ok(TOAST_INTRO_MS >= TOAST_MIN_DURATION_MS)
})

test('the introduction is RENDERER-LOCAL: `intro` is not a kind the wire accepts', () => {
  // The overlay builds this card for itself out of its own persisted config; it never crosses
  // `toast:show`. Admitting the kind at the handler would only widen what a renderer can ask
  // main to draw, so the validator must keep refusing it.
  const p = introToastPayload()
  assert.equal(validateToastRequest({ ...p }), null)
})

test('`introduced` reads false for every store written before it existed — only a literal true counts', () => {
  // The whole point of the field is that a store which has never heard of it OWES the user the
  // introduction: those installs are exactly the population that has been living with an
  // unlabelled strip. Nothing but `true` may cancel that debt.
  assert.equal(normalizeToastConfig({ durationMs: 6000 }).introduced, false)
  assert.equal(normalizeToastConfig({ introduced: 'yes' }).introduced, false)
  assert.equal(normalizeToastConfig({ introduced: 1 }).introduced, false)
  assert.equal(normalizeToastConfig({ introduced: true }).introduced, true)
})

// ---- the quest-item kind + its quest pages (EQ Zera, ROADMAP §1) -----------------------
//
// A quest-item request carries a SECOND list main has to resolve: the wiki page titles of the
// quests the looted item belongs to. That list is renderer-supplied text bound for a window that
// draws it, so it gets the same treatment as everything else here — capped, deduped, cut at the
// card's cap, and admitted on NO other kind. `questPages` on a boss kill is not a smaller card,
// it is a list of strings a detector had no business sending.

const drop = {
  id: 'questItem:Bone Chips:1754300000000',
  kind: 'questItem',
  title: 'Bone Chips',
  subtitle: 'A quest item dropped',
  itemName: 'Bone Chips'
}

test('a quest-item request keeps its pages IN ORDER, deduped and capped', () => {
  const out = validateToastRequest({
    ...drop,
    questPages: ['Bone Chips Felwithe', 'Bone Chips (Kaladim)', 'Bone Chips Felwithe', 'Bone Chips Grobb', 'Assist the Great Xelha']
  })
  // Order is the producer's ranking, so it survives; the repeat falls out where it sat; and the
  // list stops at TOAST_MAX_QUESTS rather than letting one drop paint a wall of quests.
  assert.deepEqual(out?.questPages, ['Bone Chips Felwithe', 'Bone Chips (Kaladim)', 'Bone Chips Grobb'])
  assert.equal(out.questPages?.length, TOAST_MAX_QUESTS)
})

test('blank and non-string page titles fall out; an over-long one is capped like every other string', () => {
  const out = validateToastRequest({ ...drop, questPages: ['  ', 42, null, 'p'.repeat(5000), 'Bone Chips Grobb'] })
  assert.equal(out?.questPages?.length, 2)
  assert.equal(out.questPages?.[0].length, TOAST_MAX_TEXT)
  assert.equal(out.questPages?.[1], 'Bone Chips Grobb')
})

test('questPages ride the quest-item kind ONLY — a boss kill’s are dropped', () => {
  assert.equal(validateToastRequest({ ...boss, questPages: ['Bone Chips Felwithe'] })?.questPages, undefined)
  assert.equal(validateToastRequest({ ...ding, questPages: ['Bone Chips Felwithe'] })?.questPages, undefined)
  // …and a non-list is not a list, whatever kind sent it.
  assert.equal(validateToastRequest({ ...drop, questPages: 'Bone Chips Felwithe' })?.questPages, undefined)
})

test('a quest-item request with NO pages is still perfectly valid — the item card carries it', () => {
  const out = validateToastRequest(drop)
  assert.deepEqual(out, drop)
  assert.equal('questPages' in (out ?? {}), false, 'an empty list is an ABSENT field, never []')
})

test('the quests tab is a legal deep-link destination, anchored on the catalog’s PAGE title', () => {
  assert.deepEqual(validateToastRequest({ ...drop, focus: { view: 'quests', quest: 'Bone Chips Felwithe' } })?.focus, {
    view: 'quests',
    quest: 'Bone Chips Felwithe'
  })
  // No anchor ⇒ the tab itself, which is a destination too.
  assert.deepEqual(validateToastRequest({ ...drop, focus: { view: 'quests' } })?.focus, { view: 'quests' })
})

// ---- the wish list's two kinds ---------------------------------------------------------------
//
// A wish card is what makes the wish list ANSWER rather than merely record: the item you wrote
// down just dropped, or the zone you walked into is where it drops. Both are producer kinds (they
// cross `toast:show`), both land on the Wish list tab, and neither carries a quest.

const wishDrop = {
  id: 'wishDrop:earthen blade:1700000000000',
  kind: 'wishDrop',
  title: 'Earthen Blade dropped',
  subtitle: 'from a shadowed man · The Ruins of Old Paineel',
  itemName: 'Earthen Blade',
  focus: { view: 'wishlist' }
}

const wishZone = {
  id: 'wishZone:hole:1700000000000',
  kind: 'wishZone',
  title: '2 wished items drop here',
  subtitle: 'Earthen Blade · Elemental Binder',
  focus: { view: 'wishlist' }
}

test('both wish kinds are accepted on the wire, verbatim', () => {
  assert.deepEqual(validateToastRequest(wishDrop), wishDrop)
  assert.deepEqual(validateToastRequest(wishZone), wishZone)
})

test('the Wish list is a legal deep-link destination — and it takes no anchor', () => {
  assert.deepEqual(validateToastRequest({ ...wishZone, focus: { view: 'wishlist' } })?.focus, { view: 'wishlist' })
  // The tab has nothing to drill into, so a `quest`/`mob`/`level` alongside it is just text the
  // destination ignores — the validator still caps it rather than letting it through unbounded.
  assert.deepEqual(validateToastRequest({ ...wishZone, focus: { view: 'wishlist', level: 900 } })?.focus, {
    view: 'wishlist'
  })
})

test('a wish card is not a quest card — questPages are dropped from both kinds', () => {
  assert.equal(validateToastRequest({ ...wishDrop, questPages: ['Bone Chips Felwithe'] })?.questPages, undefined)
  assert.equal(validateToastRequest({ ...wishZone, questPages: ['Bone Chips Felwithe'] })?.questPages, undefined)
})

test('the zone card names no item, so the CARD is its own click target (no action label)', () => {
  // `toastActionLabel` speaks only for destinations it can name; the wish list is not one of them,
  // and a card would rather print nothing than a sentence it invented.
  assert.equal(toastActionLabel({ view: 'wishlist' }), undefined)
})

// ---- the death recap's kind (ROADMAP item 7) ---------------------------------------------------
//
// The FIRST kind that carries neither an item nor a focus: a plain title + subtitle card. There is
// nothing to hand you and nowhere the click could honestly send you — the recap's own surface is
// the Overview card, and a link to the page you were already on is not a destination. So the
// assertions below are as much about what the validator DROPS as about what it keeps.

const death = {
  id: 'death:1700000000000',
  kind: 'death',
  title: 'You died - killed by a fire giant warrior',
  subtitle: '253 damage in the last 15 s · a fire giant warrior · hit'
}

test('the death kind is accepted on the wire, verbatim', () => {
  assert.deepEqual(validateToastRequest(death), death)
})

test('a death card names no item and no destination — both are dropped if a caller sends one', () => {
  const out = validateToastRequest({ ...death, questPages: ['Bone Chips Felwithe'] })
  assert.equal(out?.questPages, undefined)
  // …and a focus, if one is ever sent, is still held to the closed view union.
  assert.equal(validateToastRequest({ ...death, focus: { view: 'deaths' } })?.focus, undefined)
})

test('…and the card itself offers no action label, because it names no destination', () => {
  assert.equal(toastActionLabel(undefined), undefined)
})

// ---- the update card is MAIN'S, and the wire says so twice (EQ Zera, 2026-09-08) ---------------
//
// The updater's card is the only one in the app whose click downloads an executable and restarts
// the process into it. It is built in main (shared/updateToast.ts) and pushed straight at the
// overlay window, so nothing legitimate ever sends one over `toast:show` — which makes every
// assertion below a statement about what an ATTACKER (or a bug in a renderer) can ask for. Two
// independent refusals, either of which would be enough on its own:
//
//   * the KIND is not in TOAST_KINDS, so a request naming it is null before anything else is read;
//   * `action` is not a field the validator copies, so it cannot ride in on an accepted kind.

test('the `update` kind is REFUSED from a renderer request — main builds that card, nobody asks for it', () => {
  assert.equal(validateToastRequest({ id: 'update:9.9.9', kind: 'update', title: 'EQ Zera 9.9.9 is ready' }), null)
  // …including with the action that would arm it, and including a plausible-looking full payload.
  assert.equal(
    validateToastRequest({
      id: 'update:9.9.9',
      kind: 'update',
      title: 'EQ Zera 9.9.9 is ready',
      subtitle: 'Click to download and install',
      action: 'updateInstall',
      durationMs: 30_000
    }),
    null
  )
})

test('…and `action` is STRIPPED from every kind that IS accepted, so it can never ride in', () => {
  for (const action of ['updateInstall', 'updateDownload', 'anything']) {
    const out = validateToastRequest({ ...boss, action })
    assert.ok(out)
    assert.equal('action' in out, false, `action ${action} survived on a boss kill`)
    assert.deepEqual(Object.keys(out).sort(), ['id', 'kind', 'subtitle', 'title'])
  }
  // A card that DOES something is a card a renderer must never be able to conjure: the overlay
  // renders a button from `action` alone, and main's handler runs whatever name comes back.
  assert.equal('action' in (validateToastRequest({ ...ding, action: 'updateInstall' }) ?? {}), false)
  assert.equal('action' in (validateToastRequest({ ...death, action: 'updateDownload' }) ?? {}), false)
})

test('a subtitle-only card is a legal payload — no item, no quests, no focus', () => {
  const out = validateToastRequest(death)
  assert.ok(out)
  assert.equal(out.itemName, undefined)
  assert.equal(out.questPages, undefined)
  assert.equal(out.focus, undefined)
  assert.equal(out.subtitle, death.subtitle)
})
