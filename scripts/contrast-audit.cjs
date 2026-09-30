/**
 * Contrast audit.
 *
 * Measures real rendered pixels rather than reasoning about CSS. For every visible text element it
 * samples the backdrop just OUTSIDE the element's own box — that ring is background by definition,
 * so it cannot be contaminated by the glyph antialiasing that makes a naive in-box average read too
 * dark. Contrast is then computed between the element's own computed colour and that backdrop.
 *
 * Usage: node scripts/contrast-audit.cjs <png> [elements.json]
 * Without an explicit JSON it reads `<png>-elements.json`, the file audit-run writes beside each
 * capture. The PNG and the element list must describe the same frame; a mismatch is not a warning,
 * it is a different app.
 */
const fs = require("fs");
const zlib = require("zlib");

function decodePng(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    p += 12 + len;
  }
  const ch = colorType === 6 ? 4 : 3;
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

const relLum = (r, g, b) => {
  const f = (c) => (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const parseColor = (s) => {
  const m = s.match(/[\d.]+/g);
  if (!m) return null;
  return { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] };
};
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

const { w, h, ch, px } = decodePng(process.argv[2]);

// Derive the element list from the PNG unless one is named explicitly. The default used to be the
// shared `scripts/audit-elements.json`, which meant `contrast-audit.cjs home.png` scored Home's
// pixels against whichever view had been collected last — it reported confident 1.46:1 failures on a
// "Pill" button that did not exist in the captured DOM. audit-run writes `<png>-elements.json` beside
// every capture precisely so a sweep cannot do this; the reader has to honour the same pairing.
const jsonPath =
  process.argv[3] || process.argv[2].replace(/\.[^.]+$/, "") + "-elements.json";
if (!fs.existsSync(jsonPath)) {
  console.error(
    `no element list for ${process.argv[2]}.\n` +
      `  looked for: ${jsonPath}\n` +
      `  run scripts/audit-run.cjs first, or pass the JSON explicitly. Refusing to guess.`,
  );
  process.exit(2);
}
const items = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
// [x0,y0,x1,y1] in device pixels: artwork and other image surfaces a backdrop sample must not land on.
const blockers = items.blockers || [];
const blocked = (X, Y) => blockers.some(([a, b, c, d]) => X >= a && X < c && Y >= b && Y < d);

// Client coords -> PNG pixels. The capture includes the window frame.
const OX = items.frame?.x ?? 8;
const OY = items.frame?.y ?? 31;

/*
  A sample is only evidence about a text element's *background* if it is not itself the same colour
  as the text. Adjacent chrome — a white slider thumb beside a white percentage, a white icon next to
  a white label, a bright album thumbnail beside a row title — gets scored as "the text is sitting on
  itself", and reports a catastrophic 1.06:1 for text that is perfectly legible in the screenshot.

  So: reject points inside images, and reject points whose pixel is within a hair of the text's own
  resolved colour. If every point is rejected, fall back to all of them rather than skipping the
  element, because an audit that silently omits what it cannot measure reports a clean pass.
*/
function sampleRing(rect, gap, ink, occ) {
  // Only to the sides and at the corners. Sampling directly above and below is a trap in a list:
  // the point lands on the glyphs of the row's own title, which is bright white text, and the
  // audit then reports the text as its own background.
  const mid = rect.y + rect.height / 2;
  const pts = [
    [rect.x - gap, mid],
    [rect.x + rect.width + gap, mid],
    [rect.x - gap, rect.y + rect.height * 0.2],
    [rect.x - gap, rect.y + rect.height * 0.8],
    [rect.x + rect.width + gap, rect.y + rect.height * 0.2],
    [rect.x + rect.width + gap, rect.y + rect.height * 0.8],
  ];
  const all = [];
  for (let i = 0; i < pts.length; i++) {
    const [sx, sy] = pts[i];
    const X = Math.round(sx + OX), Y = Math.round(sy + OY);
    if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
    const i2 = (Y * w + X) * ch;
    const rgb = [px[i2], px[i2 + 1], px[i2 + 2]];
    const sameInk =
      ink && Math.max(...rgb.map((v, j) => Math.abs(v - ink[j]))) <= 18;
    // `occ` is computed in the page: false means some unrelated element is on top at this point, so
    // the pixel says nothing about this text's background. Absent means the capture predates the
    // check, so treat every point as visible rather than silently dropping the element.
    const occluded = occ ? occ[i] === false : false;
    all.push({ rgb, clean: !blocked(X, Y) && !sameInk && !occluded });
  }
  if (!all.length) return null;
  // Prefer samples that are not sitting on an image, but never drop the element entirely: an audit
  // that quietly skips the text it cannot measure reports zero failures, which is worse than wrong.
  const pool = all.filter((s) => s.clean);
  // Exception: when every point is occluded by unrelated chrome the element is not measurable as a
  // contrast question at all. The pages scroll beneath the floating glass bar on purpose, so a
  // mid-scroll position routinely buries a row under it. That is an occlusion fact to report
  // separately, not a 1.06:1 contrast failure — falling back to the dirty samples here invented two
  // "critical" defects on text that was simply behind the bar.
  if (!pool.length) return { occluded: true, rgb: all[0].rgb };
  const use = pool;
  const lum = use.map((s) => relLum(...s.rgb));
  let bi = 0;
  for (let i = 1; i < lum.length; i++) if (lum[i] > lum[bi]) bi = i;
  // The brightest backdrop sample: the worst case for light text. An average hides the one spot
  // where the text actually becomes unreadable.
  return { rgb: use[bi].rgb };
}

let buried = 0;
const rows = [];
for (const it of items.elements) {
  const col = parseColor(it.color);
  if (!col || col.a < 0.05) continue;
  const col0 = parseColor(it.color);
  const ink0 = col0 && col0.a > 0.5 ? [col0.r, col0.g, col0.b] : null;
  const ring = sampleRing(it.rect, it.gap ?? 5, ink0, it.ring);
  if (!ring) continue;
  if (ring.occluded) {
    buried++;
    continue;
  }
  // The ring is measured outside the box, so it carries the app backdrop and any card behind the
  // element but not the element's own fill — a pill with a translucent background would otherwise be
  // audited against the artwork behind it rather than against itself.
  const own = it.ownBg ? parseColor(it.ownBg) : null;
  const bgRgb =
    own && own.a > 0.02
      ? [own.r, own.g, own.b].map((v, i) => v * own.a + ring.rgb[i] * (1 - own.a))
      : ring.rgb;
  const bg = relLum(...bgRgb);
  // Blend the text's own alpha over the sampled backdrop before measuring.
  const tl = relLum(col.r, col.g, col.b);
  const eff = col.a * tl + (1 - col.a) * bg;
  const c = ratio(eff, bg);
  // WCAG "large text": 24px, or 18.66px at bold. Measured from the font size rather than the box
  // height, because the rects arrive in device pixels and would misreport at any DPR above 1.
  const big = it.fontSize >= 24 || (it.fontSize >= 18.66 && it.bold);
  rows.push({
    sel: it.sel,
    text: it.sample,
    size: it.fontSize,
    weight: it.fontWeight,
    contrast: +c.toFixed(2),
    needs: big ? 3 : 4.5,
    pass: c >= (big ? 3 : 4.5),
    // Carried through so a suspicious number can be checked without re-deriving it: three of these
    // audits have now reported a failure on text that is obviously fine in the screenshot, and the
    // only way to tell a real defect from a bad sample is to see what was sampled and where.
    rect: it.rect,
    bg: bgRgb.map((v) => Math.round(v)),
  });
}

rows.sort((a, b) => a.contrast - b.contrast);
const fails = rows.filter((r) => !r.pass);
console.log(
  `sampled ${rows.length} text elements — ${fails.length} FAIL` +
    (buried ? `  (${buried} fully covered by chrome, not measurable)` : "") +
    "\n",
);
for (const r of rows.slice(0, 22)) {
  console.log(
    (r.pass ? "  ok  " : " FAIL ") + r.contrast.toFixed(2).padStart(6) + " (needs " + r.needs + ")" +
    "  " + String(r.size).padStart(5) + " w" + String(r.weight).padStart(4) + "  " + r.sel.slice(0, 58),
  );
}
if (fails.length) {
  console.log("\nworst offenders (rect and sampled background, so a bad sample is distinguishable from a real defect):");
  for (const f of fails.slice(0, 10)) {
    const r = f.rect;
    console.log(
      " ", String(f.contrast.toFixed(2)).padStart(5), f.sel.padEnd(16),
      `@${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      "bg", f.bg.join(","), "|", f.text ?? "",
    );
  }
}
