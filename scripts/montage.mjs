/**
 * Tile a region of many PNGs into one contact sheet.
 *
 * The reference recording is 37 frames of 1918x1078, and the thing being asked about — how the mini
 * card grows when the pointer enters, and what it looks like at rest — is a sequence. Reading it as
 * 37 separate images is slower and less accurate than seeing them in order on one sheet, which is the
 * only practical way to notice that the growth happens over ~4 frames, or that a hairline appears
 * beside the card in some states and not others.
 *
 * Usage: node scripts/montage.cjs <glob-dir> <out.png> [cols] [cellW] [cropX cropY cropW cropH]
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

const crcTbl = [];
for (let n = 0; n < 256; n++) {
  let k = n;
  for (let b = 0; b < 8; b++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
  crcTbl[n] = k >>> 0;
}
const crc32 = (buf) => {
  let x = 0xffffffff;
  for (const byte of buf) x = crcTbl[(x ^ byte) & 0xff] ^ (x >>> 8);
  return (x ^ 0xffffffff) >>> 0;
};

function encodeRGB(px, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const sec = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    parts.push(len, body, crc);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  sec("IHDR", ihdr);
  sec("IDAT", zlib.deflateSync(raw, { level: 6 }));
  sec("IEND", Buffer.alloc(0));
  return Buffer.concat(parts);
}

const [, , dir, out, colsS, cellWS, ...cropArgs] = process.argv;
const cols = +(colsS || 5);
const cellW = +(cellWS || 320);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
if (!files.length) { console.error("no pngs in", dir); process.exit(1); }

const first = decode(path.join(dir, files[0]));
const [cx, cy, cw0, chh0] = cropArgs.map(Number);
const crop = cropArgs.length === 4 ? { x: cx, y: cy, w: cw0, h: chh0 } : { x: 0, y: 0, w: first.w, h: first.h };
const cellH = Math.round((cellW * crop.h) / crop.w);
const rows = Math.ceil(files.length / cols);
const GAP = 4;
const W = cols * cellW + (cols + 1) * GAP;
const H = rows * cellH + (rows + 1) * GAP;
const sheet = Buffer.alloc(W * H * 3, 24);

/**
 * Downscale-blit a source rectangle into a destination cell.
 *
 * The first version of this divided by src.w/src.h instead of the crop's own extent, so a 478px crop
 * into a 300px cell sampled only the first ~47 columns and stretched them. Both contact sheets looked
 * plausible — one was a patch of beach, the other repeated the Recycle Bin in every cell — while
 * saying nothing at all about the card. A thumbnail that lies is worse than no thumbnail, because it
 * reads as evidence.
 */
function blit(src, sx0, sy0, sw, sh, dx, dy, dw, dh) {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(src.h - 1, sy0 + Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(src.w - 1, sx0 + Math.floor((x * sw) / dw));
      const si = (sy * src.w + sx) * src.ch;
      const di = ((dy + y) * W + dx + x) * 3;
      sheet[di] = src.px[si]; sheet[di + 1] = src.px[si + 1]; sheet[di + 2] = src.px[si + 2];
    }
  }
}

files.forEach((f, i) => {
  const img = decode(path.join(dir, f));
  const gx = i % cols, gy = (i / cols) | 0;
  blit(img, crop.x, crop.y, crop.w, crop.h, GAP + gx * (cellW + GAP), GAP + gy * (cellH + GAP), cellW, cellH);
});

fs.writeFileSync(out, encodeRGB(sheet, W, H));
console.log(`${files.length} frames -> ${out}  ${W}x${H}, cell ${cellW}x${cellH}, crop ${crop.w}x${crop.h}`);
