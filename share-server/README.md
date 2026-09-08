# share-server — the EQ Zera share link service

A single Cloudflare Worker + one Workers KV namespace. It stores a `kind:'character'` `EQC1`
envelope under an opaque id and serves it back three ways: as JSON to the app, as an HTML page to a
browser, and as a card PNG to a Discord unfurler. The design, the owner's rulings and the route
table live in **`docs/plans/share-links.md`** — this file is only how to run it.

## Layout

| file | what it is |
| --- | --- |
| `src/index.ts` | the Worker entry. Three lines; all it does is call the handler. |
| `src/handler.ts` | `handleRequest(request, env, now)` — the whole service, as a pure function. |
| `src/store.ts` | the two trust gates (`validateEnvelope` + `sanitizeCharacterShare`), the KV record, the 180-day/30-day clock. |
| `src/page.ts` | the HTML page: server-rendered, everything escaped, Open Graph tags, the copy button. |
| `src/codec.ts` | base64url, deflate-raw over `CompressionStream`, id/token generation, SHA-256. |
| `src/env.ts` | the bindings, declared structurally so no Cloudflare types are needed to build or test. |
| `tsconfig.json` | the worker's own program (share-server/ is in neither root tsconfig — see the header there). |

The tests are in the ROOT suite: `tests/shareServer.test.mts`, run by `npm test` like everything
else. They drive `handleRequest` with an in-memory KV fake and an injected clock, so there is no
workerd emulator in the loop and no separate test command to forget.

## First-time setup

You need a Cloudflare account with the `eqzera.com` zone on Cloudflare DNS (owner ruling 3).

```sh
npx wrangler login
npx wrangler kv namespace create SHARES --config share-server/wrangler.toml
```

The second command prints something like:

```
[[kv_namespaces]]
binding = "SHARES"
id = "0123456789abcdef0123456789abcdef"
```

Paste that `id` into the `[[kv_namespaces]]` block in `share-server/wrangler.toml`, replacing the
empty string. **That is the one value this repo does not carry**: a namespace id is account state,
not source, and committing one would pin the repo to whichever account ran the command first. It is
not a secret — it is safe to commit once the account is the real one.

## Running it

```sh
npm run share:dev      # wrangler dev --config share-server/wrangler.toml
npm run share:deploy   # wrangler deploy --config share-server/wrangler.toml
```

`share:dev` serves on `http://localhost:8787` with a LOCAL KV simulation (miniflare writes it under
`share-server/.wrangler/`, gitignored) and no rate-limiter binding — absent means allowed, so every
route takes the same code path it takes in production. Point the app at it with the loopback-only
dev override the app side documents (`EQ_SHARE_URL`); the compiled-in origin is never
user-configurable.

Smoke test against a dev server:

```sh
curl -s -X POST http://localhost:8787/api/v1/shares \
  -H 'content-type: application/json' \
  -d '{"envelope":{ ... an EQC1 envelope ... }}'
# -> 201 {"id":"…","url":"https://share.eqzera.com/s/…","deleteToken":"…","expiresAt":"…"}
```

Note that `url` in the reply is built from `PUBLIC_ORIGIN`, never from the request's Host header —
so a dev server hands back a production-looking URL on purpose. Open the local page at
`http://localhost:8787/s/<id>`.

## The custom domain

`wrangler.toml` carries:

```toml
routes = [{ pattern = "share.eqzera.com", custom_domain = true }]
```

On the first `npm run share:deploy` after the `eqzera.com` zone is active on Cloudflare, wrangler
creates the DNS record for `share.eqzera.com`, provisions the certificate and binds the hostname to
this worker. Nothing else has to be clicked; the record it creates is a proxied CNAME-shaped entry
owned by the Workers platform, so it does not need (and must not be given) a manual A record.

If the zone is **not** active yet, deploying with that line fails. Comment it out, deploy, and the
worker still serves at `https://eqzera-share.<subdomain>.workers.dev`; put the line back and
re-deploy once the zone is live. The app's compiled-in origin is `https://share.eqzera.com`, so the
custom domain has to exist before share links work from a shipped build.

## Bindings

| binding | what it is | notes |
| --- | --- | --- |
| `SHARES` | KV namespace | holds `share:<id>` (JSON) and `card:<id>` (PNG bytes), both with a 180-day TTL |
| `CREATE_LIMIT` | rate limiter, 20 / 60 s / IP | guards POST, PUT and DELETE |
| `READ_LIMIT` | rate limiter, 300 / 60 s / IP | guards `/p/`, `/c/` and `/s/` |
| `PUBLIC_ORIGIN` | plain var | the origin every URL handed out is built from |

A missing rate-limiter binding is treated as **allowed** so `wrangler dev` and the unit suite run
the deployed code path rather than a second branch nothing exercises. `SHARES` is not optional: a
deploy without a namespace id fails at deploy time, which is the right place for it to fail.

## Operating notes

* **Expiry** is entirely KV TTL — there is no sweeper and nothing to run. A share lives 180 days
  from its last write; a view rewrites (and so extends) only when the record is more than 30 days
  stale, which bounds a share's real life at 180–210 days from its last read.
* **Revocation is real.** `DELETE /api/v1/shares/:id` with the delete token removes both keys, and
  every route then answers 404. The token is stored only as a SHA-256 digest, so a dump of the KV
  namespace lets nobody delete anything.
* **There are no logs and no analytics.** Nothing here records who viewed a share (spec: "Not in
  this phase").
