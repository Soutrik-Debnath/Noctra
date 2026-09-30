// Measures whether "play similar" actually narrows the pool, using the only relatedness signal the UI
// exposes per track: its genre line. The bottom bar does not carry a genre, so the run is driven from
// the fullscreen transport, which shows "Genre · Year · Lossless" under the title.
//
// A library shuffle should scatter across genres; a similar run should stay in the seed's. Anything
// close to the same number means the mode is wired to the button and not to the play order.
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
// The bar's expand control carries a title, not an aria-label, so matching on aria-label alone clicked
// nothing and every later read came back empty.
const click = (label) =>
  ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>((x.getAttribute('aria-label')||'')+' '+(x.title||'')).trim()===${JSON.stringify(label)});if(!b)return 0;b.click();return 1;})()`);

const READ = `(() => {
  const media = [...document.querySelectorAll('.media')].map(e => e.textContent.replace(/\\s+/g,' ').trim());
  const title = [...document.querySelectorAll('.title')].map(e => e.textContent.trim());
  return { media: media[0] || null, title: title[title.length - 1] || null };
})()`;

const genreOf = (m) => (m ? m.split("·")[0].trim() : null);

await click("Open fullscreen player");
await wait(1400);

const exitFull = () =>
  ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/close|exit/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||''))&&/fullscreen|lyrics/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(b){b.click();return b.title||b.getAttribute('aria-label');}return 'MISS';})()`);

const setMode = (want) => ev(`(() => {
  const b = document.querySelector('footer.bar button[aria-label="Play similar"]');
  if (!b) return 'MISS';
  if ((b.getAttribute('aria-pressed') === 'true') !== ${want}) b.click();
  return 1;
})()`);

const readMode = () => ev(`(document.querySelector('footer.bar button[aria-label="Play similar"]')||{}).getAttribute?.('aria-pressed')`);

const run = async (label, want) => {
  // The toggle lives in the bottom bar, which is unmounted while fullscreen is up.
  for (let i = 0; i < 3; i++) {
    await exitFull();
    await wait(1200);
    if (!(await ev(`!!document.querySelector('.stage, .now')`))) break;
  }
  await setMode(want);
  await wait(600);
  const pressed = await readMode();
  // Without this the second half can silently run in the first half's mode and the two numbers being
  // different would mean nothing at all.
  if (pressed !== String(want)) {
    console.log(label, "ABORT — mode reads " + pressed + ", wanted " + want + " (bar mounted: " + (await ev(`!!document.querySelector('footer.bar')`)) + ")");
    return { same: -1, distinct: -1 };
  }
  await click("Open fullscreen player");
  await wait(1500);
  // Fail loudly: a null genre read is meaningless unless the view that carries it is actually open.
  const open = await ev(`!!document.querySelector('.stage, .now')`);
  if (!open) { console.log(label, "ABORT — fullscreen did not open"); return { same: -1, distinct: -1 }; }

  const seed = await ev(READ);
  const hops = [];
  for (let i = 0; i < 8; i++) {
    await ev(`(()=>{const bs=[...document.querySelectorAll('button[aria-label="Next track"]')];const b=bs[bs.length-1];if(b)b.click();return 1;})()`);
    await wait(1400);
    const s = await ev(READ);
    hops.push(genreOf(s.media));
  }
  const seedGenre = genreOf(seed.media);
  const same = hops.filter((g) => g && g === seedGenre).length;
  const distinct = new Set(hops.filter(Boolean)).size;
  console.log(label, "pressed=" + pressed, "seed=[" + seedGenre + "] " + seed.title);
  console.log(label, "same genre as seed: " + same + "/8   distinct genres visited: " + distinct + "  " + JSON.stringify(hops));
  return { same, distinct };
};

const off = await run("OFF", false);
const on = await run("ON ", true);
console.log("verdict: OFF " + off.same + "/8 same-genre, ON " + on.same + "/8 same-genre");
await setMode(false);
ws.close();
ws.close();
