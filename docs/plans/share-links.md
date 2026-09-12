# Share links — a character profile as a URL

Status: **IN BUILD** (2026-09-08). Owner rulings on this page are binding; the file is the
self-contained spec both halves are built from. Phase 1 (v1.20.0) shipped the paste string, the
card PNG and the text summary with no server. This is phase 2: the same envelope, stored under an
opaque id, served back as JSON to the app and as an HTML page to a browser.

## Owner rulings (2026-09-08)

1. **Names and servers stay visible** on a shared profile. No pseudonymous mode.
2. **A share expires 180 days after its last view or update.** A view refreshes the clock at
   most once every 30 days (so reads stay cheap); an update always refreshes it.
3. **Hosting: Cloudflare Workers + Workers KV**, free tier. The eqzera.com zone is on Cloudflare
   DNS as of 2026-09-08, so the worker serves `https://share.eqzera.com` as a custom domain.
4. **Every share carries a private delete token**, returned once at creation and kept only in
   the sharer's app. Revoking a link must actually stop it serving (profiles.ts PRIVACY (d)).
5. The link page **unfurls in Discord with the card image** and offers the exact `EQC1-` string
   for pasting into EQ Zera. No deep-link protocol in this phase.

## The contract (both halves import the same code)

The body of a share is `CharacterProfileShare` (`src/shared/characterShare.ts`), wrapped in the
`EQC1` envelope (`src/shared/shareSchema.ts`: `makeEnvelope('character', body, appVersion)`,
`validateEnvelope`, `checksum(canonicalJson(body))`). The app never trusts the service: a fetched
envelope goes through `validateEnvelope` + `sanitizeCharacterShare` exactly as a pasted string does
(`src/main/characterShare.ts` `decodeCharacterShare` is the model). The service never trusts the
app: it runs the same two functions before storing, and stores only what survives.

### Service — `share-server/` (Cloudflare Worker, TypeScript, no framework)

Bindings (`share-server/wrangler.toml`): KV namespace `SHARES`; rate limiter `CREATE_LIMIT`
(20 per minute per IP) and `READ_LIMIT` (300 per minute per IP) via the Workers rate-limiting
binding; `PUBLIC_ORIGIN = "https://share.eqzera.com"`; custom domain route `share.eqzera.com`.

Keys: `share:<id>` → JSON `{ envelope, createdAt, updatedAt, lastSeenAt, tokenHash, hasCard }`;
`card:<id>` → image bytes (PNG, JPEG or WebP; the type is read off the signature when served). Both written with `expirationTtl = 180 days` and rewritten (same TTL)
on update, and on a view when `lastSeenAt` is older than 30 days. `id` = 10 chars from
`[A-Za-z0-9]` out of `crypto.getRandomValues`; `deleteToken` = 32 random bytes base64url;
`tokenHash` = SHA-256 hex of the token (the token itself is never stored).

| Route | Body / auth | Reply |
| --- | --- | --- |
| `POST /api/v1/shares` | JSON `{ envelope, card?, cardMap? }`; `cardMap` (2026-09-09) = `{ slot, x, y, w, h }[]`, one per gear cell drawn on the card, in fractions of the card image (0..1, top-left origin), `slot` an envelope cell's slot id, at most 40, honoured only alongside a `card` (entries with an unknown slot or a number outside 0..1 are dropped); the page overlays a hotspot per entry; `card` = base64 PNG, JPEG or WebP (by signature) ≤ 1 MB decoded (was PNG ≤ 400 KB until 2026-09-09; raised so a full-resolution card fits as JPEG); envelope JSON ≤ 64 KB; must pass `validateEnvelope` with `kind === 'character'` and `sanitizeCharacterShare(body) !== null` | `201 { id, url, deleteToken, expiresAt }` |
| `PUT /api/v1/shares/:id` | same body; `Authorization: Bearer <deleteToken>` | `200 { id, url, expiresAt }` (id and URL unchanged) |
| `DELETE /api/v1/shares/:id` | `Authorization: Bearer <deleteToken>` | `204` (both keys removed) |
| `GET /p/:id` | — | `200 { envelope, cardMap?, history, createdAt, updatedAt, expiresAt }`, `Cache-Control: no-store`; refreshes TTL per ruling 2. `history` (2026-09-12) is the `Snapshot[]` of past states, newest first, empty until the share is re-published — see "Gear history on the share page" below |
| `GET /c/:id.png` | — | the card bytes under the `Content-Type` their signature says (`image/png`, `image/jpeg` or `image/webp`; the `.png` path is kept for every link already out), `Cache-Control: public, max-age=3600`; `404` when absent |
| `GET /s/:id` | — | the HTML page (below) |
| `GET /` | — | 302 to `https://eqzera.com/` |

Errors are JSON `{ error: <code>, message }` with 400 (bad body), 401 (bad token), 404, 413
(too large), 415 (not JSON), 429 (rate limited). Unknown routes 404. No CORS headers on `/api`
(the app calls from the main process, not a browser). Every response carries
`X-Content-Type-Options: nosniff`; HTML carries a strict CSP (`default-src 'none'; img-src 'self';
style-src 'nonce-…'; script-src 'nonce-…'`).

The HTML page renders, server-side and HTML-escaped, from the sanitized body: title
`<name> · Level <n> <classes>` (name falls back to `A character`), the card image when present
(`/c/:id.png`), the worn slots as a list (slot label, item name with its `+N`, exaltations,
ornament), the totals (AC, stats, saves, unsummed), the four scores or "not computed yet",
`Shared from EQ Zera · <date>`, a **Copy share string** button (the `EQC1-` string is built on the
server: `SHARE_PREFIX + base64url(deflate-raw(canonicalJson(envelope)))` via `CompressionStream`),
and links to `https://eqzera.com/` and its `#install`. Open Graph + Twitter tags: `og:title`,
`og:description` (AC and the four scores, or the class line), `og:image` = the card URL,
`og:url`, `twitter:card = summary_large_image`. Palette and type match the website
(`website/additional.css`: ground `#0c0a1f`, panel `#1a1638`, line `#2d2757`, ink `#efeaff`,
cyan `#5ee6ff`, pink `#ff5fb8`, display face Chakra Petch, body Source Sans 3, mono JetBrains
Mono — inline `@font-face` from `website/fonts.css` is fine, or system fallbacks).

The handler is a pure function `handleRequest(request: Request, env: Env, now = Date.now()):
Promise<Response>` in `share-server/src/handler.ts`; `share-server/src/index.ts` is the three-line
Worker entry. `tests/shareServer.test.mts` (root suite, node:test, no Cloudflare runtime) drives the
handler with an in-memory `KVNamespace` fake and a no-op limiter through every route, including:
create → read → HTML → PNG → delete → 404; update with a wrong token → 401; oversize → 413; a
tampered envelope → 400; the TTL refresh rule (a read at 20 days does not rewrite, at 40 days does);
HTML escaping of a hostile item name; the share string on the page round-trips through
`decodeShareString` (`src/main/shareCodec.ts`).

### App

Main-process only (renderer performs no fetch: `connect-src 'self'`).

- `src/main/share/net.ts` — the compiled-in origin, same law as `feedback/net.ts`: `const
  COMPILED_SHARE_ORIGIN = 'https://share.eqzera.com'`, NO user-configurable override, a loopback-only
  dev override `EQ_SHARE_URL` gated by the same `devUnlocked` facts (import `devUnlocked` /
  `RuntimeFacts` from `../feedback/net`; do not copy them), `shareEndpointConfigured()`, and a
  `shareUrlFor(id)`. `postJson`-style helpers with `AbortSignal.timeout(15_000)` and the app UA.
- `src/main/share/links.ts` — `publishShare(profile, cardPng: Buffer | null, existing?: {id,
  deleteToken})` (POST or PUT), `revokeShare(id, deleteToken)`, `fetchSharedProfile(urlOrId)`
  which accepts a full URL only when its origin is the compiled origin (or the dev origin) and
  returns `CharacterShareRead` after `validateEnvelope` + `sanitizeCharacterShare`.
  `parseShareLink(text)` → `id | null` for `https://share.eqzera.com/s/<id>` and `/p/<id>`.
- Persisted: `shareLinks: ShareLinkRecord[]` in the store (`src/main/store.ts`; follow the
  migrations convention in AGENTS.md "Settings migrations"), `ShareLinkRecord = { id, url,
  deleteToken, name?, level?, classes, createdAt, updatedAt }`. One record per character
  (`name` + first class line) so re-sharing updates the same URL.
- IPC (`src/shared/ipc.ts`): `characterShareLink: 'character:shareLink'` (renderer sends `{ rect,
  profile }`; main captures the card via the existing `capturePage` path, publishes, records, and
  replies `{ ok: true, url, updated: boolean } | { ok: false, error }`), `characterShareRevoke:
  'character:shareRevoke'` (`{ id }`), `characterShareLinks: 'character:shareLinks'` (list). Preload
  `src/preload/characterApi.ts` gains `shareCharacterLink`, `revokeCharacterLink`,
  `listCharacterLinks`. `readCharacterShare(text)` accepts a link as well as a string: main detects
  `parseShareLink` first.
- `src/main/security.ts` `EXTERNAL_LINK_ALLOWLIST`: `{ host: 'share.eqzera.com', pathPrefix: '/s' }`
  (narrowest scope that serves the link).
- Renderer: `ShareDialog.tsx` gains **Copy link** (`data-testid="character-share-copy-link"`) beside
  Copy share string: it calls `shareCharacterLink`, copies the URL, flashes "Link copied" or the
  error, and shows the current link with a **Revoke** button when one exists for this character.
  `ViewSharedProfile.tsx`: placeholder becomes "Paste a share string or a share.eqzera.com link";
  same Show profile button. Both stay MUI, no domain munging (no `.filter`/`.sort` over domain
  collections in renderer code).
- Tests: `tests/shareNet.test.mts` (no Electron: the no-override law, dev gate, `parseShareLink`,
  `shareUrlFor`), `tests/shareLinks.test.mts` (fetch mocked via an injected `fetch`, validation on
  the way in, wrong-origin URL refused), `tests/security.test.mts` gains the allowlist row;
  `tests/e2e/character-share.e2e.mts` gains one step: with the endpoint dark (e2e runs set
  `EQ_SHARE_URL` to nothing and the compiled origin is unreachable) the Copy link button reports
  an error and the dialog stays usable.

## Gear history on the share page (2026-09-12, service half BUILT)

A share link is re-published under the same id every time the sharer re-shares that character
(`PUT /api/v1/shares/:id`, "id and URL unchanged"), and until now the state it replaced was simply
gone. The page now keeps the last thirty and says **what changed** — the one question a reader of
someone's profile asks that the page could not answer.

**The key.** A third row beside the record and the card: `hist:<id>` → `Snapshot[]`, **newest
first, capped at 30** (`share-server/src/history.ts`; `HISTORY_CAP`, `KEY_HISTORY` in `env.ts`).
Same `expirationTtl` of 180 days, rewritten by the same `touch` as the other two so all three
expire together, and removed by `DELETE /api/v1/shares/:id` with them. It is a separate key, not a
field on the record, so the common read never pays to parse thirty old states.

**What writes it.** Only a PUT, and only the state it is REPLACING: the stored envelope goes back
through `acceptEnvelope` and the resulting sanitized profile becomes one snapshot, stamped with
`record.updatedAt` — the moment that state was *published*, not the moment it was displaced. **A
POST writes nothing**: a share nobody has re-published costs no history row, and the page draws no
empty panel.

**One snapshot, exactly:**

```jsonc
{
  "at": "2026-09-10T18:04:11.000Z",  // ISO-8601 of the write that published THIS state
  "ac": 231,                          // totals.ac
  "scores": { "tank": 70, "dps": 61, "heal": 38, "solo": 55 },  // OPTIONAL, all four or none
  "level": 60,                        // OPTIONAL
  "classes": ["WAR", "CLR", "SHM"],
  "items": [{ "slot": "chest", "item": "Breastplate +3", "tier": 3 }]  // `tier` OPTIONAL
}
```

`item` is the Name column **verbatim, ` +N` and all** — the same string the gear list renders. No
stat blocks, no effects, no card: thirty full profiles would be a megabyte nobody reads, and
everything the panel says is derivable from these. Read back through a sanitizer (same law as the
envelope: KV is a place, not a type), so junk in the namespace is dropped rather than rendered.

**`GET /p/:id` gains `history: Snapshot[]`** — always present, usually empty. That is the whole
API change; `createdAt`, `updatedAt`, `expiresAt`, `envelope` and `cardMap` are untouched.

**The page** (`share-server/src/pageHistory.ts`, styles in `pageStyle.ts`) grows a **History**
panel below Worn gear when the list is non-empty. One row per snapshot, newest first, each row a
TRANSITION against the **next-newer state** — row 0 against the profile on the page right now, row
`i` against row `i-1`:

* the date the row's state was published;
* **AC** and the four scores, as `231 → 247` with a signed delta (`+16`) when they moved, and as
  the bare figure when they did not — so a row reads on its own and the arrow means something;
* the **slots whose item changed**, `Chest: Old Name +3 → New Name +5`; unchanged slots are
  omitted, and a slot that gained or lost an item reads from or to `(empty)`. The label is the
  current profile's screen label for that slot, falling back to the raw slot id;
* at most **ten rows**, then a muted `N earlier snapshots`. The cap is on the rendering; `/p/:id`
  hands the app all thirty.

Every string goes through `esc()` and nothing emits a `style=` attribute — the CSP rules are
unchanged. `tests/shareHistory.test.mts` (root suite) covers the write rules, the snapshot shape,
the deltas, the escaping, the ten/thirty caps, the shared expiry and the delete.

## Not in this phase

`eqzera://` deep links; showing other people's links inside the app beyond the paste box; any
analytics on views; a "my links" page on the website.
