// Measures the lyrics view's balance: where the sleeve sits, where the lyric column actually is, and
// how much dead space is left over. Screenshots the window so the numbers can be checked against the
// pixels. Navigation is retried because other agent sessions drive this same webview.
//   node scripts/lyrics-layout.mjs [out.png]
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const [, , out = "scripts/lyrics-layout.png"] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.type === "page" && k.url.includes("1420") && !k.url.includes("mini"));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
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

const MEASURE = `(() => {
  const lyr = document.querySelector('.lyrics');
  if (!lyr) return { err: 'no .lyrics', btns: [...document.querySelectorAll('button[aria-label],button[title]')].map(b=>b.getAttribute('aria-label')||b.title).filter(x=>!/Jump/.test(x)) };
  const lb = lyr.getBoundingClientRect();
  const art = document.querySelector('.art-zone');
  const ab = art ? art.getBoundingClientRect() : null;
  const active = document.querySelector('.line.active');
  const ib = active ? active.getBoundingClientRect() : null;
  const lines = [...document.querySelectorAll('.line')].slice(0, 12).map(l => {
    const r = l.getBoundingClientRect();
    return { x: Math.round(r.left), w: Math.round(r.width), t: l.textContent.trim().slice(0, 26) };
  });
  return {
    win: innerWidth + 'x' + innerHeight,
    art: ab ? { x: Math.round(ab.left), w: Math.round(ab.width), centre: Math.round(ab.left + ab.width / 2) } : null,
    lyricCol: { x: Math.round(lb.left), w: Math.round(lb.width), centre: Math.round(lb.left + lb.width / 2) },
    activeLine: ib ? { x: Math.round(ib.left), w: Math.round(ib.width), centre: Math.round(ib.left + ib.width / 2) } : null,
    gapSleeveToLyrics: ib && ab ? Math.round(ib.left - ab.right) : null,
    deadRight: ib ? Math.round(lb.right - ib.right) : null,
    lines,
  };
})()`;

let m = { err: "start" };
for (let i = 0; i < 8; i++) {
  await click("close lyrics");
  await click("fullscreen player");
  await wait(1000);
  await click("^(lyrics|open lyrics|show lyrics)$");
  await wait(1000);
  m = await ev(MEASURE);
  if (!m.err) break;
  await wait(600);
}
console.log(JSON.stringify(m, null, 2));
if (!m.err) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const fs = await import("node:fs");
  fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
  console.log("wrote", out);

  // The two fullscreen views are a pair, so the sleeve measure has to agree between them.
  await click("album view");
  await wait(1200);
  const np = await ev(`(() => {
    const n = document.querySelector('.now');
    const lyr = document.querySelector('.column');
    const g = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), centre: Math.round(r.left + r.width / 2) }; };
    const art = document.querySelector('.now .art-zone, .now [class*=art]') || (n && n.querySelector('img'));
    return { now: g(n), lyricsColumn: g(lyr), nowArt: g(art), stillLyrics: !!document.querySelector('.lyrics') };
  })()`);
  console.log("album view:", JSON.stringify(np));
  const s2 = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out.replace(/\.png$/, "-album.png"), Buffer.from(s2.result.data, "base64"));
  console.log("wrote", out.replace(/\.png$/, "-album.png"));
}
ws.close();
