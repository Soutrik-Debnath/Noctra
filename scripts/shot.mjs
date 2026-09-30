/**
 * Screenshot a Noctra webview, optionally with a CSS pseudo-state forced.
 *
 * The mini card's whole design is a hover transition, and the pointer is never actually inside the
 * window when a probe runs — so without forcing :hover this tool could only ever photograph the rest
 * state, which is how "it looks fixed in the capture but is broken on the desktop" kept happening.
 * CSS.forcePseudoState makes the browser render the hover state as if the cursor were there.
 *
 * The clip is not optional: Page.captureScreenshot without an explicit clip returns a surface larger
 * than what was painted, and the unpainted remainder comes back pure black.
 *
 * Usage: node scripts/shot.mjs <main|mini> <out.png> [force-hover-selector]
 */
const PORT = process.env.NUCTRA_CDP_PORT || "9223";
const [, , which, out, hoverSel] = process.argv;

async function findTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter((k) => k.type === "page" && k.webSocketDebuggerUrl);
  // `1420` only exists in dev; an installed build serves from `tauri.localhost`. Excluding the card
  // by name is what actually identifies the main window, and it works in both.
  const main = pages.filter((k) => !k.url.includes("mini"));
  const t =
    which === "mini"
      ? pages.find((k) => k.url.includes("mini"))
      : main.find((k) => k.url.includes("1420")) || main[0];
  if (!t) throw new Error(`no ${which} target. seen: ${pages.map((k) => k.url).join(", ")}`);
  return t;
}

const ws = await (async () => {
  const w = new WebSocket((await findTarget()).webSocketDebuggerUrl);
  await new Promise((res, rej) => { w.onopen = res; w.onerror = rej; });
  return w;
})();

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result?.value;
};

await send("Runtime.enable");
await send("DOM.enable");
await send("CSS.enable");
await send("Page.enable");

if (hoverSel) {
  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: hoverSel });
  if (!q.nodeId) throw new Error(`selector not found: ${hoverSel}`);
  await send("CSS.forcePseudoState", { nodeId: q.nodeId, forcedPseudoClasses: ["hover"] });
  // Long enough for the slowest transition in the card. The heart blooms over ~1.5s, so a short wait
  // photographs a half-faded cover and it looks like the hover rule never fired.
  await ev("new Promise(r => setTimeout(r, 1800))");
  const probe = await ev(
    `(() => { const o = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).opacity : 'MISSING'; };
       return JSON.stringify({ cover: o('.cover'), heart: o('.cover-heart'), trans: o('.cover-trans') }); })()`,
  );
  console.log(`forced :hover on ${hoverSel} -> ${probe}`);
}

const geo = await ev(`JSON.stringify({w: innerWidth, h: innerHeight, dpr: devicePixelRatio})`);
const { w, h, dpr } = JSON.parse(geo);
const shot = await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 0, y: 0, width: w, height: h, scale: dpr },
  captureBeyondViewport: false,
});
const fs = await import("node:fs");
fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log(`${out}  ${Math.round(w * dpr)}x${Math.round(h * dpr)} (dpr ${dpr})`);
ws.close();
