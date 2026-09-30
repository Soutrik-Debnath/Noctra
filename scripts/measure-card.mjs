/**
 * Measure a reference card out of a screenshot instead of eyeballing it.
 *
 * The request is "make it exactly the same", and every previous round drifted because the target was
 * described in words rather than measured. This reads the reference frame and reports the card's outer
 * box, the heart's box as a fraction of the card, the volume rail, and the translucent fringe that
 * still sits outside the card's edge — the four numbers that decide whether the result matches.
 *
 * Usage: node scripts/measure-card.mjs <frame.png>
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

const img = decode(process.argv[2]);
const at = (x, y) => {
  const i = (y * img.w + x) * img.ch;
  return [img.px[i], img.px[i + 1], img.px[i + 2]];
};
const inBox = (x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h;

/**
 * The card is the only strongly red-dominant region in the bottom-right of the desktop, and the
 * wallpaper there is blue water or pale sand, so R-B separates them cleanly. Using a colour predicate
 * rather than an edge filter avoids mistaking the shoreline for the card's edge.
 */
const redness = (x, y) => { const [r, , b] = at(x, y); return r - b; };
const CARD_R_B = 45;

const X0 = +(process.argv[3] ?? 1300);
const Y0 = +(process.argv[4] ?? 500);
const BW = +(process.argv[5] ?? 0);
const BH = +(process.argv[6] ?? 0);
const X1 = BW ? X0 + BW - 1 : img.w - 1;
const Y1 = BH ? Y0 + BH - 1 : img.h - 1;

// Column vote over the vertical band, then row vote over the horizontal band.
const colHit = [];
for (let x = X0; x <= X1; x++) {
  let n = 0, tot = 0;
  for (let y = Y0; y <= Y1; y += 3) { tot++; if (redness(x, y) > CARD_R_B) n++; }
  colHit.push([x, n / tot]);
}
const rowHit = [];
for (let y = Y0; y <= Y1; y++) {
  let n = 0, tot = 0;
  for (let x = X0; x <= X1; x += 3) { tot++; if (redness(x, y) > CARD_R_B) n++; }
  rowHit.push([y, n / tot]);
}
const span = (arr, frac) => {
  const on = arr.filter(([, v]) => v > frac).map(([k]) => k);
  return on.length ? [on[0], on[on.length - 1]] : null;
};
let cardX, cardY;
if (BW && BH) {
  // An explicit box skips the colour vote, which only works on the reference's solid red panel and
  // fails on our own card, whose surface is a photograph with no dominant hue.
  cardX = [X0, X1];
  cardY = [Y0, Y1];
} else {
  cardX = span(colHit, 0.55);
  cardY = span(rowHit, 0.55);
}
if (!cardX || !cardY) { console.log("card not found"); process.exit(1); }
const [cx0, cx1] = cardX, [cy0, cy1] = cardY;
const cw = cx1 - cx0 + 1, chh = cy1 - cy0 + 1;
console.log(`card      ${cx0},${cy0}  ${cw}x${chh}   aspect ${(cw / chh).toFixed(3)}`);

/** Near-white blobs inside the card: the heart, the rail, the glyphs. */
const white = (x, y) => { const [r, g, b] = at(x, y); return r > 228 && g > 228 && b > 228; };
const blobs = [];
const seen = new Set();
for (let y = cy0; y <= cy1; y += 2) {
  for (let x = cx0; x <= cx1; x += 2) {
    if (!white(x, y) || seen.has(x + "," + y)) continue;
    const stack = [[x, y]];
    let minx = x, maxx = x, miny = y, maxy = y, n = 0;
    while (stack.length) {
      const [sx, sy] = stack.pop();
      const k = sx + "," + sy;
      if (seen.has(k) || !inBox(sx, sy) || !white(sx, sy)) continue;
      seen.add(k);
      n++;
      if (sx < minx) minx = sx; if (sx > maxx) maxx = sx;
      if (sy < miny) miny = sy; if (sy > maxy) maxy = sy;
      if (n > 9000) break;
      stack.push([sx + 2, sy], [sx - 2, sy], [sx, sy + 2], [sx, sy - 2]);
    }
    if (n > 120) blobs.push({ n, x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1 });
  }
}
blobs.sort((a, b) => b.w * b.h - a.w * a.h);
for (const b of blobs.slice(0, 6)) {
  const relX = ((b.x - cx0) / cw).toFixed(3), relY = ((b.y - cy0) / chh).toFixed(3);
  console.log(
    `blob      ${String(b.w).padStart(4)}x${String(b.h).padStart(4)}  ` +
      `frac of card w=${(b.w / cw).toFixed(3)} h=${(b.h / chh).toFixed(3)}  ` +
      `at rel(${relX},${relY})  px ${b.x - cx0},${b.y - cy0}  area ${b.n}`,
  );
}

/** The fringe: how far outside the card the translucent window margin still paints. */
const probeRow = Math.round((cy0 + cy1) / 2);
const left = [];
for (let x = cx0 - 1; x >= Math.max(X0, cx0 - 26); x--) {
  const [r, g, b] = at(x, probeRow);
  left.push(`${cx0 - x}:${r},${g},${b}`);
}
console.log(`\nleft of card @y=${probeRow}\n  ${left.join("  ")}`);
const above = [];
const probeCol = Math.round((cx0 + cx1) / 2);
for (let y = cy0 - 1; y >= Math.max(Y0, cy0 - 26); y--) {
  const [r, g, b] = at(probeCol, y);
  above.push(`${cy0 - y}:${r},${g},${b}`);
}
console.log(`\nabove card @x=${probeCol}\n  ${above.join("  ")}`);
