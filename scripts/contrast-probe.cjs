// Decodes a captured window PNG and reports per-region luminance, so text-vs-backdrop contrast can
// be checked numerically instead of by eye. Used to confirm the vibrant backdrop pass did not break
// viewability on a near-white cover.
const fs = require("fs");
const zlib = require("zlib");

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("unsupported bit depth " + bitDepth);
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : (() => { throw new Error("colorType " + colorType); })();
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
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    prev = cur;
  }
  return { w, h, ch, px: out };
}

const lum = (r, g, b) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const { w, h, ch, px } = decodePng(process.argv[2]);
const at = (x, y) => { const i = (y * w + x) * ch; return [px[i], px[i + 1], px[i + 2]]; };

// Regions where text must stay readable, as fractions of the window.
const regions = {
  "sidebar labels": [0.02, 0.10, 0.13, 0.45],
  "hero title": [0.24, 0.11, 0.50, 0.20],
  "section heading": [0.15, 0.31, 0.30, 0.36],
  "content mid": [0.35, 0.40, 0.75, 0.70],
  "player bar": [0.02, 0.90, 0.98, 0.98],
};

console.log(`image ${w}x${h}`);
for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
  const Ls = [];
  for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y += 2)
    for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x += 2) {
      const [r, g, b] = at(x, y);
      Ls.push(lum(r, g, b));
    }
  Ls.sort((a, b) => a - b);
  const pct = (p) => Ls[Math.min(Ls.length - 1, Math.floor(p * Ls.length))];
  // The bulk of any text region is background, so the median is the surface the glyphs sit on; the
  // top few percent are the white glyph pixels themselves.
  const bg = pct(0.5);
  const text = pct(0.995);
  const ratio = (text + 0.05) / (bg + 0.05);
  console.log(
    name.padEnd(18),
    "bg(median)=" + bg.toFixed(3),
    "text(p99.5)=" + text.toFixed(3),
    "contrast=" + ratio.toFixed(2) + ":1",
    ratio >= 4.5 ? "PASS AA" : ratio >= 3 ? "PASS large-text only" : "FAIL",
  );
}
