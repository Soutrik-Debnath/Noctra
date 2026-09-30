// Exercises the in-app dialog end to end: it must render, Escape must cancel without creating
// anything, and the happy path must actually create — then delete through the same surface so the
// library is left as found.
const PORT = process.env.NOCTRA_CDP_PORT || "9223";
const fs = await import("node:fs");
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const t = list.find((k) => k.type === "page" && k.url === "http://localhost:1420/");
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
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("D:/Noctra Project/scripts/" + name, Buffer.from(s.result.data, "base64"));
  console.log("wrote scripts/" + name);
};

await send("Page.navigate", { url: "http://localhost:1420/" });
await wait(2500);
// Go to Playlists and open the dialog the way the user does.
await ev(`(() => {
  const b = [...document.querySelectorAll('button.nav, button')].find(x => /^Playlists$/.test((x.textContent||'').trim()));
  if (b) b.click();
  return !!b;
})()`);
await wait(900);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /New playlist/.test(x.textContent||'')); if (b) b.click(); return !!b; })()`);
await wait(700);

console.log("dialog state:", await ev(`(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return 'NO DIALOG';
  const cs = getComputedStyle(d);
  const inp = d.querySelector('input');
  return JSON.stringify({
    title: d.querySelector('h2')?.textContent,
    label: d.querySelector('.field span')?.textContent,
    radius: cs.borderRadius,
    bg: cs.backgroundColor,
    hasInput: !!inp,
    focused: document.activeElement === inp,
    okDisabled: d.querySelector('.btn-primary')?.disabled,
    buttons: [...d.querySelectorAll('button')].map(b => b.textContent.trim()),
    scrimZ: getComputedStyle(d.parentElement).zIndex,
  }, null, 1);
})()`));
await shot("dialog-new-playlist.png");

// Type a name — the OK button must un-disable.
await ev(`(() => {
  const i = document.querySelector('[role="dialog"] input');
  i.value = 'Dialog Probe';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await wait(300);
console.log("after typing, okDisabled =", await ev(`document.querySelector('[role="dialog"] .btn-primary')?.disabled`));

// Escape cancels and must create nothing.
await ev(`(() => {
  document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return 1;
})()`);
await wait(500);
console.log("after Escape: dialog gone =", await ev(`!document.querySelector('[role="dialog"]')`),
  "| playlists =", await ev(`(document.body.innerText.match(/(\\d+) playlists?/)||[])[1]`));

// Now the happy path. The OK button is disabled until the bound `value` updates, and that lands on
// Svelte's next microtask — clicking in the same tick as the input event is a silent no-op.
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /New playlist/.test(x.textContent||'')); if (b) b.click(); return 1; })()`);
await wait(600);
await ev(`(() => {
  const i = document.querySelector('[role="dialog"] input');
  i.value = 'Dialog Probe';
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return 1;
})()`);
await wait(350);
const ready = await ev(`!document.querySelector('[role="dialog"] .btn-primary').disabled`);
await ev(`(() => { document.querySelector('[role="dialog"] .btn-primary').click(); return 1; })()`);
await wait(1000);
console.log("create: enabled before click =", ready,
  "| dialog closed =", await ev(`!document.querySelector('[role="dialog"]')`),
  "| playlists =", await ev(`(document.body.innerText.match(/(\\d+) playlist/)||[])[1]`));

// Remove the probe through the new confirm, so nothing invented is left in the library.
await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.className.includes('nav') && /^Playlists$/.test((x.textContent||'').trim())); if (b) b.click(); return 1; })()`);
await wait(800);
const menuBtn = await ev(`(() => {
  const card = [...document.querySelectorAll('button, .card, li, article')].find(x => /Dialog Probe/.test(x.textContent||''));
  if (!card) return 'no card';
  const b = [...card.querySelectorAll('button')].pop() || card;
  b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 400 }));
  b.click();
  return 'clicked';
})()`);
await wait(700);
const hasDelete = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => /^Delete/.test((x.textContent||'').trim())); if (b) { b.click(); return true; } return false; })()`);
await wait(800);
console.log("menu open:", menuBtn, "| Delete item found:", hasDelete);
console.log("confirm dialog:", await ev(`(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return 'NO DIALOG';
  const primary = d.querySelector('.btn-danger') || d.querySelector('.btn-primary');
  return JSON.stringify({ title: d.querySelector('h2')?.textContent, detail: d.querySelector('.detail')?.textContent, primary: primary?.textContent, danger: !!d.querySelector('.btn-danger') });
})()`));
await shot("dialog-confirm-delete.png");
await ev(`(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => /^Delete$/.test((x.textContent||'').trim())); if (b) b.click(); return 1; })()`);
await wait(900);
console.log("after confirming delete: playlists =",
  await ev(`(document.body.innerText.match(/(\\d+) playlist/)||[])[1]`),
  "| probe still listed:", await ev(`/Dialog Probe/.test(document.body.innerText)`));
ws.close();
