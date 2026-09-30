/**
 * Navigate the running app by clicking a real control, then prove the view actually changed.
 *
 * A previous sweep reported identical text counts for home, library and settings because the click
 * never landed: the fullscreen lyrics overlay covers the sidebar, so the nav helper silently no-op'd
 * and every "view" measured the same screen. Navigation is therefore verified by the `active` class
 * having moved onto the requested entry, and the process exits non-zero when it has not — so a
 * caller that pipes this into an audit cannot mistake a stuck screen for a clean result.
 *
 * Usage: node scripts/nav-to.mjs <Home|Library|Playlists|Favorites|Statistics|Settings>
 */
const VIEW = process.argv[2] || "Home";

// Dismiss fullscreen first, as its own step. Clicking it and then querying `button.nav` inside the
// same synchronous evaluation reads a DOM Svelte has not reconciled yet, which reported navCount 0
// while the sidebar was on screen and made a working app look broken.
const CLOSE = `(() => {
  const d = document;
  const el = d.querySelector('[aria-label="Close lyrics"]');
  // Only ever press this when the overlay is actually up. Clicking whatever else is called "Close" or
  // "Back" to get out of fullscreen dismissed unrelated panels and corrupted the very state being
  // measured, which is what made nav look like it had stopped working.
  if (el) el.click();
  return JSON.stringify({ dismissed: !!el });
})()`;

const CLICK = `(() => {
  const d = document;
  const navs = [...d.querySelectorAll("button.nav, a.nav")];
  const hit = navs.find((el) => (el.textContent || "").trim().toLowerCase() === ${JSON.stringify(VIEW.toLowerCase())});
  if (hit) hit.click();
  return JSON.stringify({ clicked: hit ? hit.textContent.trim() : null, navCount: navs.length });
})()`;

const PROOF = `(() => {
  const d = document;
  const navs = [...d.querySelectorAll("button.nav, a.nav")];
  return JSON.stringify({
    active: navs.filter((e) => String(e.className).includes("active")).map((e) => (e.textContent || "").trim()),
    textNodes: [...d.querySelectorAll("body *")].filter((e) => !e.children.length && (e.textContent || "").trim()).length,
    headings: [...d.querySelectorAll("h1,h2,h3")].map((e) => (e.textContent || "").trim().slice(0, 26)).slice(0, 5),
    fullscreen: !!d.querySelector('[class*="lyrics"] [aria-label="Close lyrics"], .shell[data-lyrics-view]'),
    dataLyrics: d.documentElement.getAttribute("data-lyrics-view"),
  });
})()`;

(async () => {
  const list = await (await fetch("http://127.0.0.1:9223/json")).json();
  // `1420` only exists in dev; an installed build serves from `tauri.localhost`. Requiring it made
  // this exit "no main target" against the release binary, and a sweep that ignored the failure
  // reported six views with identical element counts — six measurements of the one screen that was
  // already open. Excluding the mini card is what actually identifies the main window.
  const pages = list.filter((k) => k.type === "page" && !k.url.includes("mini"));
  const t = pages.find((k) => k.url.includes("1420")) || pages[0];
  if (!t) {
    console.error("no main target");
    process.exit(2);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Runtime.enable");
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    return r.result?.result?.value;
  };

  const before = JSON.parse(await ev(PROOF));
  // Two round-trips, not one. Dismissing fullscreen re-renders the sidebar, which detaches the nav
  // node looked up in the same pass — and dispatching a click at a detached element is silently
  // dropped, so the sweep reported the app was stuck while the tool was the thing that was broken.
  const closed = await ev(CLOSE);
  if (JSON.parse(closed).dismissed) await new Promise((r) => setTimeout(r, 350));
  const at = JSON.parse(await ev(CLICK));
  if (!at.clicked) {
    console.log("FAIL could not click:", JSON.stringify(at), closed);
    console.log("     was:", JSON.stringify(before));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 700));
  const after = JSON.parse(await ev(PROOF));
  const moved = after.active.some((a) => a.toLowerCase() === VIEW.toLowerCase());
  console.log(`${moved ? "ok  " : "FAIL"} ${VIEW}: active=[${after.active}] nodes=${after.textNodes} lyricsAttr=${after.dataLyrics}`);
  console.log(`     headings=${JSON.stringify(after.headings)}`);
  ws.close();
  process.exit(moved ? 0 : 1);
})();
