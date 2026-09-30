/**
 * Pull still frames out of a video without installing a decoder.
 *
 * The reference for the mini-player work is a screen recording, and "make it grow exactly like this"
 * cannot be answered from two stills — the whole request is about the transition. Neither ffmpeg nor a
 * Python imaging library is present, and installing system tooling was ruled out, so this uses the
 * Google Chrome that is already on the machine: it already decodes H.264, and driving it over CDP lets
 * a <video> element seek to any timestamp and hand the frame back through a canvas.
 *
 * The file is served over HTTP with byte-range support rather than as a file:// URL: seeking needs
 * range requests, and a file:// page taints the canvas so toDataURL throws.
 *
 * Usage:
 *   node scripts/video-frames.mjs info
 *   node scripts/video-frames.mjs grab <outDir> <t0> <t1> <stepSeconds>
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const VIDEO =
  process.env.NUCTRA_VIDEO ||
  "C:/Users/<you>/AppData/Local/Packages/Microsoft.ScreenSketch_8wekyb3d8bbwe/TempState/Recordings/20260926-1509-50.1918473.mp4";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 8765;
const DBG = 9333;

const HARNESS = `<!doctype html><meta charset=utf-8>
<video id=v muted playsinline preload=auto src="/video"></video>
<canvas id=c></canvas>
<script>
  window.ready = new Promise((res) => {
    document.getElementById("v").addEventListener("loadedmetadata", () => res(true), { once: true });
  });
  window.grab = async (t) => {
    const v = document.getElementById("v"), c = document.getElementById("c");
    if (!v.videoWidth) return { error: "no video" };
    if (Math.abs(v.currentTime - t) > 0.001) {
      await new Promise((res, rej) => {
        const ok = () => { v.removeEventListener("seeked", ok); v.removeEventListener("error", bad); res(); };
        const bad = () => { v.removeEventListener("seeked", ok); v.removeEventListener("error", bad); rej(new Error("seek failed")); };
        v.addEventListener("seeked", ok);
        v.addEventListener("error", bad);
        v.currentTime = t;
        setTimeout(ok, 4000);
      });
    }
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    return { t, w: v.videoWidth, h: v.videoHeight, dur: v.duration, png: c.toDataURL("image/png").slice(22) };
  };
</script>`;

const server = http.createServer((req, res) => {
  if (req.url === "/video") {
    const size = fs.statSync(VIDEO).size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? +range[2] : size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": "video/mp4",
      });
      fs.createReadStream(VIDEO, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": size, "Content-Type": "video/mp4", "Accept-Ranges": "bytes" });
      fs.createReadStream(VIDEO).pipe(res);
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(HARNESS);
});

async function cdpFetch(p) {
  const r = await fetch(`http://127.0.0.1:${DBG}${p}`);
  return r.json();
}

function connect(url) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error("ws error"));
  });
}

let msgId = 0;
function makeSend(ws) {
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  return (method, params = {}) =>
    new Promise((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
}

async function evalIn(send, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.error) throw new Error(JSON.stringify(r.error).slice(0, 300));
  return r.result?.result?.value;
}

const mode = process.argv[2] || "info";
if (!fs.existsSync(VIDEO)) {
  console.error("no video at", VIDEO);
  process.exit(2);
}

server.listen(PORT);
// A fixed user-data-dir makes the second run attach to the previous, already-killed browser's
// session, and the page then reports videoWidth 0 forever. Each run gets its own profile.
const profile = path.join(process.env.LOCALAPPDATA || ".", `noctra-frame-profile-${Date.now()}`);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DBG}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--disable-background-timer-throttling",
  "--allow-file-access-from-files",
  `http://127.0.0.1:${PORT}/`,
]);

let ws;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = await cdpFetch("/json/list");
      target = list.find((k) => k.type === "page" && k.url.includes(String(PORT)) && k.webSocketDebuggerUrl);
    } catch { /* chrome still booting */ }
  }
  if (!target) throw new Error("chrome page never appeared");

  ws = await connect(target.webSocketDebuggerUrl);
  const send = makeSend(ws);
  await send("Runtime.enable");
  await evalIn(send, "window.ready");
  let first = null;
  for (let i = 0; i < 30; i++) {
    first = await evalIn(send, "window.grab(0)");
    if (first && !first.error) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!first || first.error) throw new Error(`video never decoded: ${first?.error}`);
  console.log(`video ${first.w}x${first.h}  duration ${first.dur.toFixed(2)}s`);

  if (mode === "grab") {
    const [, , , outDir, t0s, t1s, stepS] = process.argv;
    fs.mkdirSync(outDir, { recursive: true });
    const t0 = +t0s, t1 = Math.min(+t1s, first.dur - 0.05), step = +stepS;
    let n = 0;
    for (let t = t0; t <= t1 + 1e-6; t += step) {
      const f = await evalIn(send, `window.grab(${t.toFixed(3)})`);
      fs.writeFileSync(path.join(outDir, `f-${String(n).padStart(3, "0")}-${t.toFixed(2)}s.png`), Buffer.from(f.png, "base64"));
      n++;
    }
    console.log(`wrote ${n} frames to ${outDir}`);
  }
} finally {
  ws?.close();
  chrome.kill();
  server.close();
}
