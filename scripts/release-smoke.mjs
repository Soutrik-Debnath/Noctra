/**
 * Release smoke: drive the *installed* app through its real surfaces and collect every uncaught
 * exception and console error.
 *
 * This exists because a release build strips `window.__noctra`, so none of the store-level probes
 * work against it — and the things that only break in a shipped binary (asset paths, the custom
 * protocol, minified CSS, capability permissions) are exactly the ones a dev-server pass cannot see.
 * Interaction therefore happens by clicking real controls, and the pass/fail is the error log rather
 * than a screenshot someone has to like.
 *
 * Run against the installed exe with a temporary debug port:
 *   powershell ... WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223'
 *   node scripts/release-smoke.mjs
 */
const PORT = process.env.NOCTRA_CDP_PORT || "9223";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === "page" && !t.url.includes("mini") && t.webSocketDebuggerUrl);
const target = pages.find((t) => t.url.includes("1420")) || pages[0];
if (!target) {
  console.error("no main window target; is the app running with the debug port?");
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    problems.push(`EXCEPTION: ${(d.exception?.description || d.text || "unknown").split("\n")[0]}`);
  }
  if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
    const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 180);
    if (text) problems.push(`${m.params.type.toUpperCase()}: ${text}`);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Runtime.enable");
await send("Page.enable");

/** Click by a control's own name. Matched per-attribute: a button carrying both aria-label="Play"
 *  and title="Play" reads as "Play  Play" when the fields are concatenated, which silently missed
 *  the transport and fell through to the first label starting with "Play" — the Playlists nav row. */
const click = (selector, label) =>
  ev(`(() => {
    const want = ${JSON.stringify(label)};
    const names = (e) => [e.getAttribute('aria-label'), e.title, e.textContent].filter(Boolean).map(s => s.trim());
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = want ? (els.find(e => names(e).includes(want)) || els.find(e => names(e).some(n => n.startsWith(want)))) : els[0];
    if (!el) return 'MISSING:' + els.length;
    el.click();
    return 'clicked ' + names(el)[0].slice(0,26);
  })()`);

const report = [];

for (const view of ["Home", "Library", "Playlists", "Favorites", "Statistics", "Settings"]) {
  const nav = await click("button.nav, .nav, [class*=row]", view);
  await wait(900);
  const active = await ev(`(() => { const a = document.querySelector('.row.active, [aria-current]'); return a ? a.textContent.trim().slice(0,20) : 'none'; })()`);
  report.push(`${view.padEnd(11)} nav=${String(nav).slice(0, 26).padEnd(27)} active=${active}`);
}

// The surfaces a view sweep never reaches: fullscreen, the queue drawer, the palette, playback.
report.push("fullscreen  " + (await click("button", "Open fullscreen player")));
await wait(1600);
report.push("  art-zone  " + (await ev("!!document.querySelector('.art-zone') ? 'present' : 'MISSING'")));
// The two fixes this build is supposed to carry, checked where they actually live.
report.push("  glass     " + (await ev(`(() => { const e = document.querySelector('.art-zone'); if (!e) return 'n/a';
  for (const s of document.styleSheets) { try { for (const r of s.cssRules) if (r.selectorText === '.glass') return /backdrop-filter/.test(r.cssText) ? 'HAS backdrop-filter' : 'MISSING'; } catch (x) {} }
  return 'no .glass rule'; })()`)));
report.push("  heart     " + (await ev(`(() => { const h = document.querySelector('.bigheart'), a = document.querySelector('.art-zone');
  if (!h || !a) return 'n/a'; const H = h.getBoundingClientRect(), A = a.getBoundingClientRect();
  return 'offset ' + ((H.x+H.width/2)-(A.x+A.width/2)).toFixed(1) + ',' + ((H.y+H.height/2)-(A.y+A.height/2)).toFixed(1); })()`)));
report.push("  exit      " + (await click("button", "Album view")) + " / " + (await click("button", "Close lyrics")));
await wait(1200);
report.push("queue       " + (await click("button", "Queue")));
await wait(700);
await click("button", "Close queue");
await wait(400);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 2 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "k", code: "KeyK", windowsVirtualKeyCode: 75, modifiers: 2 });
await wait(700);
report.push("palette     " + (await ev("!!document.querySelector('[class*=palette], [role=dialog]') ? 'opened' : 'did not open'")));
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await wait(400);

// Playback through the real transport button. The proof it worked is the control changing its own
// name to Pause, and the clock moving — not a screenshot.
const before = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(x => ['Play','Pause'].includes((x.getAttribute('aria-label')||'').trim())); return b ? b.getAttribute('aria-label').trim() : 'none'; })()`);
report.push("play        " + (await click("button", "Play")) + " (was: " + before + ")");
await wait(3000);
report.push("  after     " + (await ev(`(() => {
  const b = [...document.querySelectorAll('button')].find(x => ['Play','Pause'].includes((x.getAttribute('aria-label')||'').trim()));
  return 'label=' + (b ? b.getAttribute('aria-label').trim() : 'none');
})()`)));

console.log(report.join("\n"));
const unique = [...new Set(problems)];
console.log(`\n=== ${unique.length} distinct console/exception issue(s) ===`);
console.log(unique.slice(0, 20).map((p) => "  " + p).join("\n") || "  none");
ws.close();
process.exit(unique.length ? 1 : 0);
