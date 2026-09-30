// Drives the real mini window with genuine pointer events and checks the five reported issues:
// grow trigger, content overlap, rail behaviour, active-line centring, and the title marquee.
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const fs = await import("node:fs");
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.url.includes("mini.html"));
if (!t) throw new Error("mini window is not open");

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).resolve(m); pend.delete(m.id); } };
const send = (m, pr = {}) => new Promise((r) => { const n = ++id; pend.set(n, { resolve: r }); ws.send(JSON.stringify({ id: n, method: m, params: pr })); });
const ev = async (x) => {
  const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "EXC " + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const move = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await wait(900);
};
const box = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height }; })()`);
const coverScale = () => ev(`(() => { const c = document.querySelector('.cover'); return c ? getComputedStyle(c).transform : 'no cover'; })()`);
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("D:/Noctra Project/scripts/" + name, Buffer.from(s.result.data, "base64"));
  console.log("  -> scripts/" + name);
};

console.log("state:", await ev(`JSON.stringify({ style: document.querySelector('.card') ? 'card' : 'pill', hasTrack: !!document.querySelector('.cover'), title: (document.querySelector('.title')||{}).textContent })`));

// Park the pointer outside everything first.
await move(2, 2);
console.log("\n1. GROW TRIGGER");
console.log("  rest           :", await coverScale());
const lz = await box(".lyrics");
if (lz) { await move(lz.cx, lz.cy); console.log("  hover LYRICS   :", await coverScale(), "(must stay small)"); }
const hz = await box(".head .title");
if (hz) { await move(hz.cx, hz.cy); console.log("  hover TITLE    :", await coverScale(), "(must stay small)"); }
const az = await box(".art");
if (az) { await move(az.cx, az.cy); console.log("  hover THUMBNAIL:", await coverScale(), "(must be scale 1)"); }

console.log("\n2. OVERLAP");
if (az) {
  console.log("  head/lyrics opacity while open:",
    await ev(`JSON.stringify({ head: getComputedStyle(document.querySelector('.head')).opacity, lyrics: getComputedStyle(document.querySelector('.lyrics')).opacity })`));
  await shot("mini-open.png");
}

console.log("\n3. ACTIVE LINE CENTRING");
console.log("  " + await ev(`(() => {
  const v = document.querySelector('.lyrics'), a = document.querySelector('.line.active');
  if (!v) return 'no lyrics';
  if (!a) return 'no active line (track may have no lyrics)';
  const vr = v.getBoundingClientRect(), ar = a.getBoundingClientRect();
  return 'viewport mid=' + Math.round(vr.y + vr.height / 2)
    + ' line mid=' + Math.round(ar.y + ar.height / 2)
    + ' off by ' + Math.round((ar.y + ar.height / 2) - (vr.y + vr.height / 2)) + 'px'
    + ' | reel pad=' + getComputedStyle(document.querySelector('.reel')).paddingBlockStart;
})()`));

console.log("\n4. TITLE MARQUEE");
console.log("  " + await ev(`(() => {
  const el = document.querySelector('.title');
  if (!el) return 'no title';
  return 'scrollWidth=' + Math.round(el.scrollWidth) + ' clientWidth=' + Math.round(el.clientWidth)
    + ' overflowing=' + (el.scrollWidth > el.clientWidth)
    + ' scrollingClass=' + el.classList.contains('scrolling')
    + ' --over=' + getComputedStyle(el).getPropertyValue('--over')
    + ' textOverflow=' + getComputedStyle(el).textOverflow;
})()`));

console.log("\n5. SEEK RAIL");
// This section drags the real bar, so record where playback was and put it back at the end.
const startPos = await ev(`(() => { const t = document.querySelectorAll('.cover-prog .t')[1]; const e = document.querySelectorAll('.cover-prog .t')[0]; return { elapsed: e ? e.textContent : '?', total: t ? t.textContent : '?' }; })()`);
const toSecs = (s) => { const p = String(s || "0:00").split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2]; };
const startFrac = await ev(`(() => { const r = document.querySelector('.cover-prog .rail'); return r ? Number(r.getAttribute('aria-valuenow')) : 0; })()`);
console.log("  position before the drag test:", JSON.stringify(startPos), "(" + startFrac + "s)");
const rz = await box(".cover-prog .rail");
if (!rz) { console.log("  no rail (cover closed?)"); }
else {
  await move(rz.x + rz.w * 0.6, rz.cy);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rz.x + rz.w * 0.6, y: rz.cy, button: "left", clickCount: 1 });
  await wait(400);
  console.log("  at 60% press:", await ev(`(() => {
    const rail = document.querySelector('.cover-prog .rail');
    const fill = rail.querySelector('.fill');
    const times = [...document.querySelectorAll('.cover-prog .t')].map(t => t.textContent);
    return 'scaleX=' + (getComputedStyle(fill).transform.match(/matrix\\(([-\\d.]+)/)||[,'?'])[1]
      + ' elapsed=' + times[0] + ' total=' + times[1]
      + ' ariaNow=' + rail.getAttribute('aria-valuenow')
      + ' headOpacity=' + getComputedStyle(rail.querySelector('.head')).opacity;
  })()`));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rz.x + rz.w * 0.25, y: rz.cy, button: "left" });
  await wait(300);
  console.log("  dragged to 25%:", await ev(`(() => {
    const rail = document.querySelector('.cover-prog .rail');
    return 'scaleX=' + (getComputedStyle(rail.querySelector('.fill')).transform.match(/matrix\\(([-\\d.]+)/)||[,'?'])[1]
      + ' elapsed=' + document.querySelector('.cover-prog .t').textContent;
  })()`));
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rz.x + rz.w * 0.25, y: rz.cy, button: "left", clickCount: 1 });
  await wait(700);
  console.log("  after release:", await ev(`(() => {
    const rail = document.querySelector('.cover-prog .rail');
    return 'scaleX=' + (getComputedStyle(rail.querySelector('.fill')).transform.match(/matrix\\(([-\\d.]+)/)||[,'?'])[1]
      + ' elapsed=' + document.querySelector('.cover-prog .t').textContent
      + ' (should be ~25% of ' + document.querySelectorAll('.cover-prog .t')[1].textContent + ')';
  })()`));
  await shot("mini-rail.png");
}

await move(2, 2);
console.log("\nclosed again:", await coverScale());

// Put back the position the drag test moved.
if (startFrac > 0) {
  const total = toSecs(startPos.total);
  if (total > 0) {
    await ev(`(() => { void import("@tauri-apps/api/event").then(m => m.emit("mini-command", "seek:${(startFrac / total).toFixed(4)}")); return 1; })()`);
    await wait(600);
    console.log("restored to", await ev(`document.querySelector('.cover-prog .t')?.textContent`), "of", startPos.total);
  }
}
ws.close();
