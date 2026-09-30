// Photographs the real fullscreen heart on the real sleeve. Navigation is retried because other agent
// sessions drive this same webview.
//   node scripts/heart-shot-live.mjs <out.png>
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const [, , out = "scripts/heart-live-shape.png"] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.type === "page" && k.url.includes("1420") && !k.url.includes("mini"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
let events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
  else events.push(m.method);
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

let state = null;
for (let i = 0; i < 6; i++) {
  await click("close lyrics");
  await click("fullscreen player");
  await wait(1300);
  state = await ev(`(() => {
    const big = document.querySelector('.bigheart');
    if (!big) return { err: 'no .bigheart' };
    const svg = big.querySelector('svg');
    const cs = getComputedStyle(svg);
    const r = big.getBoundingClientRect();
    return { fill: cs.fill, stroke: cs.stroke, strokeWidth: cs.strokeWidth,
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  })()`);
  if (!state.err) break;
  await wait(700);
}
console.log(JSON.stringify(state));
if (state.rect) {
  // The reveal heart is hover-gated, and the pointer is never inside the window when a probe runs.
  await send("DOM.enable");
  await send("CSS.enable");
  const { result: { root } } = await send("DOM.getDocument", { depth: -1 });
  const { result: { nodeId } } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".art-zone" });
  if (nodeId) await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
  await wait(700);
  const [x, y, w, h] = state.rect;
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x, y, width: w, height: h, scale: 2 },
  });
  const fs = await import("node:fs");
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("wrote", out);
}
ws.close();
