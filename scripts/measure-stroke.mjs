/**
 * Measure a stroked shape out of a screenshot: bounding box plus stroke thickness.
 *
 * The heart has been "too small" and "too ugly" across several rounds because every adjustment was
 * eyeballed from a thumbnail. The last one overcorrected into a heavy outline. This reads the
 * reference directly: the ink bounding box, and the run length of consecutive ink pixels along
 * scanlines that cross the stroke roughly perpendicular — which is the actual stroke width, not the
 * element's box.
 *
 * Usage: node scripts/measure-stroke.mjs <png> [x y w h]
 */
import fs from "node:fs";
import zlib from "node:zlib";

function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    if (type === "IDAT") idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === "IHDR") { w = buf.readUInt32BE(p + 8); h = buf.readUInt32BE(p + 12); ct = buf[p + 17]; }
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[q++];
    const line = raw.subarray(q, q + stride);
    q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev[x];
      const c = x >= ch ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, ch, px: out };
}

const [, , file, ...box] = process.argv;
const img = decode(file);
const [bx, by, bw, bh] = box.length === 4 ? box.map(Number) : [0, 0, img.w, img.h];
const at = (x, y) => { const i = (y * img.w + x) * img.ch; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };
// Bright and near-neutral: the heart ink is white, and the artwork behind it is not.
const ink = (x, y) => { const [r, g, b] = at(x, y); return r > 195 && g > 195 && b > 195 && Math.max(r, g, b) - Math.min(r, g, b) < 40; };

let minx = 1e9, maxx = -1, miny = 1e9, maxy = -1, n = 0;
for (let y = by; y < by + bh; y++) {
  for (let x = bx; x < bx + bw; x++) {
    if (!ink(x, y)) continue;
    n++;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
}
if (n < 50) { console.log("no ink found in region"); process.exit(1); }
const W = maxx - minx + 1, H = maxy - miny + 1;
console.log(`ink bbox  ${minx},${miny}  ${W}x${H}   pixels=${n}`);
console.log(`as fraction of the ${bw}x${bh} region: w=${(W / bw).toFixed(3)} h=${(H / bh).toFixed(3)}`);
console.log(`centre offset from region centre: ${((minx + maxx) / 2 - (bx + bw / 2)).toFixed(1)}, ${((miny + maxy) / 2 - (by + bh / 2)).toFixed(1)}`);

/*
 * Stroke width. A horizontal scanline crossing the heart's upper lobe meets the outline at a shallow
 * angle, which inflates the run; the near-vertical sides are crossed close to perpendicular, so the
 * shortest runs are the honest measurement. Report the distribution rather than one lucky line.
 */
const runs = [];
for (let f = 0.25; f <= 0.85; f += 0.05) {
  const y = Math.round(miny + H * f);
  let run = 0;
  for (let x = minx; x <= maxx; x++) {
    if (ink(x, y)) run++;
    else { if (run >= 1 && run <= 14) runs.push(run); run = 0; }
  }
  if (run >= 1 && run <= 14) runs.push(run);
}
runs.sort((a, b) => a - b);
const mode = (() => {
  const c = {};
  for (const r of runs) c[r] = (c[r] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0];
})();
const lo = runs[Math.floor(runs.length * 0.1)];
console.log(`stroke runs: n=${runs.length} min=${runs[0]} p10=${lo} mode=${mode[0]}px(x${mode[1]}) median=${runs[Math.floor(runs.length / 2)]}`);
