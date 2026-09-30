// Photographs the bottom bar's right cluster with "play similar" on and off, so the bloom and the new
// glyph are judged on pixels.
//   node scripts/bar-similar-shot.mjs
import fs from "node:fs";

const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.type === "page" && k.url.includes("1420") && !k.url.includes("mini"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, { resolve: r }); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 3; i++) {
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/close|exit/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||''))&&/fullscreen|lyrics/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(b)b.click();return 1;})()`);
  await wait(1100);
  if (!(await ev(`!!document.querySelector('.stage, .now')`))) break;
}

const setMode = (want) => ev(`(() => {
  const b = document.querySelector('footer.bar button[aria-label="Play similar"]');
  if (!b) return 'MISS';
  if ((b.getAttribute('aria-pressed') === 'true') !== ${want}) b.click();
  return b.getAttribute('aria-pressed');
})()`);

const clipOf = async (name) => {
  const box = await ev(`(() => {
    const b = document.querySelector('footer.bar button[aria-label="Play similar"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x - 150, y: r.y - 12, width: 400, height: r.height + 24 };
  })()`);
  if (!box) return console.log("no button");
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 3 } });
  fs.writeFileSync(name, Buffer.from(shot.result.data, "base64"));
  console.log("wrote", name);
};

console.log("off:", await setMode(false));
await wait(400);
await clipOf("scripts/bar-similar-off.png");
console.log("on:", await setMode(true));
await wait(700);
await clipOf("scripts/bar-similar-on.png");

// The whole bar, so shuffle and repeat are in frame with the new state and the old dot's absence.
const full = await ev(`(() => {
  const r = document.querySelector('footer.bar').getBoundingClientRect();
  return { x: r.x + r.width * 0.28, y: r.y, width: r.width * 0.5, height: r.height };
})()`);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...full, scale: 2 } });
fs.writeFileSync("scripts/bar-whole.png", Buffer.from(shot.result.data, "base64"));
console.log("wrote scripts/bar-whole.png");
ws.close();
