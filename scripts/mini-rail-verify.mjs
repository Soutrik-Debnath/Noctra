// Verifies the rebuilt seek rail. The mini window had been switched to the pill style by another
// session, so this saves the settings blob, forces "card" just long enough to test, and restores the
// original value at the end whatever happens in between.
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const fs = await import("node:fs");
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.url.includes("mini.html"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m); pend.delete(m.id); } };
const send = (m, pr = {}) => new Promise((r) => { const n = ++id; pend.set(n, { resolve: r }); ws.send(JSON.stringify({ id: n, method: m, params: pr })); });
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "EXC " + JSON.stringify(r.result.exceptionDetails).slice(0, 140);
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const move = async (x, y) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await wait(700); };

const saved = await ev(`localStorage.getItem("noctra.settings")`);
console.log("settings saved, length", String(saved).length > 4 ? (saved || "").length : saved);

const apply = async (style) => {
  await ev(`(() => {
    const s = JSON.parse(localStorage.getItem("noctra.settings") || "{}");
    s.miniStyle = ${JSON.stringify(style)};
    localStorage.setItem("noctra.settings", JSON.stringify(s));
    return 1;
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await wait(2600);
};

try {
  await apply("card");
  const geom = await ev(`(() => {
    const art = document.querySelector('.art'), rail = document.querySelector('.cover-prog .rail');
    if (!art || !rail) return null;
    const a = art.getBoundingClientRect(), r = rail.getBoundingClientRect();
    return { ax: Math.round(a.x + a.width / 2), ay: Math.round(a.y + a.height / 2), rx: Math.round(r.x), rw: Math.round(r.width), ry: Math.round(r.y + r.height / 2) };
  })()`);
  if (!geom) { console.log("still no card/rail"); }
  else {
    await move(geom.ax, geom.ay);
    await wait(1000);
    console.log("cover open:", await ev(`document.querySelector('.card').classList.contains('cover-open')`));
    const read = `(() => {
      const rail = document.querySelector('.cover-prog .rail');
      if (!rail) return 'rail gone';
      const fill = rail.querySelector('.fill'), head = rail.querySelector('.head');
      const ts = [...document.querySelectorAll('.cover-prog .t')].map(x => x.textContent);
      return 'scaleX=' + ((getComputedStyle(fill).transform.match(/matrix\\(([-\\d.]+)/) || [,'?'])[1])
        + ' elapsed=' + ts[0] + ' total=' + ts[1]
        + ' head=' + getComputedStyle(head).opacity + ' dragging=' + rail.classList.contains('dragging')
        + ' ariaNow=' + rail.getAttribute('aria-valuenow');
    })()`;
    const at = (f) => ({ x: geom.rx + geom.rw * f, y: geom.ry });
    const a60 = at(0.6);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a60.x, y: a60.y, button: "left", clickCount: 1 });
    await wait(400);
    console.log("  press 60%  :", await ev(read));
    const a25 = at(0.25);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a25.x, y: a25.y, button: "left" });
    await wait(400);
    console.log("  drag to 25%:", await ev(read));
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: a25.x, y: a25.y, button: "left", clickCount: 1 });
    await wait(1400);
    console.log("  released   :", await ev(read), " <- expect scaleX ~0.25 and elapsed ~25% of total");
    const shot = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync("D:/Noctra Project/scripts/mini-rail.png", Buffer.from(shot.result.data, "base64"));
    console.log("  wrote scripts/mini-rail.png");
  }
} finally {
  await ev(`(() => { localStorage.setItem("noctra.settings", ${JSON.stringify(saved)}); return 1; })()`);
  await send("Page.reload", { ignoreCache: true });
  await wait(1500);
  console.log("settings restored:", await ev(`(() => { const s = JSON.parse(localStorage.getItem("noctra.settings") || "{}"); return s.miniStyle; })()`));
}
ws.close();
