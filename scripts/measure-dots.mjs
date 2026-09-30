/**
 * Measure the three-dot lyric indicator out of a reference recording, frame by frame.
 *
 * "Make it do this dot animation" cannot be answered from a thumbnail. What has to be known is how
 * many dots, how big, how far apart, how far they travel, whether the wave runs left to right, and
 * how much they brighten as they rise — and the only honest source for that is the pixels.
 *
 * Reads the PNGs `video-frames.mjs grab` wrote, so the frames are already decoded from H.264 by
 * Chrome; this only clusters bright blobs.
 *
 * Usage: node scripts/measure-dots.mjs <framesDir> [cropX cropY cropW cropH] [threshold]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
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

const argv = process.argv.slice(2);
const dir = argv[0];
if (!dir || !fs.existsSync(dir)) {
  console.error("usage: node scripts/measure-dots.mjs <framesDir> [cropX cropY cropW cropH] [threshold]");
  process.exit(2);
}
const [, x0a, y0a, wA, hA, thrA] = argv;
const cx = Number(x0a ?? 620), cy = Number(y0a ?? 195);
const cw = Number(wA ?? 420), chh = Number(hA ?? 110);
const thr = Number(thrA ?? 150);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();

for (const f of files) {
  const { w, h, ch: nch, px } = decode(path.join(dir, f));
  const x0 = Math.max(0, cx), y0 = Math.max(0, cy);
  const x1 = Math.min(w, x0 + cw), y1 = Math.min(h, y0 + chh);
  const at = (x, y) => {
    const i = (y * w + x) * nch;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };
  // Connected components over the bright mask, 4-neighbour flood.
  const seen = new Set();
  const blobs = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (at(x, y) < thr || seen.has(y * w + x)) continue;
      const stack = [[x, y]];
      let n = 0, sx = 0, sy = 0, peak = 0, minx = x, maxx = x, miny = y, maxy = y;
      seen.add(y * w + x);
      while (stack.length) {
        const [bx, by] = stack.pop();
        n++;
        sx += bx;
        sy += by;
        const l = at(bx, by);
        if (l > peak) peak = l;
        if (bx < minx) minx = bx;
        if (bx > maxx) maxx = bx;
        if (by < miny) miny = by;
        if (by > maxy) maxy = by;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx2 = bx + dx, ny2 = by + dy;
          if (nx2 < x0 || ny2 < y0 || nx2 >= x1 || ny2 >= y1) continue;
          const k = ny2 * w + nx2;
          if (seen.has(k) || at(nx2, ny2) < thr) continue;
          seen.add(k);
          stack.push([nx2, ny2]);
        }
      }
      if (n < 12) continue; // antialiasing specks
      blobs.push({
        cx: +(sx / n).toFixed(1),
        cy: +(sy / n).toFixed(1),
        r: +(Math.sqrt(n / Math.PI)).toFixed(1),
        w: maxx - minx + 1,
        h: maxy - miny + 1,
        peak: Math.round(peak),
      });
    }
  }
  blobs.sort((a, b) => a.cx - b.cx);
  console.log(`${f.padEnd(22)} ${blobs.length} dot(s)  ${blobs.map((b) => `x${b.cx} y${b.cy} r${b.r} ${b.w}x${b.h} L${b.peak}`).join(" | ")}`);
}
