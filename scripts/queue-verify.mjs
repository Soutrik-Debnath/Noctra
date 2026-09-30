// Verifies the queue drawer after the clearance fix: its content must fill the pane, and the transport
// bar's right end must belong to the bar again rather than to the drawer.
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const fs = await import("node:fs");
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const p = list.find((k) => k.type === "page" && k.url === "http://localhost:1420/");
const ws = new WebSocket(p.webSocketDebuggerUrl);
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

for (let i = 0; i < 4; i++) {
  if (await ev(`!!document.querySelector('.panel')`)) break;
  await ev(`(() => { const b = document.querySelector('footer.bar button[aria-label="Queue"]'); if (b) b.click(); return !!b; })()`);
  await wait(700);
}

console.log(await ev(`(() => {
  const L = String.fromCharCode(10);
  const pn = document.querySelector('.panel'), bar = document.querySelector('footer.bar');
  if (!pn) return 'panel not mounted';
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
  const pr = R(pn), br = R(bar);
  const head = pn.querySelector('header'), body = pn.querySelector('.body');
  const who = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).split(' ')[0] : 'none'; };
  return 'panel      : ' + pr.w + 'x' + pr.h + ' at ' + pr.x + ',' + pr.y + '  padL=' + getComputedStyle(pn).paddingLeft + ' padB=' + getComputedStyle(pn).paddingBottom + L
    + 'header      : ' + R(head).w + 'px wide' + L
    + 'body        : ' + R(body).w + 'px wide' + L
    + 'view (.page): ' + R(document.querySelector('.page')).w + 'px wide, padL=' + getComputedStyle(document.querySelector('.page')).paddingLeft + L
    + 'bar         : ' + br.w + 'x' + br.h + ' ending at x=' + br.right + L + L
    + 'hit test, bar right end  : ' + who(br.right - 25, br.y + br.h / 2) + L
    + 'hit test, bar volume pill: ' + who(br.right - 120, br.y + br.h / 2) + L
    + 'hit test, drawer centre  : ' + who(pr.x + pr.w / 2, pr.y + pr.h / 2);
})()`));

const clip = await ev(`(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return { x: r.x - 6, y: 0, width: r.width + 12, height: innerHeight }; })()`);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1.4 } });
fs.writeFileSync("D:/Noctra Project/scripts/queue-fixed.png", Buffer.from(shot.result.data, "base64"));
console.log(String.fromCharCode(10) + "wrote scripts/queue-fixed.png");
ws.close();
