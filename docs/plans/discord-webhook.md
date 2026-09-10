# Posting a character card to Discord

**Owner's ask, 2026-09-10, verbatim:** *"we should also develope a way to export your character
profile directly to a chat in Discord. that would be cool."*

**Shipped in 1.23.0.** The whole feature is one CHANNEL WEBHOOK the user pastes in, and one POST.

---

## 1. The ruling, and what it rules out

The agreed design is a Discord **channel webhook** — a URL Discord mints for one channel, which
anyone holding it can post to. The user makes it once:

> Discord → the channel → Edit channel → Integrations → Webhooks → New Webhook → Copy Webhook URL
> → paste into EQ Zera → Preferences → Sharing → Save.

**Deliberately NOT built, and not to be built without a new ruling:**

* **No bot.** A bot is an application registration, a token that is ours rather than theirs, a
  gateway connection, an uptime obligation and a permissions dialog in every server that adds it.
  Nothing about "put my gear in my guild's chat" needs one.
* **No OAuth.** Nothing here should be able to act as the user on Discord. A webhook can post to
  one channel and do nothing else, which is exactly the whole of the ask.
* **No slash commands.** They require a bot, a public interactions endpoint (a server of ours,
  reachable, forever) and a signature-verification path. The share page already exists; a chat
  command that fetched it would be a second product.
* **No server of ours in the path.** The app POSTs straight to Discord from the main process. The
  only service involved is `share.eqzera.com`, which was already involved because the message is
  a share LINK.

## 2. The new outbound origin (owner ruling, 2026-09-10)

This is the app's **second** deliberate outbound origin, after `share.eqzera.com`. It is written to
`src/main/share/net.ts`'s law, and the file that carries it is `src/main/share/discord.ts`:

| clause | what it means here |
| --- | --- |
| hosts | `discord.com` and `discordapp.com` (the legacy spelling Discord still hands out), EXACT hostname compares, never `endsWith` |
| path | `/api/webhooks/<id>/<token>` and nothing else |
| method | POST only. Nothing reads, lists, edits or deletes anything at Discord |
| process | MAIN only. The renderer performs no fetch; `connect-src 'self'` is untouched and this feature widens **no** CSP |
| timeout | `AbortSignal.timeout(15_000)`, the share POST's budget for the same reason: one JSON round trip |
| agent | `eq-zera/0.1 (discord)` — the family every other outbound request in this app uses |
| override | **none, ever.** There is no dev-loopback carve-out either: net.ts has one so a developer can run the SHARE SERVICE locally, and nobody runs Discord locally |
| `EQ_E2E` | **DARK.** `discordEndpointConfigured()` is false and every post answers the dark sentence, so a headless run can never put a message in somebody's channel |
| logging | **the URL is never logged.** Not to `errors.log`, not to a breadcrumb, not truncated. Anyone holding it can post to that channel forever |

The `EQ_E2E` clause is sharper here than it is for share links: `share.eqzera.com` merely *might*
be live, while a webhook a developer pasted while testing is *definitely* live and points at a
real channel with real people in it.

## 3. The contract

### The URL, as this app will accept one

`src/shared/discordWebhook.ts` — pure, and the READ FILTER for a string a user pasted out of
another program.

* Accepted: `https://discord.com/api/webhooks/<id>/<token>` and the same on `discordapp.com`,
  with or without a trailing slash, with or without a query or fragment (dropped, never carried
  into a request).
* `id`: 17 to 20 decimal digits. `token`: 60 to 100 characters of `[A-Za-z0-9_-]`. **Closed
  classes**, because both values are concatenated into a request path.
* Refused: `http`, any other host (`discord.com.evil.com` fails), any other path, a deeper path,
  credentials in the URL, a non-default port, a bare token.
* **Stored split**, as `{ id, token }` — so the stored record cannot carry a host, a port, a query
  or a second path segment back out of the store and into a `fetch`. The request URL is REBUILT
  from the two values and always names `discord.com`.

### What is sent

One POST, `Content-Type: application/json`:

```jsonc
{
  "username": "EQ Zera",
  "avatar_url": "https://share.eqzera.com/logo.png",
  "content": "",
  "embeds": [{
    "title":       "<name> · Level N · CLS / CLS",   // missing parts omitted
    "url":         "https://share.eqzera.com/s/<id>",
    "description": "<the scores line>\n<the With gear: line>",
    "color":       6219519,                          // 0x5ee6ff
    "image":       { "url": "https://share.eqzera.com/c/<id>.png?v=<ms>" },
    "fields":      [ { "name": "Tank", "value": "71%", "inline": true }, … ],
    "footer":      { "text": "EQ Zera · eqzera.com" },
    "timestamp":   "<ISO of profile.capturedAt>"
  }]
}
```

* **The embed is the LINK, wrapped.** The share page already unfurls on Discord with the card and
  the score line; the embed gives it a title, two lines, four tiles and the picture so the message
  reads as something rather than as a bare URL. `content` is empty because a line above the embed
  would be the same facts twice.
* **The description comes out of `characterShareText`'s own output** (`shared/characterShare.ts`),
  not from a second spelling of those numbers. The plain-text summary, the share page and this
  embed must say the same words, and the copy that nobody was looking at is the copy that drifts.
* **The score tiles are all four or none**, which is the profile's own law: a reading the Build tab
  could not compute is omitted, not zero.
* **`?v=<Date.now()>` on the card image** defeats a cache. It is safe because the service matches
  the PATHNAME only (`share-server` `CARD_ROUTE`), and it is necessary because the bytes under
  `/c/<id>.png` genuinely change when a character re-shares.
* Every string is cut to Discord's ceiling: title 256, description 4096, field value 1024.

### The error sentences

Short, plain, about the reader's situation; none names a status code, a host, a verb or the URL.

| situation | sentence |
| --- | --- |
| `EQ_E2E`, no endpoint | This build cannot post to Discord. |
| nothing stored | Add a Discord webhook in Preferences, Sharing. |
| 401 / 403 / 404 | That webhook no longer exists or the URL is wrong. Check Preferences, Sharing. |
| 429 | Discord is rate limiting this webhook. Try again in a moment. |
| 400 and anything else | Discord refused the message. |
| transport, DNS, TLS, timeout | Could not reach Discord. |
| a paste that is not a webhook | That is not a Discord webhook URL. In Discord: channel settings, Integrations, Webhooks, New Webhook, Copy Webhook URL. |

200 and 204 are both success — Discord answers 204 to a plain webhook post and 200 when asked to
wait for the message.

## 4. Where the pieces live

| file | what it owns |
| --- | --- |
| `src/shared/discordWebhook.ts` | the URL grammar, the mask, the embed. Pure |
| `src/main/share/discord.ts` | the outbound origin, the transport, the sentences |
| `src/main/storeDiscord.ts` | the stored `{id, token}` and the masked VIEW |
| `src/main/ipc/discord.ts` | the four settings doors and the one post |
| `src/preload/discordApi.ts` | five methods on `window.eq` |
| `src/renderer/.../preferences/SharingSetting.tsx` | Preferences → Sharing |
| `src/renderer/.../character/share/useDiscordPost.ts` | the button's round trip |

## 5. The secret

The token never crosses IPC. It arrives once as text on `discord:setWebhook`, is parsed and stored
main-side, and every reply on every channel is a `DiscordWebhookView` (`{set, masked?}`), a boolean
or a sentence. The Preferences card therefore has an **always-empty** text box: what is stored is
stated in words (`…/webhooks/<id>/••••<last 4>`) beside Test and Remove, and the box is for pasting
a new one. A box that re-showed the value would need the value.

It is also not part of a shared settings profile (`src/main/share.ts`): a bundle carrying one would
hand a stranger the ability to post in somebody's channel.

## 6. The post reuses Copy link; it does not reimplement it

`discord:postProfile` takes the same arguments `character:shareLink` takes and calls the same
main-side function, `publishCharacterLink` (`src/main/ipc/characterShare.ts`) — measure,
photograph, PUT-or-POST, record. Two publish paths would be two opinions about which record a
character re-uses and which card bytes travel, and the one nobody was looking at would drift. So
posting to Discord **is** sharing a link, plus a message about it.

## 7. Tests

* `tests/discordWebhook.test.mts` — the grammar (the two hosts and only them), the mask, the embed
  shape, the limits, and that the description is exactly `characterShareText`'s two lines.
* `tests/discordPost.test.mts` — a fake `fetch`: 204, 404, 429, a thrown transport, the timeout
  signal, the JSON body, the exact request URL, and the dark build.
* `tests/e2e/discord-share.e2e.mts` — Preferences → Sharing refusing junk and accepting a
  well-formed URL, and the share dialog's button going from disabled to enabled and then reporting
  the dark sentence under `EQ_E2E`.

**No test ever posts to a real webhook**, and under `EQ_E2E` none structurally can.
