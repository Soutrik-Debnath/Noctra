/**
 * Dev tool: screenshot a local HTML document through the app's WebView2, via its remote debugging
 * port.
 *
 * The document is served over http rather than opened as file:// because a file:// document is an
 * opaque origin in WebView2 and has produced blank captures before. It is served at a fixed path and
 * read from an absolute file, so probe markup can live outside the Vite watch tree — an .html file
 * inside the project makes Vite treat it as a page and full-reload the running app.
 *
 * Usage: node scripts/cdp-shot-url.mjs <absolute.html> <out.png> [width] [height]
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEBUG_PORT = process.env.NOCTRA_CDP_PORT ?? "9223";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , htmlPath, out, wArg = "1400", hArg = "900"] = process.argv;
const abs = path.resolve(root, htmlPath);
const doc = await readFile(abs);

// Port 0 lets the OS pick a free one: a run that fails to exit leaves a listener behind, and a fixed
// port then wedges every later capture.
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(doc);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/sheet`;

const browserWs = (
  await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()
).webSocketDebuggerUrl;

const ws = new WebSocket(browserWs);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(
      () => rej(new Error(`${method}: no reply inside 15s (dead target? app running?)`)),
      15000,
    );
    pending.set(i, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
    });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

const { targetId } = await send("Target.createTarget", { url });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });

await send("Page.enable", {}, sessionId);
await send(
  "Emulation.setDeviceMetricsOverride",
  { width: +wArg, height: +hArg, deviceScaleFactor: 2, mobile: false },
  sessionId,
);
// Two beats: one for the document to settle, one for the fonts.
await new Promise((r) => setTimeout(r, 700));
await send("Runtime.evaluate", { expression: "1" }, sessionId);
await new Promise((r) => setTimeout(r, 300));

const shot = await send("Page.captureScreenshot", {
  format: "png",
  clip: { x: 0, y: 0, width: +wArg, height: +hArg, scale: 1 },
}, sessionId);
await writeFile(path.join(root, out), Buffer.from(shot.data, "base64"));

await send("Target.closeTarget", { targetId });
ws.close();
server.close();
console.log(`${out}  ${wArg}x${hArg} @2x  <- ${url}`);
// The websocket keeps the event loop alive past close(); without this the process idles forever and
// holds the listener.
process.exit(0);
