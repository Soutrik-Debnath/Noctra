/**
 * Capture the README screenshots from a running app, and refuse to write a frame that leaks the
 * owner's machine.
 *
 * The library path is rendered on screen in some views (`C:/Users/<name>/Music`), so every capture
 * is preceded by a text scan and a hit skips that view rather than shipping a private path in a
 * public repo. Views are entered by clicking real controls: a synthetic DOM click on the play area
 * does not grant user activation, so audio never starts and the progress bar photographs at zero.
 *
 * Usage: node scripts/readme-shots.mjs [only...]     e.g. `node scripts/readme-shots.mjs home lyrics`
 */
import { writeFile, mkdir } from "node:fs/promises";

const PORT = process.env.NOCTRA_CDP_PORT ?? "9223";
const OUT = "docs/screenshots";
const LEAKS = ["soutr", "Users", "AppData", "C:/", "C:\\", "/home/"];
const only = process.argv.slice(2);

const VIEWS = {
  "01-home": { nav: "Home" },
  "02-library": { nav: "Library", top: true, wait: 5000 },
  // The sleeve's heart, orbs and transport are hover-gated by design, so a capture without the
  // pointer over the artwork photographs an empty cover — the README would advertise nothing.
  "03-now-playing": { fullscreen: true, play: 2, hover: ".art-zone" },
  "04-lyrics": { fullscreen: true, lyrics: true, play: 2 },
  "05-settings": { nav: "Settings", top: true },
};

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((k) => k.type === "page" && !k.url.includes("mini") && k.webSocketDebuggerUrl);
const target = pages.find((k) => k.url.includes("1420")) ?? pages[0];
if (!target) throw new Error(`no main target on ${PORT}`);

const ws = await (async () => {
  const w = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    w.onopen = res;
    w.onerror = () => rej(new Error("ws connect failed"));
  });
  return w;
})();

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => pending.has(i) && rej(new Error(`${method}: timeout`)), 20000);
  });
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
  return r.result?.value;
};
const settle = (ms) => ev(`new Promise(r => setTimeout(r, ${ms}))`);

// A trusted click: user activation is what lets audio start, and audio is what makes the seek bar
// and the artwork glow look like a player rather than a mockup.
async function clickNode(nodeSelector, { index = 0, label = "" } = {}) {
  const rect = await ev(`(() => {
    const n = document.querySelectorAll(${JSON.stringify(nodeSelector)})[${index}];
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  })()`);
  if (!rect) throw new Error(`no node for ${nodeSelector}${label}`);
  const { x, y } = JSON.parse(rect);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x, y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0,
    });
  }
}

async function nav(view) {
  const ok = await ev(`(() => {
    const hit = [...document.querySelectorAll('button.nav, a.nav')]
      .find(n => (n.textContent || '').trim().toLowerCase() === ${JSON.stringify(view.toLowerCase())});
    if (hit) hit.click();
    return !!hit;
  })()`);
  if (!ok) throw new Error(`nav ${view} not found`);
  await settle(1200);
}

async function dismissFullscreen() {
  // From the lyrics view it is "Close lyrics"; from the album view it is "Collapse". Clicking
  // whichever one exists avoids leaving fullscreen half-open and photographing the sidebar covered.
  await ev(`(() => {
    const b = document.querySelector('[aria-label="Close lyrics"]') || document.querySelector('[aria-label="Collapse"]');
    if (b) b.click();
  })()`);
  await settle(700);
}

async function openLyrics() {
  await ev(`(() => {
    const b = document.querySelector('[aria-label="Fullscreen lyrics"]') || document.querySelector('[aria-label="Lyrics"]');
    if (b) b.click();
    return !!b;
  })()`);
  await settle(1800);
}

/** True when the Lyrics view is the one on screen (it sets the attribute, empty-valued, on <html>). */
async function inLyrics() {
  return await ev(`document.documentElement.hasAttribute('data-lyrics-view')`);
}

async function enterFullscreen() {
  await clickNode('.bar > button.meta');
  await settle(2200);
  // Fullscreen resumes on whichever surface was last used, so ask for the album view explicitly.
  if (await inLyrics()) {
    await ev(`(() => { const b = document.querySelector('[aria-label="Album view"]'); if (b) b.click(); })()`);
    await settle(1400);
  }
}

async function scan() {
  // Only text that is actually painted can leak into the image. The Library section of Settings
  // prints the music folder below the fold, and a transient "Already in your library" toast on the
  // Library page fades on its own — a whole-DOM scan failed both for a frame that was clean.
  const hits = await ev(`(() => {
    const bad = ${JSON.stringify(LEAKS)};
    const vw = innerWidth, vh = innerHeight;
    return JSON.stringify([...document.querySelectorAll('body *')]
      .filter(e => !e.children.length)
      .filter(e => {
        const r = e.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
        const s = getComputedStyle(e);
        return s.visibility !== 'hidden' && Number(s.opacity) > 0.05;
      })
      .map(e => (e.textContent || '').trim())
      .filter(t => t && bad.some(b => t.includes(b)))
      .slice(0, 3));
  })()`);
  return JSON.parse(hits);
}

/** Scroll the page pane back to the top so a below-the-fold row cannot drift into the frame. */
async function toTop() {
  await ev(`(() => {
    const c = [...document.querySelectorAll('body *')]
      .filter(e => e.scrollHeight > e.clientHeight + 8)
      .sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (c) c.scrollTop = 0;
    scrollTo(0, 0);
    return c ? c.className : null;
  })()`);
  await settle(600);
}

/**
 * A toast that names the library folder fades on its own, so a fixed wait is a guess about someone
 * else's animation timing. Poll until the painted frame is clean, and report what was still there if
 * it never clears.
 */
async function scanUntilClean(budgetMs = 12000) {
  const until = Date.now() + budgetMs;
  for (;;) {
    const leaks = await scan();
    if (!leaks.length || Date.now() > until) return leaks;
    await settle(600);
  }
}

async function shoot(name) {
  const geo = JSON.parse(await ev(`JSON.stringify({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })`));
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: geo.w, height: geo.h, scale: geo.dpr },
    captureBeyondViewport: false,
  });
  const buf = Buffer.from(shot.data, "base64");
  await writeFile(`${OUT}/${name}.png`, buf);
  return { size: `${geo.w * geo.dpr}x${geo.h * geo.dpr}`, kb: Math.round(buf.length / 1024) };
}

await send("Page.enable");
await mkdir(OUT, { recursive: true });

// Maximise first: the shipped captures are full-width, and a 1280px window photographs a different
// layout than the one the README advertises.
const win = await send("Browser.getWindowForTarget");
await send("Browser.setWindowBounds", { windowId: win.windowId, bounds: { windowState: "maximized" } });
await settle(1500);

for (const [name, spec] of Object.entries(VIEWS)) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  await dismissFullscreen();
  if (spec.nav) await nav(spec.nav);
  if (spec.fullscreen) {
    if (!spec.nav) await nav("Home");
    await enterFullscreen();
    if (spec.lyrics) await openLyrics();
  }
  if (spec.wait) await settle(spec.wait);
  if (spec.top) await toTop();
  const leaks = await scanUntilClean();
  if (leaks.length) {
    console.log(`SKIP ${name}: leaks ${JSON.stringify(leaks)}`);
    continue;
  }
  const { size, kb } = await shoot(name);
  console.log(`ok   ${name}.png  ${size}  ${kb}KB`);
}

await dismissFullscreen();
await send("Browser.setWindowBounds", {
  windowId: win.windowId,
  bounds: { windowState: "normal", width: 1280, height: 800 },
});
ws.close();
process.exit(0);
