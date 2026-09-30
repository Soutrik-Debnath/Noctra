/**
 * Capability spike for real refraction: does the WebView2 runtime apply an SVG filter passed to
 * `backdrop-filter: url(#...)`?
 *
 * Phase 6 of docs/plans/noctra-feature-batch.md says step 0 is this question and not a component,
 * because the whole "lensing" layer of Apple's Liquid Glass turns on it. Answering it from a blog
 * post is how features get cancelled on a false premise, so this asks the running app: it injects
 * six 100px swatches, each a different way of expressing the same filter, and photographs them.
 *
 * The filter is a constant-red feColorMatrix rather than a displacement map on purpose. A
 * displacement is subtle and its absence is indistinguishable from "the backdrop here happens to be
 * flat"; a swatch that turns solid red can only mean the filter was applied.
 *
 *   P1 url() alone, on a body child          is the primitive supported at all
 *   P2 blur() + url() together               can it join the filter stack Noctra already ships
 *   P3 inside an ancestor with transform     does a composited ancestor cut off the backdrop
 *   P4 inside an ancestor with filter        does a backdrop root (any filter) cut it off
 *   P5 url() under a mask-image              can refraction be limited to a rim band
 *   P6 no backdrop-filter                    control: what the untouched backdrop looks like
 *
 * Writes scripts/lg-probe.png and prints the rectangles; scripts/lg-probe-sample.ps1 turns them into
 * numbers.
 *
 * Usage: node scripts/lg-probe.mjs
 */
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const OUT = "scripts/lg-probe.png";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === "page" && !t.url.includes("mini") && t.url.includes("1420"));
if (!target) throw new Error("main window not found; is the debug app running?");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result?.value;
};

await send("Page.enable");

const result = await ev(`(async () => {
  const SIZE = 100, GAP = 16;
  const y = Math.round(innerHeight * 0.42);
  const total = 6 * SIZE + 5 * GAP;
  const x0 = Math.max(8, Math.round((innerWidth - total) / 2));

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none';
  svg.innerHTML =
    '<defs><filter id="lgx-red" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">' +
    '<feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter></defs>';
  document.body.appendChild(svg);

  const mk = (label, style, parent) => {
    const host = parent || document.body;
    const d = document.createElement('div');
    d.dataset.lgProbe = label;
    d.style.cssText = 'position:fixed;width:' + SIZE + 'px;height:' + SIZE + 'px;z-index:2147483647;' +
                       'background:transparent;pointer-events:none;outline:1px dashed rgba(255,255,255,.25);' + style;
    host.appendChild(d);
    return d;
  };

  const wrap = (extra) => {
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;left:' + x0 + 'px;top:' + y + 'px;width:' + SIZE + 'px;height:' + SIZE + 'px;' + extra;
    document.body.appendChild(w);
    return w;
  };

  const p1 = mk('P1-url', 'left:' + x0 + 'px;top:' + y + 'px;backdrop-filter:url(#lgx-red);-webkit-backdrop-filter:url(#lgx-red)');
  const p2 = mk('P2-blur-url', 'left:' + (x0 + (SIZE + GAP)) + 'px;top:' + y + 'px;backdrop-filter:blur(24px) url(#lgx-red)');
  const w3 = wrap('left:' + (x0 + 2 * (SIZE + GAP)) + 'px;top:' + y + 'px;transform:translateZ(0)');
  const p3 = mk('P3-ancestor-transform', 'position:absolute;left:0;top:0;backdrop-filter:url(#lgx-red)', w3);
  const w4 = wrap('left:' + (x0 + 3 * (SIZE + GAP)) + 'px;top:' + y + 'px;filter:blur(0.01px)');
  const p4 = mk('P4-ancestor-filter', 'position:absolute;left:0;top:0;backdrop-filter:url(#lgx-red)', w4);
  const p5 = mk('P5-masked', 'left:' + (x0 + 4 * (SIZE + GAP)) + 'px;top:' + y + 'px;backdrop-filter:url(#lgx-red);mask-image:linear-gradient(#000,#0000)');
  const p6 = mk('P6-control', 'left:' + (x0 + 5 * (SIZE + GAP)) + 'px;top:' + y + 'px');

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 250));

  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const computed = (el) => getComputedStyle(el).backdropFilter;

  const report = {
    runtime: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0] || '?',
    supportsUrl: CSS.supports('backdrop-filter', 'url(#lgx-red)'),
    supportsBlurAndUrl: CSS.supports('backdrop-filter', 'blur(24px) url(#lgx-red)'),
    filterInDom: !!document.getElementById('lgx-red'),
    computed: {
      P1: computed(p1), P2: computed(p2), P3: computed(p3),
      P4: computed(p4), P5: computed(p5), P6: computed(p6),
    },
    rects: {
      P1: rect(p1), P2: rect(p2), P3: rect(p3),
      P4: rect(p4), P5: rect(p5), P6: rect(p6),
    },
    strip: { x: x0 - 2, y: y - 2, w: total + 4, h: SIZE + 4 },
    dpr: devicePixelRatio,
  };
  window.__lgProbe = { svg, nodes: [...document.querySelectorAll('[data-lg-probe]'), ...document.querySelectorAll('div[style*="blur(0.01px)"], div[style*="translateZ"]')] };
  return JSON.stringify(report);
})()`);

const r = JSON.parse(result);
console.log(JSON.stringify(r, null, 2));

const shot = await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: r.strip.x, y: r.strip.y, width: r.strip.w, height: r.strip.h, scale: r.dpr },
  captureBeyondViewport: false,
});
const fs = await import("node:fs");
fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));

// Take the swatches back out so the running app is left exactly as it was found.
await ev(`(() => { const p = window.__lgProbe; if (!p) return 'nothing to remove';
  p.svg.remove(); p.nodes.forEach(n => n.remove()); delete window.__lgProbe; return 'removed'; })()`);

console.log(`${OUT} written, probes removed`);
ws.close();
