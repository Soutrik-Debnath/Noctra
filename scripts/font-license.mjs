/**
 * Read a font's own licence metadata out of its TTF/OTF name table.
 *
 * Aggregator web pages are unreliable about licensing — they are frequently wrong, outdated, or
 * hosting copies the site has no right to distribute. The font binary itself carries the designer's
 * stated licence in name IDs 13 (licence description) and 14 (licence URL), set by the foundry at
 * export time, so that is what gets checked before anything is bundled into a shipped app.
 *
 * Usage: node scripts/font-license.mjs <file.ttf> [...]
 */
import fs from "node:fs";

function names(file) {
  const b = fs.readFileSync(file);
  const num = b.readUInt16BE(4);
  const out = {};
  for (let i = 0; i < num; i++) {
    const rec = 12 + i * 16;
    const id = b.readUInt16BE(rec + 2);
    const off = b.readUInt16BE(rec + 4);
    const len = b.readUInt16BE(rec + 6);
    const storage = b.readUInt32BE(8) + off;
    const raw = b.subarray(storage, storage + len);
    // Platform 3 (Windows) stores UTF-16BE; others are mostly MacRoman.
    const isUtf16 = b.readUInt16BE(rec) === 3;
    let s;
    if (isUtf16) {
      s = "";
      for (let j = 0; j + 1 < raw.length; j += 2) s += String.fromCharCode(raw.readUInt16BE(j));
    } else {
      s = raw.toString("latin1");
    }
    if (id && !out[id]) out[id] = s;
  }
  return out;
}

const NAME = { 1: "family", 11: "manufacturer", 13: "LICENSE", 14: "LICENSE URL", 8: "designer/producer" };

for (const f of process.argv.slice(2)) {
  let n;
  try {
    n = names(f);
  } catch (e) {
    console.log(`${f}: unreadable (${e.message})`);
    continue;
  }
  console.log(`\n### ${n[1] || f}`);
  for (const k of ["family", "designer/producer", "manufacturer", "LICENSE", "LICENSE URL"]) {
    const id = Object.keys(NAME).find((x) => NAME[x] === k);
    if (!n[id]) continue;
    const v = String(n[id]).replace(/\s+/g, " ").trim();
    console.log(`  ${k.padEnd(19)} ${v.length > 220 ? v.slice(0, 220) + "…" : v}`);
  }
}
