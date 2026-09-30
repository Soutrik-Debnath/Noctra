// Prototype for the taskbar heart: a parametric polygon, point-in-polygon for the filled variant
// and distance-to-edge for an even stroke. Rendered to PNG so orientation and band width can be
// checked before porting to Rust.
const fs = require("fs");
const zlib = require("zlib");

const OUT = 64;
const UNIT = 32.0;
const SS = 3;
const SCALE = 1.75; // matches GLYPH_SCALE in taskbar.rs

// Classic heart curve, y-up.
function rawHeart(n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push([16 * Math.sin(t) ** 3,
      13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
  }
  return pts;
}

/** Fit the raw curve into a target box in design space (y-down, 32 units). */
function heartPolygon(width, cx, cy) {
  const raw = rawHeart(240);
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  // Uniform fit so the aspect ratio survives; y flips because the curve is y-up.
  const s = Math.min(width / w, width / h);
  return raw.map(([x, y]) => [cx + (x - (minX + maxX) / 2) * s, cy - (y - (minY + maxY) / 2) * s]);
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyEdge(px, py, poly) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    best = Math.min(best, Math.hypot(px - cx, py - cy));
  }
  return best;
}

const POLY = heartPolygon(11.6, 16, 16.6);
const STROKE = 0.62; // half-width of the outline band, in design units

const shapes = {
  heart: (x, y) => distToPolyEdge(x, y, POLY) <= STROKE,
  heartFilled: (x, y) => pointInPoly(x, y, POLY),
};

function alphaAt(fn, col, row) {
  let hits = 0;
  const step = 1 / SS;
  for (let sy = 0; sy < SS; sy++)
    for (let sx = 0; sx < SS; sx++) {
      let x = (col + (sx + 0.5) * step) * UNIT / OUT;
      let y = (row + (sy + 0.5) * step) * UNIT / OUT;
      x = 16 + (x - 16) / SCALE;
      y = 16 + (y - 16) / SCALE;
      if (fn(x, y)) hits++;
    }
  return Math.round((hits * 255) / (SS * SS));
}

const crcT = [];
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePng(path, w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  fs.writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

// Show each heart at icon size and at 4x, on the dark thumbnail bar colour.
const names = Object.keys(shapes);
for (const [tag, cell] of [["big", 128], ["small", 32]]) {
  const w = cell * names.length, h = cell;
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = 0x2b; px[i * 4 + 1] = 0x2b; px[i * 4 + 2] = 0x30; px[i * 4 + 3] = 255; }
  names.forEach((n, gi) => {
    for (let row = 0; row < OUT; row++)
      for (let col = 0; col < OUT; col++) {
        const a = alphaAt(shapes[n], col, row);
        if (!a) continue;
        const bx = gi * cell + Math.floor((col / OUT) * cell);
        const by = Math.floor((row / OUT) * cell);
        for (let dy = 0; dy < Math.max(1, cell / OUT); dy++)
          for (let dx = 0; dx < Math.max(1, cell / OUT); dx++) {
            const X = bx + dx, Y = by + dy;
            if (X >= w || Y >= h) continue;
            const i = (Y * w + X) * 4, t = a / 255;
            px[i] = Math.round(0x2b * (1 - t) + 255 * t);
            px[i + 1] = Math.round(0x2b * (1 - t) + 255 * t);
            px[i + 2] = Math.round(0x30 * (1 - t) + 255 * t);
          }
      }
  });
  writePng(`heart-${tag}.png`, w, h, px);
  console.log(`wrote heart-${tag}.png`);
}

// Row profile proves the orientation: a heart must be WIDEST near the top (two lobes) and taper to a
// point at the bottom, with a notch splitting the very top row into two runs.
console.log("\ndesign y : filled px : runs  (y=0 is the TOP)");
for (const y of [2, 5, 8, 11, 14, 17, 20, 23, 26, 29]) {
  let f = 0, runs = 0, prev = false;
  for (let x = 0; x < 32; x++) {
    const s = 1 / SCALE;
    const dx = 16 + (x + 0.5 - 16) * s, dy = 16 + (y + 0.5 - 16) * s;
    const inn = pointInPoly(dx, dy, POLY);
    if (inn) f++;
    if (inn && !prev) runs++;
    prev = inn;
  }
  console.log(String(y).padStart(7), String(f).padStart(10), String(runs).padStart(6));
}
