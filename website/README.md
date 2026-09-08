# eqzera.com

The EQ Zera website, hosted on WordPress.com (Premium plan, Assembler block theme).
Site `jackthom88-nhsqp.wordpress.com`, WordPress.com site id 257242643, domain eqzera.com.

## Files

| File | Purpose |
|---|---|
| `home-body.html` | The home page markup. Source of truth for the copy. Every `*-body.html` is one page. |
| `additional.css` | The stylesheet as authored (CSS custom properties). Used by the preview. |
| `fonts.css` | The latin `@font-face` blocks from Google Fonts, pasted into the generated CSS. |
| `build.mjs` | `node build.mjs` writes `wordpress.css`, `*-blocks.html`, `preview.html` and `payload.json`. |
| `wordpress.css` | Generated. Literal colours and `@font-face` blocks, because WordPress.com's CSS sanitizer strips custom properties, `@import` and `backdrop-filter`. This is what lives in the site's Additional CSS. |
| `*-blocks.html` | Generated. A page wrapped in a Custom HTML block, ready to paste into the page's Code editor. |
| `payload.json` | Generated. `{css, pages}` for the push snippet below. |
| `../site/assets/og.png` | The 1200x630 social card (featured image of the home page). |

## Where it lives in WordPress

- Page **Home** (id 5) on the theme's `template-blank` template, so the page carries its own header and footer.
- **Additional CSS** holds `wordpress.css` (global styles id 2). The theme's own few lines of custom CSS sit above the `/* EQ Zera */` comment; keep them.
- Settings → Reading: static front page = Home. Site title "EQ Zera", tagline "EverQuest Legends DPS meter, overlays and quest tracker" (the tagline is the front page `<title>` suffix and the og:description).
- Jetpack → Traffic: front page meta description, page title structure, site verification tags.
- Site icon: media id 9 (`build/icon.png`).

## Pushing a change

WordPress.com strips `<script>` (so no JSON-LD) and `itemprop` (so no microdata) from page content
on this plan; structured data would need the Business plan and a plugin. Everything else is pushed
with the REST API from a logged-in wp-admin tab, which is faster and safer than pasting into the editor:

1. Edit the source, `node build.mjs`, commit and push (the browser fetches the payload from GitHub).
2. In a wp-admin tab (any page under `/wp-admin/`), run in the console:

```js
// The GitHub contents API is never stale; raw.githubusercontent.com caches for minutes.
const meta = await (await fetch("https://api.github.com/repos/Zeratfule/EQ-Zera/contents/website/payload.json?ref=main")).json();
const {css, pages} = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(meta.content.replace(/
/g, "")), c => c.charCodeAt(0))));
const gs = await wp.apiFetch({path: '/wp/v2/global-styles/2?context=edit'});
gs.styles.css = (gs.styles.css || '').replace(/\/\* EQ Zera[\s\S]*$/, '').trim() + '\n\n' + css;
await wp.apiFetch({path: '/wp/v2/global-styles/2', method: 'POST', data: {styles: gs.styles}});
await wp.apiFetch({path: "/wp/v2/pages/5", method: "POST", data: {content: pages.home}});   // guides = 18, contact = 19
```

## Per release

The Download button never needs editing: it points at
`https://github.com/Zeratfule/EQ-Zera/releases/latest/download/eq-zera-Setup.exe`, and `release.yml`
uploads an asset with exactly that name on every tag. Two things in `home-body.html` do need a hand edit:

1. The version and size in the hero meta line (`v1.19.2`, `134 MB`).
2. The "Recent releases" list. Copy the bullets from `src/shared/releaseNotes.ts`; keep three releases.
