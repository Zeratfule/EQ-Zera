// pageStyle.ts — the share page's stylesheet, as one string the page nonces into a <style>.
//
// Lives apart from page.ts only for the file-length ceiling; the rules are page.ts's and are
// named for the markup there. The palette mirrors website/additional.css (see page.ts's header);
// there is no @font-face because the CSP has no font-src, so every face has a system fallback.
// Geometry that depends on the profile (score bar widths, hotspot boxes) is NOT here: page.ts
// generates those rules per request, because a style= attribute would be blocked by the CSP.

export const STYLE = `
:root{--ground:#0c0a1f;--ground2:#13102c;--panel:#1a1638;--line:#2d2757;--ink:#efeaff;
--ink2:#b8b0d9;--ink3:#7d75a6;--cyan:#5ee6ff;--pink:#ff5fb8;--violet:#a98fe0;--sun:#c7a2ff;
--display:'Chakra Petch','Bahnschrift','Segoe UI',sans-serif;
--body:'Source Sans 3','Segoe UI',system-ui,sans-serif;
--mono:'JetBrains Mono','Cascadia Code',Consolas,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:17px;line-height:1.55}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:880px;margin:0 auto;padding:32px 20px 64px}
h1{font-family:var(--display);font-size:clamp(30px,5vw,44px);font-weight:700;letter-spacing:.02em;margin:0;
background:linear-gradient(180deg,#fff 0%,var(--sun) 60%,var(--pink) 100%);
-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-family:var(--display);font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:var(--pink);margin:0 0 12px}
h3{font-family:var(--display);font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink3);margin:16px 0 8px}
.sub{color:var(--ink2);font-size:19px;margin:8px 0 0}
.meta{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);margin:14px 0 0}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px;margin:22px 0}
.cardwrap{position:relative;margin:22px 0}
.card{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px}
.hots{position:absolute;inset:0}
.hot{position:absolute;border-radius:6px;cursor:pointer;outline:0;transition:box-shadow .12s,background .12s}
.hot:hover,.hot:focus,.hot.pin,.hot.lit{box-shadow:0 0 0 2px var(--cyan),0 0 18px rgba(94,230,255,.45);background:rgba(94,230,255,.1)}
.hot.pin{box-shadow:0 0 0 2px var(--pink),0 0 18px rgba(255,95,184,.45)}
.tip{display:none;position:absolute;left:0;top:calc(100% + 6px);z-index:6;width:min(420px,70vw);padding:10px 12px;
background:var(--panel);border:1px solid var(--line);border-radius:8px;box-shadow:0 14px 36px rgba(0,0,0,.55);font-size:14px;cursor:auto}
.hot:hover .tip,.hot:focus .tip,.hot.pin .tip{display:block}
.hot.flip .tip{left:auto;right:0}
.tipname{margin:0 0 6px;font-size:15px;display:flex;align-items:center;flex-wrap:wrap}
.tip .facts{margin:0;padding:0;border:0;background:transparent}
.slots>li.lit{background:rgba(94,230,255,.12)}
.muted{color:var(--ink3);font-size:15px;margin:8px 0 0}
.ac{margin:0;font-size:22px}.ac strong{font-family:var(--mono);color:var(--cyan)}
ul{list-style:none;margin:0;padding:0}
.bars li{display:grid;grid-template-columns:70px 1fr 52px;align-items:center;gap:12px;margin:0 0 10px}
.track{height:9px;border-radius:5px;background:var(--ground2);border:1px solid var(--line);overflow:hidden}
.fill{display:block;height:100%;background:linear-gradient(90deg,var(--cyan),var(--pink))}
.bars .v{font-family:var(--mono);text-align:right;color:var(--cyan)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips li{display:flex;gap:8px;background:var(--ground2);border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-size:14px}
.chips .k{color:var(--ink3)}.chips .v{font-family:var(--mono);color:var(--ink)}
.who{margin:0 0 4px;font-size:19px;color:var(--ink2)}
.chips.core .v{color:var(--cyan)}
.slots>li{display:grid;grid-template-columns:120px 1fr;gap:4px 10px;padding:8px 0;border-top:1px solid var(--line)}
.slots>li:first-child{border-top:0}
.slots>li{margin:0 -10px;padding-left:10px;padding-right:10px;border-radius:6px;transition:background .12s}
.slots>li:hover{background:rgba(94,230,255,.06)}
.slots>li:hover .slot{color:var(--ink2)}
.slots>li:hover .rank{filter:brightness(1.15)}
.slot{color:var(--ink3);font-size:14px;font-family:var(--mono);padding-top:2px}
.item{color:var(--ink)}
.rank{display:inline-block;margin-left:8px;padding:0 7px;border-radius:999px;font-family:var(--mono);font-size:12px;line-height:20px;
color:#0c0a1f;background:linear-gradient(135deg,var(--cyan),var(--sun));vertical-align:1px;white-space:nowrap}
.ex,.orn{grid-column:2;color:var(--violet);font-size:14px}
.brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 26px;padding:0 0 16px;border-bottom:1px solid var(--line)}
.brand .home{display:flex;align-items:center;gap:10px;font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:.04em;color:var(--ink)}
.brand .home img{width:32px;height:32px;display:block}
.brand .get{font-family:var(--display);font-weight:700;font-size:14px;letter-spacing:.03em;padding:8px 16px;border-radius:6px;
color:#0c0a1f;background:linear-gradient(135deg,var(--cyan),#8ab4ff 55%,var(--pink));white-space:nowrap}
.brand a:hover{text-decoration:none;filter:brightness(1.08)}
.how{margin:14px 0 0}.how summary{cursor:pointer;color:var(--ink3);font-size:14px}
.how p{color:var(--ink2);font-size:15px;margin:8px 0 0}.how b{color:var(--ink)}
.gear{grid-column:2;position:relative}
.gear.float .facts{position:absolute;left:0;top:calc(100% + 6px);width:min(560px,calc(100vw - 48px));z-index:5;margin:0;
background:var(--panel);box-shadow:0 14px 36px rgba(0,0,0,.55)}
.gear.float .facts .chips li{background:var(--ground2)}
.gear summary{cursor:pointer;list-style:none;display:flex;align-items:center;flex-wrap:wrap;gap:0 4px}
.gear summary::-webkit-details-marker{display:none}
.gear summary::after{content:'\\25B8';color:var(--ink3);font-size:13px;margin-left:8px;transition:transform .15s}
.gear[open] summary::after{transform:rotate(90deg)}
.gear summary:hover .item{color:var(--cyan)}
.facts{margin:8px 0 4px;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--ground2)}
.facts .chips{margin:0 0 8px}.facts .chips:last-child{margin-bottom:0}
.facts .chips li{background:var(--panel)}
.flags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.flags li{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--violet);
border:1px solid var(--line);border-radius:4px;padding:2px 6px}
.effects li{font-size:14px;padding:2px 0}
.effects .k{display:inline-block;min-width:56px;color:var(--ink3);font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase}
.muted-inline{color:var(--ink3)}
.facts .muted{margin:0}
.eqc{width:100%;font-family:var(--mono);font-size:12px;color:var(--sun);background:var(--ground2);
border:1px solid var(--line);border-radius:6px;padding:10px;resize:vertical;word-break:break-all}
.row{display:flex;align-items:center;gap:12px;margin:12px 0 0}
.btn{font-family:var(--display);font-weight:700;font-size:16px;letter-spacing:.03em;padding:12px 22px;
border:0;border-radius:6px;cursor:pointer;color:#0c0a1f;background:linear-gradient(135deg,var(--cyan),#8ab4ff 55%,var(--pink))}
.copied{color:var(--cyan);font-size:14px}
footer{color:var(--ink3);font-size:15px;margin:34px 0 0;border-top:1px solid var(--line);padding-top:20px}
`
