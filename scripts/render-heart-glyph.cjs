// Diagnostic port of src-tauri/src/taskbar.rs glyph rasterisation.
//
// The difference from scripts/heart-proto.cjs matters, so do not treat them as duplicates:
// heart-proto samples `inside()` directly and writes top-down, which validates the GEOMETRY only.
// It cannot see BUG-054, because that bug lives in `rasterize()`'s buffer row order, which the
// prototype never models — that is precisely how D-050's render check passed while the shipped glyph
// stayed upside down. This script reproduces the buffer ordering as well, so it renders what the
// shell actually draws. If you are checking a glyph change, use this one.
//
// `topDown=true` means "buffer row 0 is drawn at the top", which is how the shell reads it after the
// BUG-054 fix.
const zlib = require("zlib");
const fs = require("fs");

const UNIT = 32.0, OUT = 64, SS = 3;
const WIDTH = 11.6, CX = 16.0, CY = 16.6, N = 96;
const HEART_STROKE = 0.62, GLYPH_SCALE = 1.75;
const TAU = Math.PI * 2;

function heartPolygon() {
  const raw = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * TAU;
    raw.push([
      16.0 * Math.pow(Math.sin(t), 3),
      13.0 * Math.cos(t) - 5.0 * Math.cos(2 * t) - 2.0 * Math.cos(3 * t) - Math.cos(4 * t),
    ]);
  }
  const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs);
  const miny = Math.min(...ys), maxy = Math.max(...ys);
  const s = WIDTH / Math.max(maxx - minx, maxy - miny);
  const cxr = (minx + maxx) / 2, cyr = (miny + maxy) / 2;
  // y negated: curve is y-up, icon is y-down
  return raw.map(([x, y]) => [CX + (x - cxr) * s, CY - (y - cyr) * s]);
}

const POLY = heartPolygon();
const PX = POLY.map((p) => p[0]), PY = POLY.map((p) => p[1]);
const BOX = [Math.min(...PX), Math.min(...PY), Math.max(...PX), Math.max(...PY)];

function pointInPoly(px, py) {
  let inside = false, j = POLY.length - 1;
  for (let i = 0; i < POLY.length; i++) {
    const [xi, yi] = POLY[i], [xj, yj] = POLY[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    j = i;
  }
  return inside;
}
function distSq(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}
function heart(x, y, filled) {
  const [minx, miny, maxx, maxy] = BOX;
  const pad = filled ? 0 : HEART_STROKE;
  if (x < minx - pad || x > maxx + pad || y < miny - pad || y > maxy + pad) return false;
  if (filled) return pointInPoly(x, y);
  const limit = HEART_STROKE * HEART_STROKE;
  let j = POLY.length - 1;
  for (let i = 0; i < POLY.length; i++) {
    if (distSq(x, y, POLY[j][0], POLY[j][1], POLY[i][0], POLY[i][1]) <= limit) return true;
    j = i;
  }
  return false;
}
function inside(x, y, filled) {
  const sx = 16.0 + (x - 16.0) / GLYPH_SCALE;
  const sy = 16.0 + (y - 16.0) / GLYPH_SCALE;
  return heart(sx, sy, filled);
}

// --- the rasteriser, faithful to taskbar.rs AFTER the BUG-054 fix (rows stored top-down) ---
function rasterize(filled) {
  const color = new Uint8Array(OUT * OUT * 4);
  const step = 1 / SS;
  for (let row = 0; row < OUT; row++) {
    for (let col = 0; col < OUT; col++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = (col + (sx + 0.5) * step) * UNIT / OUT;
          const y = (row + (sy + 0.5) * step) * UNIT / OUT;
          if (inside(x, y, filled)) hits++;
        }
      const a = Math.round((hits * 255) / (SS * SS));
      const i = (row * OUT + col) * 4;
      color[i] = a; color[i + 1] = a; color[i + 2] = a; color[i + 3] = a;
    }
  }
  return color;
}

// --- minimal PNG writer ---
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (const b of buf) c = (c >>> 8) ^ CRC_T[(c ^ b) & 0xff];
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function writePng(path, w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
              : Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  fs.writeFileSync(path, Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// Render at 6x on a dark backdrop. `topDown` picks which convention to display.
function show(path, filled, topDown) {
  const buf = rasterize(filled);
  const S = 6, W = OUT * S, H = OUT * S;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < OUT; y++) {
    // topDown=false: buffer row 0 is the BOTTOM (CreateIcon convention) -> flip for display
    // topDown=true : buffer row 0 is the TOP -> show as authored
    const srcRow = topDown ? y : OUT - 1 - y;
    for (let x = 0; x < OUT; x++) {
      const i = (srcRow * OUT + x) * 4;
      const a = buf[i + 3];
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++) {
          const o = ((y * S + dy) * W + (x * S + dx)) * 4;
          const bg = 26;
          out[o] = bg + (255 - bg) * (a / 255);
          out[o + 1] = bg + (255 - bg) * (a / 255);
          out[o + 2] = bg + (255 - bg) * (a / 255);
          out[o + 3] = 255;
        }
    }
  }
  writePng(path, W, H, out);
}

// geometry sanity: where does the silhouette put its mass?
function mass() {
  let topHits = 0, botHits = 0, topRowMin = null, botRowMax = null;
  for (let row = 0; row < OUT; row++) {
    let n = 0;
    for (let col = 0; col < OUT; col++) if (inside((col + 0.5) * UNIT / OUT, (row + 0.5) * UNIT / OUT, true)) n++;
    if (n > 0) { if (topRowMin === null) topRowMin = row; botRowMax = row; }
    if (row < OUT / 2) topHits += n; else botHits += n;
  }
  return { topRowMin, botRowMax, topHalfPixels: topHits, bottomHalfPixels: botHits };
}

console.log("polygon bbox (design units, y-down):", BOX.map((v) => v.toFixed(2)).join(", "));
console.log("filled-heart mass by half:", mass());
// After the BUG-054 fix the buffer is stored top-down and the shell draws buffer row 0 at the top,
// so `topDown=true` IS the app's view. Both heart states are rendered that way.
show("heart-app-filled.png", true, true);
show("heart-app-outline.png", false, true);
console.log("wrote heart-app-filled.png, heart-app-outline.png (both = how the shell draws them)");
