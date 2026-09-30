// Samples the mini card's cover-art size across a real hover, with hard timeouts on every CDP call
// so a non-responding command reports itself instead of hanging the script.
//   node scripts/demo-mini-grow.mjs
import fs from "node:fs";

const PORT = process.env.NOCTRA_CDP_PORT ?? "9223";
const CALL_MS = 8000;

async function attach(match) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter((t) => t.type === "page" && t.url.includes("1420") && t.webSocketDebuggerUrl);
  const target = match === "mini" ? pages.find((t) => t.url.includes("mini")) : pages.find((t) => !t.url.includes("mini"));
  if (!target) throw new Error(`no ${match} window on the debug port`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
    setTimeout(() => rej(new Error("websocket open timed out")), 6000);
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id).resolve(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        rej(new Error(`${method} timed out after ${CALL_MS}ms`));
      }, CALL_MS);
      pending.set(n, {
        resolve: (m) => {
          clearTimeout(timer);
          res(m);
        },
      });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
    return r.result?.result?.value;
  };
  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  const shot = async (path) => {
    await send("Page.enable").catch(() => {});
    const r = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path, Buffer.from(r.result.data, "base64"));
  };
  return { send, evaluate, move, shot, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GEOM = `(()=>{
  const a=document.querySelector('.cover-art'), c=document.querySelector('.cover');
  if(!a||!c) return {err:'no cover-art/.cover'};
  const r=a.getBoundingClientRect(), cr=c.getBoundingClientRect();
  const cs=getComputedStyle(a);
  return {art:Math.round(r.width*10)/10, cx:Math.round(cr.x+cr.width/2), cy:Math.round(cr.y+cr.height/2),
          transform:cs.transform, dur:cs.transitionDuration, vis:document.visibilityState};
})()`;

async function main() {
  const mini = await attach("mini");
  const probe = await mini.evaluate(GEOM);
  if (probe.err) throw new Error(probe.err);
  console.log(`card visible=${probe.vis}  cover-art=${probe.art}px  transition=${probe.dur}`);

  // Park the pointer off the card so :hover is definitely not already latched.
  await mini.move(2, 2);
  await sleep(500);
  const rest = await mini.evaluate(GEOM);
  console.log(`at rest:      width=${rest.art}px  ${rest.transform}`);
  await mini.shot("scripts/mini-grow-rest.png").catch((e) => console.log("  (rest screenshot failed:", e.message + ")"));

  const t0 = Date.now();
  await mini.move(rest.cx, rest.cy);
  for (const mark of [150, 400, 800, 1200, 1700]) {
    const wait = mark - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const s = await mini.evaluate(GEOM);
    const over = await mini.evaluate(`(document.elementFromPoint(${rest.cx},${rest.cy})||{}).className||'MISS'`);
    console.log(`  +${String(Date.now() - t0).padStart(4)}ms  width=${String(s.art).padStart(6)}px  ${s.transform}   pointer over: ${String(over).slice(0, 26)}`);
  }
  await mini.shot("scripts/mini-grow-hovered.png").catch((e) => console.log("  (hover screenshot failed:", e.message + ")"));

  const end = await mini.evaluate(GEOM);
  const pct = Math.round(((end.art - rest.art) / rest.art) * 100);
  console.log(`\ncover art grew ${rest.art}px -> ${end.art}px  (${pct > 0 ? "+" : ""}${pct}%)`);
  console.log("screenshots: scripts/mini-grow-rest.png, scripts/mini-grow-hovered.png");
  mini.close();
}

main().catch((e) => {
  console.error("demo failed:", e.message ?? e);
  process.exit(1);
});
