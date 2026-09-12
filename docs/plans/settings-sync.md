# Settings sync — "send my settings to another PC"

Status: **service half BUILT** (2026-09-12, `share-server/src/sync.ts`); app half pending. This
page is the contract both halves are built from.

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

## App side (pending)

Main-process only, behind the compiled origin, exactly like the rest of `src/main/share/`
(AGENTS.md "Cloud"): `share.eqzera.com` is already the one outbound origin this would use, so
nothing new is added to the app's allowlist.

* `src/main/share/sync.ts` — `sendSettings(bundle)` → encrypt (`node:crypto` AES-256-GCM), POST,
  return `{ code, key, expiresAt }`; `receiveSettings(code, key)` → GET, decrypt, hand the
  plaintext to the existing import-merge; `stopSharing(code)` → DELETE. `AbortSignal.timeout(15_000)`
  and the app UA, from `share/net.ts`.
* The key segment is 6 chars of the same alphabet, stretched into the AES key; it is generated per
  send, shown once, and never persisted — a settings sync the user did not finish is a dead row on
  the server and nothing on either machine.
* IPC + Preferences → Sharing UI, the two buttons above, with the line shown as `code-key` and a
  copy button.
* The e2e law holds: with the endpoint dark (`EQ_E2E`) both buttons report an error and the pane
  stays usable.

## Not in this phase

Automatic or continuous sync; syncing anything but the settings bundle (no logs, no analytics, no
character profiles — those are share links); more than one parcel per code; any server-side notion
of who sent what.
