/**
 * Renders our transport + nav glyphs against their Phosphor Bold equivalents at the sizes the app
 * actually draws them, so the icon-swap decision is made from pixels instead of path arithmetic.
 *
 * Usage: node scripts/icon-sheet.mjs   ->  scripts/icon-sheet.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ph = JSON.parse(
  readFileSync(path.join(root, "node_modules/@iconify-json/ph/icons.json"), "utf8"),
);
// Node 24 strips the TS types itself, so the real module is the source of truth here.
const { paths: stroked, filled: filledMap } = await import(
  new URL("../src/components/icons.ts", import.meta.url)
);

const PH_GRID = 256;

function ours(name, size, isFilled) {
  const shapes = isFilled ? filledMap[name] : stroked[name];
  if (!shapes) return `<span class="miss">${name}</span>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${isFilled ? "currentColor" : "none"}" stroke="${isFilled ? "none" : "currentColor"}" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round">${shapes.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

function theirs(phName, size) {
  const icon = ph.icons[phName];
  if (!icon) return `<span class="miss">${phName}</span>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${PH_GRID} ${PH_GRID}">${icon.body}</svg>`;
}

const transport = [
  ["play", "play-bold", 28, true],
  ["pause", "pause-bold", 28, true],
  ["skipBack", "skip-back-bold", 24, true],
  ["skipForward", "skip-forward-bold", 24, true],
  ["shuffle", "shuffle-bold", 20, false],
  ["repeat", "repeat-bold", 20, false],
  ["repeat-one", "repeat-once-bold", 20, false],
];

const nav = [
  ["home", "house-bold", 20, false],
  ["library", "books-bold", 20, false],
  ["playlists", "list-dashes-bold", 20, false],
  ["stats", "chart-bar-bold", 20, false],
  ["settings", "gear-six-bold", 20, false],
  ["heart", "heart-bold", 20, false],
  ["search", "magnifying-glass-bold", 20, false],
  ["queue", "queue-bold", 20, false],
  ["volume", "speaker-high-bold", 20, false],
];

const activeFill = [
  ["house-fill", 20],
  ["books-fill", 20],
  ["list-dashes-fill", 20],
  ["chart-bar-fill", 20],
  ["heart-fill", 20],
  ["gear-six-fill", 20],
];

// Mirrors Icon.svelte's resolution order for weight="fill": own solid from icons.ts first, then the
// generated Phosphor body, then the outline. Rendered at the 19px the sidebar actually uses.
const { solid, SOLID_VIEWBOX } = await import(
  new URL("../src/components/solid.ts", import.meta.url)
);
const navNames = ["home", "library", "playlists", "heart", "stats", "settings"];

function resolved(name, size) {
  const own = filledMap[`${name}-filled`];
  if (own)
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${own.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
  const raw = solid[name];
  if (raw) {
    const grid = Number(SOLID_VIEWBOX.split(" ")[2]);
    const side = grid / 0.9; // mirrors SOLID_OPTICAL_SCALE in Icon.svelte
    const off = (side - grid) / 2;
    return `<svg width="${size}" height="${size}" viewBox="${-off} ${-off} ${side} ${side}" fill="currentColor">${raw}</svg>`;
  }
  // No solid form: heavier stroke, matching ACTIVE_STROKE in Icon.svelte.
  const shapes = stroked[name] ?? filledMap[name] ?? [];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round">${shapes.map((d) => `<path d="${d}"/>`).join("")}</svg>`;
}

function row(label, cells) {
  return `<tr><th>${label}</th>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>icon sheet</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0a0a0e; color:#fff; font:13px/1.4 system-ui; margin:0; padding:22px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; opacity:.55; margin:26px 0 8px; }
  table { border-collapse:collapse; }
  th { text-align:left; font-weight:500; opacity:.5; padding:6px 14px 6px 0; white-space:nowrap; font-size:11px; text-transform:uppercase; letter-spacing:.06em;}
  td { padding:6px 14px; vertical-align:middle; border-bottom:1px solid #ffffff10; }
  svg { display:block; }
  .miss { color:#f66; font-size:11px; }
  .cols { display:flex; gap:60px; }
</style></head><body>
<div class="cols"><div>
<h2>Transport — ours (filled) vs Phosphor Bold</h2>
<table>
${row("ours", transport.map(([n, , s, f]) => ours(n, s, f)))}
${row("phosphor", transport.map(([, p, s]) => theirs(p, s)))}
</table>

<h2>Nav + secondary — ours (stroked 2.15) vs Phosphor Bold</h2>
<table>
${row("ours", nav.map(([n, , s, f]) => ours(n, s, f)))}
${row("phosphor", nav.map(([, p, s]) => theirs(p, s)))}
</table>
</div><div>
<h2>Phosphor Fill — proposed active state</h2>
<table>
${row("fill", activeFill.map(([p, s]) => theirs(p, s)))}
${row("bold", activeFill.map(([p, s]) => theirs(p.replace("-fill", "-bold"), s)))}
</table>

<h2>Nav active state as shipped — 19px, Icon.svelte resolution order</h2>
<table>
${row("rest", navNames.map((n) => ours(n, 19, false)))}
${row("active", navNames.map((n) => resolved(n, 19)))}
</table>

<h2>Real scale: 18 / 20 / 24 / 28px</h2>
<table>
${row("ours 18", nav.map(([n]) => ours(n, 18, false)))}
${row("ph 18", nav.map(([, p]) => theirs(p, 18)))}
${row("ours 24", nav.map(([n]) => ours(n, 24, false)))}
${row("ph 24", nav.map(([, p]) => theirs(p, 24)))}
</table>
</div></div></body></html>`;

// Outside the Vite watch tree on purpose: an .html inside the project triggers a full app reload.
const out = path.join(os.tmpdir(), "noctra-icon-sheet.html");
writeFileSync(out, html);
console.log(out);
console.log("ours stroked:", Object.keys(stroked).length, "| filled:", Object.keys(filledMap).length);
