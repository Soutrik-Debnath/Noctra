// Verifies the auto queue: turning shuffle on must populate "next up" without anything being
// hand-added, and flipping play-similar must change what is listed.
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
const clickBar = (label) =>
  ev(`(() => { const b = document.querySelector('footer.bar button[aria-label=${JSON.stringify(label)}]'); if (!b) return 'MISS'; b.click(); return 1; })()`);

// Leave fullscreen if another session parked it there; the bar unmounts in that view.
for (let i = 0; i < 3; i++) {
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/close|exit/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||''))&&/fullscreen|lyrics/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(b)b.click();return 1;})()`);
  await wait(1000);
  if (!(await ev(`!!document.querySelector('.stage, .now')`))) break;
}

const press = (label, want) =>
  ev(`(() => {
    const b = document.querySelector('footer.bar button[aria-label=${JSON.stringify(label)}]');
    if (!b) return 'MISS';
    if ((b.getAttribute('aria-pressed') === 'true') !== ${want}) b.click();
    return 1;
  })()`);

const READ = `(() => {
  const pn = document.querySelector('.panel');
  if (!pn) return { err: 'panel not mounted' };
  const labels = [...pn.querySelectorAll('.label')].map(l => l.textContent.trim());
  const auto = [...pn.querySelectorAll('.row.auto')];
  return {
    labels,
    handRows: pn.querySelectorAll('.row:not(.auto):not(.current)').length,
    autoRows: auto.length,
    firstAuto: auto.slice(0, 4).map(r => r.querySelector('.t')?.textContent.trim()),
    emptyShown: !!pn.querySelector('.empty'),
  };
})()`;

await press("Shuffle", true);
await press("Play similar", false);
await wait(400);
for (let i = 0; i < 4; i++) {
  if (await ev(`!!document.querySelector('.panel')`)) break;
  await clickBar("Queue");
  await wait(700);
}
const off = await ev(READ);
console.log("shuffle ON, similar OFF:", JSON.stringify(off, null, 1));

await press("Play similar", true);
await wait(900);
const on = await ev(READ);
console.log("shuffle ON, similar ON :", JSON.stringify(on, null, 1));

const clip = await ev(`(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return { x: r.x, y: 0, width: r.width, height: innerHeight }; })()`);
const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1.3 } });
fs.writeFileSync("D:/Noctra Project/scripts/queue-auto.png", Buffer.from(shot.result.data, "base64"));

// Leave the app as found: similar off, queue closed.
await press("Play similar", false);
await ev(`(()=>{const b=document.querySelector('.panel button[aria-label="Close queue"]');if(b)b.click();return 1;})()`);

const same = JSON.stringify(off.firstAuto) === JSON.stringify(on.firstAuto);
console.log(String.fromCharCode(10) + "auto rows: off=" + off.autoRows + " on=" + on.autoRows
  + " | lists differ: " + !same + " | wrote scripts/queue-auto.png");
ws.close();
