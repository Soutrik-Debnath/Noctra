/**
 * Render the wordmark in every candidate face, on the real sidebar colour, at the real size.
 *
 * Typefaces cannot be chosen from names, and this decision has already round-tripped through a
 * licence dead-end, so the cheapest way to settle it is to show it. Each candidate is drawn twice:
 * at the size the sidebar actually uses, and enlarged so the letterforms can be judged.
 *
 * Throwaway comparison — it writes one PNG and touches nothing in the app.
 *
 * Usage: node scripts/wordmark-sheet.mjs <fontDir> <outPng>
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const [fontDir, outPng] = process.argv.slice(2);
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 8791;
const DBG = 9391;

/* Taken from the live app: --fs-lg is 16px and `.word` multiplies it by 1.18. */
const REAL_PX = 18.88;
const BG = "#141319";
const INK = "#f7f7fa";

const files = fs.readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/i.test(f));
const faces = files.map((f, i) => ({ id: `F${i}`, file: f, label: f.replace(/\.(ttf|otf)$/i, "") }));

const rows = faces
  .map(
    (f) => `
  <div class="row">
    <div class="meta">${f.label}</div>
    <div class="real" style="font-family:'${f.id}'">Noctra</div>
    <div class="big" style="font-family:'${f.id}'">Noctra</div>
  </div>`,
  )
  .join("\n");

const page = `<!doctype html><meta charset="utf-8"><style>
${faces.map((f) => `@font-face{font-family:'${f.id}';src:url('/f/${encodeURIComponent(f.file)}');}`).join("\n")}
html,body{margin:0;background:${BG};color:${INK};font-family:system-ui,sans-serif}
.row{display:grid;grid-template-columns:150px 220px 1fr;align-items:center;gap:18px;padding:14px 26px;border-bottom:1px solid rgba(255,255,255,.07)}
.meta{font:600 11px system-ui;letter-spacing:.4px;text-transform:uppercase;color:rgba(247,247,250,.45)}
/* The size the sidebar actually renders at, with the current tracking. */
.real{font-size:${REAL_PX}px;letter-spacing:.6px}
/* Enlarged so the joins and terminals can be judged. Scripts are single-weight: no bold is applied,
   because these faces have no bold to give and synthesising one would misrepresent them. */
.big{font-size:52px;letter-spacing:.6px}
.cap{padding:18px 26px;font:600 12px system-ui;color:rgba(247,247,250,.5)}
</style>
<div class="cap">Left column = actual sidebar size (18.88px). Right column = 52px for detail.</div>
${rows}`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/f/")) {
    const name = decodeURIComponent(req.url.slice(3));
    const buf = fs.readFileSync(path.join(fontDir, name));
    res.writeHead(200, { "Content-Type": "font/ttf", "Content-Length": buf.length });
    res.end(buf);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
});

const profile = path.join(process.env.LOCALAPPDATA || "/tmp", `wm-profile-${Date.now()}`);
// Listen before launching Chrome: it navigates immediately on startup, and if nothing is bound yet
// the tab ends up on a chrome-error:// url that no longer matches the port, so the target is never
// found and the run dies with "chrome page never appeared".
await new Promise((r) => server.listen(PORT, r));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DBG}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--hide-scrollbars",
  `http://127.0.0.1:${PORT}/`,
]);

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      target = list.find((k) => k.type === "page" && k.url.includes(String(PORT)) && k.webSocketDebuggerUrl);
    } catch { /* starting */ }
  }
  if (!target) throw new Error("chrome page never appeared");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  await send("Page.enable");
  // Fonts must be loaded before painting or the fallback silently renders instead.
  await send("Runtime.evaluate", {
    expression: "document.fonts.ready.then(()=>true)",
    awaitPromise: true,
    returnByValue: true,
  });
  // Measure after the fonts have settled: scrollHeight taken before they load is short, because the
  // fallback metrics are smaller, and the last rows silently fall outside the clip.
  await send("Runtime.evaluate", { expression: "new Promise(r=>setTimeout(r,400))", awaitPromise: true });
  const geo = await send("Runtime.evaluate", {
    expression: "JSON.stringify({w:1000,h:Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)+40,dpr:1})",
    returnByValue: true,
  });
  // Runtime.evaluate nests the payload as result.result.value, not result.value.
  const { w, h } = JSON.parse(geo.result.result.value);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    captureBeyondViewport: false,
  });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));
  console.log(`${outPng}  ${w}x${h}  (${faces.length} faces)`);
  ws.close();
} finally {
  chrome.kill();
  server.close();
}
