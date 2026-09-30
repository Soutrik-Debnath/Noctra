// Verifies the two control changes on the running app:
//   1. no dot under an active bare orb, and the on-state now carries accent ink plus a real bloom
//   2. the play-similar toggle exists, flips, and actually changes what "next" picks
// The functional half presses next with the mode on and checks each new track shares an artist, an
// album token or a genre with its predecessor — a toggle that only changes a colour is not the feature
// that was asked for.
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

// The bar unmounts while fullscreen is up, so the probe has to leave that view first.
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/close lyrics|exit fullscreen|close fullscreen/i.test((x.getAttribute('aria-label')||'')+' '+(x.title||'')));if(b)b.click();return !!b;})()`);
await wait(1200);

console.log("--- on-state styling ---");
console.log(JSON.stringify(await ev(`(() => {
  const info = (el) => el ? {
    pressed: el.getAttribute('aria-pressed'),
    after: getComputedStyle(el, '::after').content,
    color: getComputedStyle(el).color,
    filter: getComputedStyle(el).filter,
  } : null;
  const bar = document.querySelector('footer.bar');
  const q = (label) => bar && [...bar.querySelectorAll('button[aria-label="' + label + '"]')][0];
  const shuffle = q('Shuffle');
  const off = (() => { if (!shuffle || shuffle.getAttribute('aria-pressed') !== 'false') return null;
    return { after: getComputedStyle(shuffle, '::after').content, filter: getComputedStyle(shuffle).filter }; })();
  return { barPresent: !!bar, shuffle: info(shuffle), repeat: info(q('Repeat')), similar: info(q('Play similar')),
    shuffleWasOff: off };
})()`, null), null, 2));

console.log("--- toggle and run ---");
// Svelte's DOM update lands a tick after the click, so the attribute is read back after a wait.
// Reading it synchronously returns the pre-click value and every later assertion inherits the lie.
const flip = async (want) => {
  await ev(`(() => {
    const b = document.querySelector('footer.bar button[aria-label="Play similar"]');
    if (!b) return 'MISS';
    if ((b.getAttribute('aria-pressed') === 'true') !== ${want}) b.click();
    return 1;
  })()`);
  await wait(400);
  return ev(`(() => {
    const b = document.querySelector('footer.bar button[aria-label="Play similar"]');
    return b ? b.getAttribute('aria-pressed') + ' | ' + b.title.slice(0, 34) : 'MISS';
  })()`);
};

const meta = () => ev(`(() => {
  const t = document.querySelector('footer.bar .title'), a = document.querySelector('footer.bar .artist');
  const img = document.querySelector('footer.bar img.thumb');
  const src = img ? img.src : '';
  return { title: t && t.textContent.trim(), artist: a && a.textContent.trim(),
    // The artwork is per-album, so its tail is a cheap stable album key: two tracks sharing it are
    // from the same record, which is the strongest signal similarTo awards.
    artKey: src.length + ':' + src.slice(-24) };
})()`);

const runWith = async (label, want) => {
  console.log(label, "pressed:", await flip(want));
  const out = [];
  for (let i = 0; i < 5; i++) {
    const before = await meta();
    await ev(`(()=>{const b=document.querySelector('footer.bar button[aria-label="Next track"]');if(b)b.click();return 1;})()`);
    await wait(1500);
    const after = await meta();
    out.push({ to: after.title, sameArtist: !!(before.artist && after.artist && before.artist === after.artist), sameAlbum: !!(before.artKey && before.artKey === after.artKey) });
  }
  const rel = out.filter((o) => o.sameArtist || o.sameAlbum).length;
  console.log(label, rel + "/5 hops share an artist or album", JSON.stringify(out));
  return rel;
};

const off = await runWith("similar OFF", false);
const on = await runWith("similar ON ", true);
console.log("restored OFF:", await flip(false));
console.log("relatedness OFF=" + off + "/5  ON=" + on + "/5");
ws.close();
