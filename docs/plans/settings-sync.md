# Settings sync — "send my settings to another PC"

Status: **BOTH HALVES BUILT** (2026-09-12 — service `share-server/src/sync.ts`, app
`src/main/share/sync.ts`). This page is the contract both halves are built from.

A person who plays on a desktop and a laptop sets EQ Zera up twice: alerts, overlays, sound packs,
window layout, the Discord channel. Exporting a settings file and carrying it on a stick works and
is what the app does today; this is the same thing with the carrying done for them — **a ten-
character code on one PC, typed into the other**.

## Owner-facing shape

* Preferences → Sharing → **Send settings to another PC**. The app encrypts the bundle, posts it,
  and shows one line to copy or read aloud: `AbCdEfGhIj-7QF3KP`.
* On the other PC: Preferences → Sharing → **Receive settings**, paste that line, and the app
  fetches, decrypts and runs its existing **import-merge** rule — the same merge an imported
  settings file goes through, with the same preview and the same refusals. Sync is a transport, it
  is not a second import path.
* The code stops working after **24 hours**, and the sender can end it sooner with **Stop sharing**.

## ZERO KNOWLEDGE — the one law this feature has

A settings bundle is the most personal thing the app holds: alert regexes with guild and character
names in them, a Discord webhook URL (a bearer credential), window geometry, file paths. **It must
never sit on the server in the clear, and the design makes that impossible rather than promised.**

* **The app encrypts before anything leaves the machine.** AES-GCM, a fresh 256-bit key per send,
  fresh IV. The service is handed ciphertext as base64 and stores exactly that.
* **The key never reaches the server.** It is shown to the user as the second half of the line —
  the `-7QF3KP` above, a **6-character key segment** the app derives the AES key from. The app
  displays `code-key`; the app SENDS only `code`. A server operator, a KV dump, a subpoena and a
  network tap all see the same thing: bytes nobody in that path can open.
* **So there is no decrypt path in `share-server/`, and nothing to add one to.** `sync:<code>` is
  an opaque string with an expiry. The service cannot tell a settings bundle from noise, which is
  also why it never validates the plaintext: it has none.
* The app must refuse a decrypt that fails rather than importing anything partial, and must say
  which half of the line was wrong when it can tell (a 404 is the code; a decrypt failure is the
  key segment).

## The contract

Three routes on the share worker (`share-server/src/sync.ts`), matched on pathname only like the
rest. No CORS headers: the app calls these from its **main process**, never from a renderer.

| route | body / params | on success | errors (`{error, message}` JSON) | rate limit |
| --- | --- | --- | --- | --- |
| `POST /api/v1/sync` | `application/json` `{ "blob": "<base64 ciphertext>" }` | `201 { code, expiresAt }`, `Cache-Control: no-store` | 400 `bad-json`; 400 `bad-blob` (missing, empty, not a string, or not base64); 413 `too-large`; 415 `not-json`; 429 `rate-limited` | `CREATE_LIMIT` |
| `GET /api/v1/sync/<code>` | path | `200 { blob, expiresAt }`, `Cache-Control: no-store`; **the row is NOT deleted** | 404 `not-found`; 429 `rate-limited` | `READ_LIMIT` |
| `DELETE /api/v1/sync/<code>` | path, no auth | `204`, always | 404 `not-found` (only for a malformed code); 429 `rate-limited` | `CREATE_LIMIT` |

`HEAD` behaves as `GET`. Any other method, and any other `/api/v1/sync/…` path, is 404 `not-found`.

### The code

10 characters of `[A-Za-z0-9]` from `codec.ts` `newId` — the same rejection-sampled draw off
`crypto.getRandomValues` that mints a share id, so the alphabet carries no punctuation and the
string survives being read down a phone line. 62^10 ≈ **2^59.5**.

Why that is enough without a second token: a guesser is rate-limited to `READ_LIMIT` (300/min per
IP) against a space of 2^59.5 whose rows live 24 hours, and a code they did land on yields **an
AES-GCM blob they still cannot open** — the key segment was never on the wire. The code is a
locator with a lock behind it, not the lock.

### Sizes, TTL and the keys

| | |
| --- | --- |
| decoded ceiling | **512 KB** (`MAX_SYNC_BYTES`). The app's own settings JSON is tens of KB; the room is for sound-pack references and a large alert set, not for attachments. |
| body ceiling | checked in UTF-8 **bytes before `JSON.parse`**, so a hostile length never becomes a hostile allocation. Both ceilings answer 413 `too-large`. |
| TTL | **86 400 s** (24 h), as `expirationTtl` on the one write. There is no sweeper and nothing to run. |
| key | `sync:<code>` in the existing `SHARES` namespace → `{"blob":"<base64>","at":<epoch ms>}` |

`at` is stored so `expiresAt` on the way back out is the real expiry of that row rather than a
number invented at read time. It is the only field beside the ciphertext, and it is not a fact
about the user.

### Two decisions worth stating, because they look like omissions

* **Reading does not consume.** A one-shot read would mean a mistyped key segment, or an import the
  app refused halfway, had burned the only copy — and the user walks back to the first PC. The
  24-hour expiry ends the parcel, not the first reader. (A share link's `/discord/claim` is the
  opposite, and deliberately: there the row is a bearer credential with no second lock on it.)
* **`DELETE` takes no token: the code IS the secret.** Whoever can read the parcel can end it. What
  that costs is a stranger who somehow has the code can delete it — an annoyance ("that code no
  longer works, make another"), never a disclosure, because deleting is *all* it buys them. What it
  buys is one secret to move between two machines instead of two. `DELETE` is also idempotent and
  silent about existence (204 whether or not anything was there), so it is not a membership oracle
  for a code somebody is walking.

## App side (BUILT 2026-09-12)

Main-process only, behind the compiled origin, exactly like the rest of `src/main/share/`
(AGENTS.md "Cloud"): `share.eqzera.com` is already the one outbound origin this uses, so nothing new
is added to the app's allowlist and nothing changes in the CSP — the renderer performs no fetch,
holds no key, and never sees the decrypted payload.

**TWO PLACES WHERE THE BUILD DIVERGED FROM THIS PAGE'S EARLIER APP SKETCH**, both app-side only and
therefore invisible to the service:

* **The key segment is 12 random bytes shown as 16 base64url characters, not 6 characters of the
  service's alphabet.** A 6-character `[A-Za-z0-9]` segment is ~35.7 bits, and it is the ONLY lock
  on a parcel whose locator travels in the same line — so the lock is sized to be the lock. The AES
  key is `SHA-256(keyBytes)` either way, so the cipher is 256-bit while the thing on screen stays
  short enough to read down a phone line: `Ab3dE9fGh1-AQIDBAUGBwgJCgsM`, 10 + 1 + 16 = 27 characters.
* **The UI is its own Preferences section, `Sync`, not a line under `Sharing`.** Sharing is where a
  Discord channel gets connected; Profiles is where a readable string is handed to another PERSON.
  This carries the same bundle to another MACHINE OF YOURS through a service that cannot read it — a
  different audience, so its own rail row, directly under Sharing.

`stopSharing` (the `DELETE` route) is NOT built: nothing in the app revokes a transfer, and a code
expires on its own after 24 hours. The route is spec'd, unused, and the one thing left to wire if the
owner wants a Stop sharing button.

### Encryption (`src/main/share/syncCrypto.ts`)

The plaintext is `{ v: 1, settings: "<the EQC1- string from exportSettingsString>", discordChannels?: DiscordChannel[] }`.

* **AES-256-GCM**, key `SHA-256(keyBytes)`, a fresh 12-byte iv per transfer, `aad = 'eqzera-sync-v1'`
  (so a blob minted for some other purpose cannot be replayed into this one even with the right key),
  and the blob is `base64(iv || tag || ciphertext)` — the tag at a FIXED OFFSET, so a truncated blob
  fails a length check instead of authenticating a prefix.
* **The transfer code splits at the FIRST hyphen.** A service code cannot contain one (closed class);
  base64url can. Parsing is lenient about carrying — surrounding whitespace, spaces typed inside it,
  a wrapped line, quotes and backticks are all stripped — and STRICT about case, because both halves
  are case-sensitive and folding one would refuse a code somebody typed exactly right.
* **A decrypted payload is still parsed, never read.** GCM proves the bytes came from a holder of
  the key; it proves nothing about their shape, and this payload can carry Discord webhook tokens.
  So `sanitizeSyncPayload` refuses an unknown `v` and runs every channel through the store's own
  closed classes (`shared/discordChannels.ts sanitizeChannel`), de-duplicated by webhook id.

### The Discord channels are opt-in at BOTH ends

They are credentials: anyone holding a webhook id and token can post to that channel forever. So
they travel only when the SENDER ticks "Include connected Discord channels" (default off) and are
stored only when the RECEIVER ticks the box on the preview (default off, and only shown when the
transfer actually carries some). Both defaults are enforced at the IPC handler, so an argument the
renderer omits — or a truthy value that is not `true` — stores nothing. A duplicate webhook id is
SKIPPED rather than replaced: the local row may have been renamed or made the default, and re-adding
it would quietly undo both.

### Where the code lives

* `src/shared/settingsSync.ts` — pure: the ERROR SENTENCES in one place, the result shapes that
  cross IPC, the 512 KB bound, the 24-hour lifetime and the two notices the card draws.
* `src/main/share/syncCrypto.ts` — the cipher, the payload sanitizer, and the code format/parse.
* `src/main/share/net.ts` — `syncUrl()` / `syncRecordUrl(code)` beside `createUrl`/`recordUrl`, on
  the same compiled-in origin. That is what makes the feature DARK under `EQ_E2E` for free:
  `SHARE_ORIGIN` is the empty string there, so no request is possible at all.
* `src/main/share/sync.ts` — `sendSettings`, `receiveSettings`, `applyReceivedSettings`,
  `syncAvailable`. Every impure seam is INJECTED (`SyncDeps`: `fetch`, the settings
  export/preview/apply, the channel store), so the module is Electron-free and node-testable.
* `src/main/ipc/sync.ts` — the four handlers, registered from `src/main/ipc/index.ts`. It holds the
  ONE piece of state in the feature: the decrypted payload between a preview and an apply, keyed by
  the transfer's service code. It is held here rather than round-tripped for the reason
  `character:shareLink` keeps its delete token — a payload can carry a webhook token, and the
  renderer has nothing to do with it. One slot; a second receive replaces it, an apply consumes it.
* `src/preload/syncApi.ts` — four methods (`syncAvailable`, `sendSettingsToPc`,
  `receiveSettingsFromPc`, `applySettingsFromPc`), spread into `api` like `discordApi`.
* `src/renderer/src/features/preferences/SyncSetting.tsx` + `useSettingsSync.ts` — the card and its
  state, plus the `syncSection()` descriptor registered by one line in `PreferencesView.tsx`. It is
  a SECTION rather than a line under Profiles because the other end is different: Profiles hands a
  readable string to another PERSON, this carries the same bundle to another MACHINE OF YOURS
  through a service that cannot read it.

### IPC

`sync:available` (boolean — false in a dark build, which is what the card's disabled state is drawn
from), `sync:send` (`{ ui, includeDiscord }` → `{ ok, code, expiresAt } | { ok: false, error }`),
`sync:receive` (`code, uiPrefs` → `{ ok, preview, discordChannels? } | { ok: false, error }`),
`sync:apply` (`{ code, ui, includeDiscord }` → counts + the localStorage writes the renderer must
perform). No key, no payload and no webhook token crosses in either direction.

### The card

Preferences → **Sync** → "Send settings to another PC":

* `pref-sync-send` — the button; `pref-sync-include-discord` — the tick box beside it.
* `pref-sync-code-text` — the code in a monospace box; `pref-sync-code` — Copy. Under it:
  *"Codes work for 24 hours. Anyone with the code can import these settings, so share it only with
  yourself."*
* `pref-sync-receive-code` + `pref-sync-receive` — type a code and fetch it; `pref-sync-preview`
  then shows what it would add with `pref-sync-apply` / `pref-sync-cancel`, plus
  `pref-sync-take-discord` when the transfer carries channels.
* Success flash: "Settings imported", or "Settings imported. N Discord channels added".
* `pref-sync-dark` — under `EQ_E2E` or any build with no origin: *"This build cannot sync
  settings."*, and both buttons disabled.

### The sentences (all of them, `shared/settingsSync.ts SYNC_ERROR`)

| case | sentence |
| --- | --- |
| dark build | This build cannot sync settings. |
| no answer (status 0) | The sync service could not be reached. |
| 429 | Too many transfers just now - try again in a minute. |
| 413, or too large before the request | Those settings are too large to send. |
| 400 / 5xx on a send | The sync service would not store those settings. |
| a reply this app cannot read | The sync service answered something this app could not read. |
| 404 / 410, or an apply with no pending transfer | That code is not valid any more. Codes work for 24 hours. |
| a code that is not one | That does not look like a transfer code. |
| wrong key, tampered, truncated | That code does not match this transfer. |

A settings string the planner itself refuses keeps the PASTE BOX's own prose, so the two import
doors never disagree about the same bundle.

### Tests

* `tests/syncCrypto.test.mts` — round trip with and without channels, two encryptions differ, the
  code format and its lenient parsing, case is not folded, a flipped byte in the nonce / tag /
  ciphertext, a truncated blob, a wrong key, an unknown `v`, and the channel sanitizer.
* `tests/syncSettings.test.mts` — the POST body is `{ blob }` and the key out of the SHOWN CODE is
  what opens it; the key never reaches a URL or a header; channels only when ticked; every failure
  sentence; apply runs the existing merge, stores channels only on confirmation, and skips a
  duplicate webhook id without touching the local row's label.
* `tests/e2e/settings-sync.e2e.mts` — the section renders with both buttons and the tick box, and
  under the dark e2e origin the card shows the "cannot sync" sentence with both buttons disabled.

## Not in this phase

Automatic or continuous sync; syncing anything but the settings bundle (no logs, no analytics, no
character profiles — those are share links); more than one parcel per code; any server-side notion
of who sent what. App-side: revoking a transfer (the code expires on its own), syncing anything
outside the existing GLOBAL whitelist (no character progress, no machine paths — the
`src/shared/profiles.ts` classification is unchanged), and per-row selection on the received preview
(the transfer applies the import's own defaults, exactly as the paste box's Add button does).
