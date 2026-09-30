// Drives the live app to the fullscreen lyrics view and checks the heart there: geometry against the
// traced reference, and the clipped hit area against the NEW ink. Navigation is explicit because the
// app has no router and the view state is not owned by this script.
const PORT = process.env.NOCTRA_CDP_PORT || "9223";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.type === "page" && k.url.includes("1420") && !k.url.includes("mini"));
if (!t) throw new Error("no main target");

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; pending.set(n, { resolve: res }); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (re) =>
  ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>new RegExp(${JSON.stringify(re)},"i").test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(!b)return 'MISS';b.click();return 'ok';})()`);

// Other agent sessions drive this same webview, so navigation is retried until the view holds still.
let out = { err: "never reached .bigheart" };
for (let attempt = 1; attempt <= 6; attempt++) {
  await click("close lyrics");
  await click("fullscreen player");
  await wait(1200);
  out = await ev(`(async () => {
  const big = document.querySelector('.bigheart');
  if (!big) return { err: 'no .bigheart', labels: [...document.querySelectorAll('button[aria-label],button[title]')].map(b=>b.getAttribute('aria-label')||b.title).slice(0,25) };
  const svg = big.querySelector('svg');
  const p = svg.querySelector('path');
  const d = p.getAttribute('d') || '';
  const ink = p.getBoundingClientRect();
  const hb = big.getBoundingClientRect();
  const hit = document.querySelector('.hit');
  const wrap = document.querySelector('.art-zone .wrap');
  const probe = (fx, fy) => {
    const x = hb.left + hb.width * fx, y = hb.top + hb.height * fy;
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('hit') ? 'HIT' : (el ? String(el.className || el.tagName).split(' ')[0] : 'none');
  };
  const nx = (r) => [+(((r.left - hb.left) / hb.width).toFixed(3)), +(((r.right - hb.left) / hb.width).toFixed(3))];
  const ny = (r) => [+(((r.top - hb.top) / hb.height).toFixed(3)), +(((r.bottom - hb.top) / hb.height).toFixed(3))];
  const clip = document.querySelector('#heart-hit path');
  return {
    pathHead: d.slice(0, 12), pathLen: d.length,
    inkPx: Math.round(ink.width) + 'x' + Math.round(ink.height),
    inkAspect: Math.round((ink.width / ink.height) * 100) / 100,
    inkNormX: nx(ink), inkNormY: ny(ink),
    wrapRect: wrap ? (() => { const r = wrap.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })() : null,
    wrapZ: wrap ? getComputedStyle(wrap).zIndex : null,
    hitZ: hit ? getComputedStyle(hit).zIndex : null,
    clipDLen: clip ? clip.getAttribute('d').length : null,
    clipMatchesGlyph: clip ? clip.getAttribute('d') === d : null,
    hitNormX: hit ? nx(hit.getBoundingClientRect()) : null,
    hitNormY: hit ? ny(hit.getBoundingClientRect()) : null,
    samples: {
      body: probe(0.5, 0.55), apex: probe(0.5, 0.79),
      leftLobe: probe(0.32, 0.31), rightLobe: probe(0.68, 0.31),
      inNotch: probe(0.5, 0.26), belowNotch: probe(0.5, 0.40),
      topLeftCorner: probe(0.05, 0.05), bottomRightCorner: probe(0.95, 0.95),
      besideApex: probe(0.13, 0.85),
    },
  };
})()`);
  if (!String(out.err || "").includes(".bigheart")) break;
  await wait(900);
}
console.log(JSON.stringify(out, null, 2));
ws.close();
