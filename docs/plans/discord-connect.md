# Connecting a Discord channel with Discord's own picker

Status: **service half BUILT** (2026-09-11, `share-server/src/discord.ts`); app half pending. This
page is the contract both halves are built from. It extends
[discord-webhook.md](discord-webhook.md), which shipped the paste-a-webhook-URL flow in 1.23.0 and
whose rulings still hold: **the app posts through a channel webhook and nothing else.** No bot, no
scope that reads the user's account, no message ever read back.

## Why a second way to connect

Making a webhook by hand is six clicks in Discord's channel settings and a paste. Discord's
`webhook.incoming` OAuth scope does the same thing with Discord's own **server and channel
picker**: the user clicks Authorize and Discord mints the webhook for the channel they chose. The
one thing that flow needs which the paste flow did not is a **redirect URL on a server that holds
the application's client secret** — a secret compiled into an Electron app is not a secret. That
server is `share.eqzera.com`, which the app already talks to, so this adds no new origin to the
app and no new service to run.

What the app receives is exactly what it stores today: a webhook `{ id, token }`
(`src/shared/discordWebhook.ts`). The rest of the Discord feature — the embed, the outbound-origin
law, the masked view across IPC — is unchanged.

## The contract

All three routes live on the share worker, matched on pathname only like the others. `PUBLIC_ORIGIN`
(`https://share.eqzera.com`) is what `redirect_uri` is built from — never the request's Host.
`<state>` is 32 random bytes as unpadded base64url — `/^[A-Za-z0-9_-]{43}$/` — minted by the app.

| route | params | on success | errors (`{error, message}` JSON unless noted) | rate limit |
| --- | --- | --- | --- | --- |
| `GET /discord/start` | `state` | 302 → `https://discord.com/oauth2/authorize?client_id=<id>&scope=webhook.incoming&response_type=code&redirect_uri=<PUBLIC_ORIGIN>/discord/callback&state=<s>`; writes `discord:pending:<s>` first | 400 `bad-state`; 503 `discord-off`; 429 `rate-limited` | `CREATE_LIMIT` |
| `GET /discord/callback` | `code`, `state` (from Discord); or `error`, `state` | 200 HTML "Connected" page naming the channel; writes `discord:result:<s>`, deletes pending | HTML pages: 400 "This link has expired" (unknown/expired/malformed state, missing code); 200 "Cancelled" (`error=access_denied`); 502 "Not connected" (any other `error`, a token-endpoint failure, timeout, or a reply that is not a webhook grant). JSON: 503 `discord-off`; 429 `rate-limited` | `CREATE_LIMIT` |
| `GET /discord/claim/<state>` | path | 200 JSON (below), `Cache-Control: no-store`; the row is deleted | 404 `not-ready` (pending, callback not yet happened — keep polling); 404 `not-found` (claimed, cancelled, failed, expired, or never started — start over); 400 `bad-state`; 429 `rate-limited` | `READ_LIMIT` |

`HEAD` behaves as `GET` on all three; any other method, and any other `/discord/…` path, is 404
`not-found`. No CORS headers: the app calls `/claim` from the main process, never from a renderer.

### The `/discord/claim` reply, exactly

```jsonc
{
  "webhookId": "987654321098765432",      // 17–20 digits (isWebhookId)
  "webhookToken": "…",                    // 60–100 of [A-Za-z0-9_-] (isWebhookToken)
  "channelId": "111111111111111111",
  "guildId": "222222222222222222",
  "channelName": "raid-logs",             // OPTIONAL: Discord's webhook.name, ≤ 100 chars
  "guildName": "Legends of Norrath",      // OPTIONAL: Discord's guild.name, ≤ 100 chars
  "connectedAt": "2026-09-11T12:00:00.000Z"
}
```

The id and token are re-checked against the app's own filters before the row is handed back, so a
claim never returns a value the app would refuse pasted.

### Keys and TTLs (KV namespace `SHARES`, prefix `discord:`)

| key | value | TTL | written by | deleted by |
| --- | --- | --- | --- | --- |
| `discord:pending:<state>` | `"1"` | 600 s | `/start`, before redirecting | `/callback`, on every terminal outcome |
| `discord:result:<state>` | the claim JSON above | 600 s | `/callback`, on success | `/claim`, on the first read |

So a flow, start to claim, has ten minutes; an unclaimed result vanishes on its own; a claim is
one read.

### Security properties (the comment block in discord.ts says the same)

* **The state is the only key.** A stranger who guesses a pending state within its ten minutes
  can only complete *their own* authorization under it, handing *their* channel's webhook to the
  app that minted the state; that app shows the wrong channel name and the user disconnects it.
  Nothing reaches a channel of the victim's.
* **The token is returned once.** The row is deleted on the first `/claim`; the second is 404.
* **The client secret never leaves the Worker.** It is a Worker secret, sent only to
  `discord.com/api/oauth2/token` over TLS, never echoed, logged or stored. The worker does not
  log at all.
* **`redirect_uri` is built from `PUBLIC_ORIGIN`**, never from the request, and Discord
  additionally refuses any redirect that is not registered on the application.
* The "Connected" page shows the channel name (escaped) and nothing else from Discord's reply;
  the token is never in HTML.

## The app-side sequence (to build)

1. **Mint `state`**: `crypto.randomBytes(32)` as unpadded base64url (43 chars). Main process.
2. **Open the picker**: `shell.openExternal(`${SHARE_ORIGIN}/discord/start?state=${state}`)` —
   the system browser, never a BrowserWindow (the user must see Discord's real origin and may be
   logged in there already).
3. **Poll** `GET /discord/claim/<state>` every **2 s** for up to **10 min**, from main, over the
   same `share/net.ts` law as every other call to `share.eqzera.com`:
   * 404 `not-ready` → keep polling;
   * 404 `not-found` → stop, tell the user "that didn't finish — try again" (cancelled, failed,
     expired, or the row was already claimed);
   * 200 → done.
4. **Store** `webhookId` + `webhookToken` exactly as the pasted webhook is stored today
   (`src/main/storeDiscord.ts`): main-side, like a delete token; **never in the renderer** — the
   renderer gets `DiscordWebhookView` (`{ set, masked }`) and, new, the `channelName`/`guildName`
   for the Preferences label. Discard `state` afterwards.
5. **Post** to `https://discord.com/api/webhooks/<id>/<token>` exactly as
   `src/main/share/discord.ts` does now. Nothing downstream changes.

The paste flow stays as the fallback (a user who does not want to authorize an application can
still make the webhook by hand).

## Discord developer portal settings

* One application ("EQ Zera"). Its **client id** goes in `share-server/wrangler.toml` `[vars]
  DISCORD_CLIENT_ID` (public — it is in every authorize URL). Its **client secret** goes in with
  `npx wrangler secret put DISCORD_CLIENT_SECRET --config share-server/wrangler.toml` and nowhere
  else. Until both exist the three routes answer 503 `discord-off`.
* **OAuth2 → Redirects**: `https://share.eqzera.com/discord/callback`, exactly. Discord refuses
  the authorize request if the `redirect_uri` the worker sends is not on this list.
* **Scope**: `webhook.incoming` only. No `bot`, no `identify`, no `guilds`.
* **No bot user** is created; the "Bot" tab stays untouched. Nothing here needs a gateway
  connection, a bot token, or a permissions integer.
* Nothing to register for the app itself: the app only opens a URL and polls the worker.

## Testing

`tests/shareDiscord.test.mts` drives all three routes through `handleRequest` with the in-memory KV
fake and an injected `fetch` that stands in for Discord's token endpoint (recording the request,
answering a canned grant). Pinned: the authorize URL and the pending row; unknown-state refusal
before Discord is asked; the cancel page; the happy path (row stored, pending gone, "Connected",
no token in HTML); the token request's body (client secret, `redirect_uri` from `PUBLIC_ORIGIN`,
even when the request arrived under another host); claim's not-ready → once → not-found; 503
without the secret; methods; both rate limiters.

---

## The app half, as built (2026-09-11)

The service's side is above; this is what the desktop app does with it, file by file. The sequence
in "The app-side sequence" is implemented exactly, with one addition the owner's direction implies:
**storage became a list**, because the moment connecting a channel is two clicks, people have
several.

### The files

| file | what it owns |
| --- | --- |
| `src/shared/discordChannels.ts` | THE CONTRACT, in one function. `parseDiscordClaim` is the only place the reply's field names are spelled, so a rename on the service side is a one-line fix. Also the label rules, the state class, the record shape, the views that cross IPC, and `pickChannel`. Pure. |
| `src/main/share/discordConnect.ts` | The two URLs (on `SHARE_ORIGIN`, through `shareRequest`, so this feature adds NO outbound origin), `mintConnectState`, `claimOnce` (the status table), `pollForClaim` (injected clock, so ten minutes is a millisecond in a test) and `openConnectPage`. |
| `src/main/discordConnect.ts` | ONE attempt at a time: the session, the status the renderer reads, and the cancel. The poll runs here rather than in the renderer because Preferences is a tab and a tab unmounts. |
| `src/main/storeDiscord.ts` | The list, the default, the one-time fold of the old singular `discordWebhook`, and the re-validation on the way out of the store file. |
| `src/main/ipc/discord.ts` | The doors, and the one post. |
| `src/renderer/src/features/preferences/{SharingSetting,DiscordChannelList,useDiscordChannels}.tsx` | Connect, the wait with its Cancel, the rows, and the collapsed Advanced paste. |
| `src/renderer/src/features/character/share/{useDiscordPost,ShareDialog}.tsx` | Post to Discord, and the channel picker beside it when there is more than one. |

### The label

`channelName` and `guildName` when present → `#<channel> · <guild>`; channel only → `#<channel>`;
server only → `<guild> channel`; neither → `Channel <last 4 of channelId>`. Clamped to 60
characters, and renameable (`discord:renameChannel`, clamped in main) - which is what the last case
is for: "Channel 4321" tells nobody anything, and the person who connected it knows it is the
guild's gear channel.

### The store

`discordChannels?: DiscordChannel[]` and `discordDefaultChannelId?: string`, both additive and
optional, so there is **no schema bump and no migration** (the `shareLinks` precedent). A store that
still carries the singular `discordWebhook` is FOLDED into the list the first time it is read, as
`Connected channel` with empty channel and server ids - nobody told us which channel it was, and an
invented name would be exactly the made-up value world-model law 1 forbids. A webhook pasted under
Advanced becomes a channel labelled `Pasted webhook`, with the same Test, Rename, Remove and
Default as any other. Tokens never cross IPC; what the renderer holds is
`{ channels: [{ id, label, addedAt }], defaultId? }`.

### Which channel a post goes to

The one the dialog named, else the default, else the only one, else **a refusal in words**
("Connect a Discord channel in Preferences, Sharing."). With two channels and no default, picking
one would be the app guessing which of somebody's servers gets their character card.

### Opening the browser

`shell.openExternal` on a URL built in main from the compiled origin, the fixed path and a state
minted from `crypto.randomBytes`. It does NOT go through `security.ts`'s `allowedExternalUrl`, and
the allowlist is deliberately not widened: that function governs URLs built from world data (wiki
page titles, a renderer's `window.open`), and adding `/discord/start` to it would let
renderer-supplied text through the same door. This is `feedback/mail.ts`'s argument exactly - a
compiled prefix, asserted before the OS is asked, so the set of things this door can open has one
member.

### Dark under `EQ_E2E`

`SHARE_ORIGIN` is empty in an `EQ_E2E` build, so `connectStartUrl` is `''`, no browser can be
opened, no claim can be asked for, and the Connect button answers the dark sentence. Proven by
running a dark child process in `tests/discordConnect.test.mts`, the way the post path's darkness
is proven in `tests/discordPost.test.mts`.
