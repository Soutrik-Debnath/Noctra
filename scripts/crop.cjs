/**
 * Crop a rectangle out of a PNG so a suspicious audit number can be looked at directly.
 *
 * Three earlier audits each reported a catastrophic failure on text that was obviously fine in the
 * screenshot, and one reported a clean pass on text that was not. The only way to tell a real defect
 * from a bad sample is to view the pixels the sample claims to have measured, at a scale where a
 * 15px label is readable.
 *
 * Usage: node scripts/crop.cjs <in.png> <x> <y> <w> <h> <out.png> [zoom]
 */
const fs = require("node:fs");
const zlib = require("node:zlib");

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

function encode(png, w, h) {
  const stride = w * png.ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) png.px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunks = [];
  const sec = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    chunks.push(len, body, crc);
  };
  const tbl = [];
  for (let n = 0; n < 256; n++) {
    let k = n;
    for (let b = 0; b < 8; b++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
    tbl[n] = k >>> 0;
  }
  function crc32(buf) {
    let x = 0xffffffff;
    for (const byte of buf) x = tbl[(x ^ byte) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = png.ch === 4 ? 6 : 2;
  sec("IHDR", ihdr);
  const comp = zlib.deflateSync(raw);
  sec("IDAT", comp);
  sec("IEND", Buffer.alloc(0));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

const [, , file, xs, ys, ws, hs, out, zoomS] = process.argv;
const src = decode(file);
const [x0, y0, cw, chh] = [+xs, +ys, +ws, +hs].map(Math.round);
const zoom = Math.max(1, +(zoomS || 1) || 1);
const outPx = Buffer.alloc(cw * chh * src.ch);
for (let y = 0; y < chh; y++) {
  for (let x = 0; x < cw; x++) {
    const sx = Math.min(src.w - 1, x0 + x), sy = Math.min(src.h - 1, y0 + y);
    const si = (sy * src.w + sx) * src.ch;
    const di = (y * cw + x) * src.ch;
    outPx[di] = src.px[si];
    outPx[di + 1] = src.px[si + 1];
    outPx[di + 2] = src.px[si + 2];
    if (src.ch === 4) outPx[di + 3] = src.px[si + 3];
  }
}
const cropped = { px: outPx, ch: src.ch };
if (zoom > 1) {
  const zw = cw * zoom, zh = chh * zoom;
  const big = Buffer.alloc(zw * zh * src.ch);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      const si = (((y / zoom) | 0) * cw + ((x / zoom) | 0)) * src.ch;
      const di = (y * zw + x) * src.ch;
      big.set(outPx.subarray(si, si + src.ch), di);
    }
  }
  fs.writeFileSync(out, encode({ px: big, ch: src.ch }, zw, zh));
} else {
  fs.writeFileSync(out, encode(cropped, cw, chh));
}
console.log(`${file} [${x0},${y0} ${cw}x${chh}] -> ${out} @${zoom}x`);
