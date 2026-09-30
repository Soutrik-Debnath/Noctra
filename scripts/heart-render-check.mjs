// Renders the path that actually ships in src/components/icons.ts at the sizes the app really draws
// it, so a glyph change is judged on pixels and not on a path string or on a live view that other
// agent sessions keep navigating away from. Registration against the reference is not this script's
// job — trace-heart.mjs already reports that numerically.
//   node scripts/heart-render-check.mjs
import fs from "node:fs";

const src = fs.readFileSync("src/components/icons.ts", "utf8");
const heart = /heart: \[\s*"([^"]+)"/.exec(src);
const filled = /"heart-filled": \[\s*"([^"]+)"/.exec(src);
if (!heart || !filled) throw new Error("could not read the heart paths");
if (heart[1] !== filled[1]) throw new Error("heart and heart-filled are no longer one silhouette");
const d = heart[1];

const ref =
  "C:/Users/<you>/.qoder/tmp/D--Noctra-Project/images/1ef34e6d-91eb-4004-8cd8-f56362c5013f/04aea65a-5505-44bf-80f6-d7964cc1b25c.webp";
const refB64 = fs.readFileSync(ref).toString("base64");

const PORT = process.env.NOCTRA_CDP_PORT || "9223";
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

const WORK = `(async () => {
  const D = ${JSON.stringify(d)};
  const ref = new Image();
  ref.src = "data:image/webp;base64,${refB64}";
  await new Promise((r, j) => { ref.onload = r; ref.onerror = () => j(new Error("ref decode failed")); });

  const W = 1180, H = 620;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.fillStyle = "#0d0d11"; g.fillRect(0, 0, W, H);

  // Reference, on its own white ground, at the left.
  const rw = 420, rh = rw * (ref.naturalHeight / ref.naturalWidth);
  g.fillStyle = "#fff"; g.fillRect(30, 90, rw, rh);
  g.drawImage(ref, 30, 90, rw, rh);
  g.fillStyle = "#e8eaf0"; g.font = "15px system-ui";
  g.fillText("reference outline supplied by the owner", 30, 70);

  const plate = (x, y, w, h, label) => {
    g.fillStyle = "#191b21"; g.fillRect(x, y, w, h);
    g.fillStyle = "#8b8f9b"; g.font = "13px system-ui"; g.fillText(label, x, y + h + 20);
  };

  const glyph = (cx, cy, size, mode) => {
    g.save();
    g.translate(cx - size / 2, cy - size / 2);
    g.scale(size / 24, size / 24);
    const p = new Path2D(D);
    if (mode === "stroke") {
      g.strokeStyle = "#f2f3f7"; g.lineWidth = 2.15; g.lineJoin = "round"; g.lineCap = "round";
      g.stroke(p);
    } else {
      g.fillStyle = mode === "lit" ? "#ff2b4e" : "#f2f3f7";
      g.fill(p);
      if (mode === "lit") {
        g.shadowColor = "rgba(255,43,78,.85)"; g.shadowBlur = size * 0.18;
        g.fill(p);
      }
    }
    g.restore();
  };

  // Fullscreen: the reveal heart at the size the sleeve actually gives it. The host box measures
  // 341px on this display and the button is scaled .86, so the svg is ~293 and the ink ~205 wide.
  plate(500, 90, 330, 330, "fullscreen .bigheart at true size (293px svg, 205px ink)");
  glyph(665, 255, 293, "stroke");

  // Mini card: sleeve-relative, so much smaller, over a cover-like plate.
  plate(860, 90, 290, 330, "mini card .cover-heart (34px on a 150px sleeve, and 84px)");
  g.fillStyle = "#2a2d36"; g.fillRect(880, 110, 150, 150);
  glyph(955, 185, 48, "stroke");
  glyph(1075, 185, 84, "lit");

  // The sizes arguments get had at.
  plate(500, 460, 650, 120, "24 / 18 / 40 / 64 px, stroked and liked");
  glyph(540, 520, 24, "stroke");
  glyph(590, 520, 24, "lit");
  glyph(645, 520, 18, "stroke");
  glyph(695, 520, 18, "lit");
  glyph(770, 520, 40, "lit");
  glyph(860, 520, 64, "lit");

  return cv.toDataURL("image/png").split(",")[1];
})()`;

const b64 = await ev(WORK);
fs.writeFileSync("scripts/heart-shipped.png", Buffer.from(b64, "base64"));
console.log("path chars:", d.length, "-> scripts/heart-shipped.png");
ws.close();
