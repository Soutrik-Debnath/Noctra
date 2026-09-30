const PORT = "9223";
const fs = await import("node:fs");
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 250));
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 3; i++) {
  await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/close|exit/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||''))&&/fullscreen|lyrics/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(b)b.click();return 1;})()`);
  await wait(1100);
  if (!(await ev(`!!document.querySelector('.stage, .now')`))) break;
}

const set = (label, want) =>
  ev(`(() => {
    const b = document.querySelector('footer.bar button[aria-label=${JSON.stringify(label)}]');
    if (!b) return 'MISS';
    if ((b.getAttribute('aria-pressed') === 'true') !== ${want}) b.click();
    return 1;
  })()`);

const READ = `(() => {
  const rows = [];
  for (const b of document.querySelectorAll('footer.bar button[aria-pressed]')) {
    const cs = getComputedStyle(b);
    rows.push((b.getAttribute('aria-label') || '?').padEnd(14) + ' pressed=' + String(b.getAttribute('aria-pressed')).padEnd(5)
      + ' color=' + cs.color + '  filter=' + (cs.filter === 'none' ? 'none' : (cs.filter.match(/drop-shadow/g) || []).length + ' layers'));
  }
  return rows.join(String.fromCharCode(10));
})()`;

console.log("cover accent:", await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')`));

await set("Shuffle", true); await set("Play similar", true); await set("Queue", true);
await wait(700);
console.log("\n--- everything ON ---");
console.log(await ev(READ));
const box = await ev(`(()=>{const r=document.querySelector('footer.bar').getBoundingClientRect();return {x:r.x+r.width*0.30,y:r.y,width:r.width*0.46,height:r.height};})()`);
let s = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
fs.writeFileSync("D:/Noctra Project/scripts/bar-all-on.png", Buffer.from(s.result.data, "base64"));

await set("Shuffle", false); await set("Play similar", false); await set("Queue", false);
await wait(700);
console.log("\n--- everything OFF ---");
console.log(await ev(READ));
s = await send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
fs.writeFileSync("D:/Noctra Project/scripts/bar-all-off.png", Buffer.from(s.result.data, "base64"));
console.log("\nwrote scripts/bar-all-on.png and scripts/bar-all-off.png");
ws.close();
