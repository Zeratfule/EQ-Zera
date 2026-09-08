// shared/shareLinks.ts — WHAT A PUBLISHED SHARE LINK IS, for both sides of the IPC.
//
// The record is persisted in main (`StoreShape.shareLinks`) and a REDACTED view of it is what the
// Share dialog draws, so the shape lives here the way `RespawnPrefs` does: one declaration, one
// normalizer, and no chance of the store and the renderer disagreeing about a field.
//
// THE REDACTION IS THE POINT, AND IT IS A TYPE. `ShareLinkRecord` carries the delete token — the
// only thing that can stop a link serving (docs/plans/share-links.md ruling 4) — and
// `ShareLinkView` is the same record without it. A renderer that cannot NAME the token cannot ask
// for it, so "the token never leaves main" is checked by the compiler rather than remembered.
//
// ONE RECORD PER CHARACTER, KEYED BY NAME + LOADOUT (`shareLinkKey`). Re-sharing the same
// character updates the same URL, which is what makes a link you posted last week keep showing
// this week's gear; a different loadout is a different card and gets its own link. The key is
// computed in ONE place because the publish path and the "do I already have a link for this?"
// read must never disagree about what "the same character" means.

/** Bounds on everything a stored record holds. A store file is untrusted input like any other. */
const MAX_ID = 32
const MAX_URL = 2048
const MAX_TOKEN = 256
const MAX_NAME = 120
const MAX_CLASSES = 8
const MAX_CLASS = 60

/** A published link, as main stores it. `deleteToken` never crosses the IPC boundary. */
export interface ShareLinkRecord {
  /** the service's opaque id */
  id: string
  /** the link a sharer copies, rebuilt from the compiled origin rather than taken from a reply */
  url: string
  /** the private token that can revoke it, returned once at creation */
  deleteToken: string
  /** the character's name, when the profile carried one */
  name?: string
  /** the level the card printed, when the profile carried one */
  level?: number
  /** the resolved loadout, in the order the profile stated it */
  classes: string[]
  /** epoch ms the link was first published */
  createdAt: number
  /** epoch ms it was last replaced */
  updatedAt: number
}

/** The same record with the token removed. This is the only shape the renderer ever sees. */
export type ShareLinkView = Omit<ShareLinkRecord, 'deleteToken'>

/** Who a link is FOR - the two facts that decide whether a re-share replaces or creates. */
export interface ShareLinkOwner {
  name?: string | undefined
  classes: readonly string[]
}

/**
 * The identity a record is filed under: the name and the loadout, both as the profile stated
 * them. Case-sensitive, because EQ names are, and a name is not something this app respells.
 */
export function shareLinkKey(owner: ShareLinkOwner): string {
  return `${owner.name ?? ''}|${owner.classes.join('/')}`
}

function boundedString(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function boundedStamp(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * A stored value → a record this app will use, or null. Rebuilt field by field rather than
 * trusted: a hand-edited store must not be able to put a `javascript:` string where a link goes,
 * and every reader of this list either draws the url or sends the token in a header.
 */
export function sanitizeShareLink(v: unknown): ShareLinkRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const id = boundedString(r.id, MAX_ID)
  const url = boundedString(r.url, MAX_URL)
  const deleteToken = boundedString(r.deleteToken, MAX_TOKEN)
  if (id === '' || deleteToken === '' || !url.startsWith('https://')) return null
  const classes = Array.isArray(r.classes)
    ? r.classes.slice(0, MAX_CLASSES).map((c) => boundedString(c, MAX_CLASS))
    : []
  const name = boundedString(r.name, MAX_NAME)
  const level = typeof r.level === 'number' && Number.isFinite(r.level) ? Math.floor(r.level) : undefined
  const createdAt = boundedStamp(r.createdAt)
  return {
    id,
    url,
    deleteToken,
    ...(name === '' ? {} : { name }),
    ...(level === undefined ? {} : { level }),
    classes,
    createdAt,
    updatedAt: boundedStamp(r.updatedAt) || createdAt
  }
}

/** Strip the token. The one function that turns a record into something a renderer may hold. */
export function shareLinkView(rec: ShareLinkRecord): ShareLinkView {
  const { deleteToken: _token, ...view } = rec
  return view
}
