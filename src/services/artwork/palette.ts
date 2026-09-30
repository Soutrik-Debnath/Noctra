/**
 * Dominant-colour extraction.
 *
 * Drives the accent that tints the progress bar, controls, glow and lyric highlight. Runs once
 * per artwork URL and the result is cached, so a track's palette is computed the first time it is
 * looked at and never again — the same rule the blur follows.
 *
 * Why this exists: the library used to hand every track the same hardcoded accent, which made the
 * whole dynamic-colour system look broken. That was a real regression, not a Phase 4 nicety.
 */

import { loadArtwork } from "./imageCache";

const CACHE = new Map<string, string>();
const IN_FLIGHT = new Map<string, Promise<string>>();

/** Small enough to be near-free to scan, large enough to keep the dominant hue honest. */
const SAMPLE = 48;

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Pick the most saturated colour cluster rather than the most common one.
 *
 * Mode-of-all-pixels almost always returns a muddy near-black or a background tone, which reads as
 * "the theme didn't change". Weighting by saturation and excluding near-black/near-white/near-grey
 * gives an accent that actually looks like it came from the cover.
 */
function pickAccent(data: Uint8ClampedArray): string {
  const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 128) continue;

    const lum = luminance(r, g, b);
    if (lum < 26 || lum > 236) continue; // too dark or blown out to be a usable accent

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.16) continue; // near-grey: technically a colour but reads as no colour

    // Quantise to 32 levels per channel so neighbouring shades vote together.
    const key = ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);
    const weight = saturation * (1 - Math.abs(lum - 140) / 200);
    const entry = buckets.get(key);
    if (entry) {
      entry.weight += weight;
      entry.r += r * weight;
      entry.g += g * weight;
      entry.b += b * weight;
    } else {
      buckets.set(key, { weight, r: r * weight, g: g * weight, b: b * weight });
    }
  }

  let best: { weight: number; r: number; g: number; b: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.weight > best.weight) best = entry;
  }

  if (!best) return "184 148 108"; // last-resort warm neutral if a cover is all shadow or all grey

  const r = Math.min(255, Math.round(best.r / best.weight));
  const g = Math.min(255, Math.round(best.g / best.weight));
  const b = Math.min(255, Math.round(best.b / best.weight));

  // Dark covers yield dark accents, which are useless as UI colour — a near-black progress bar on
  // a near-black background reads as a bug. Scale the whole colour up until its brightest channel
  // clears a floor, preserving hue instead of flattening it to grey.
  const MIN_PEAK = 178;
  const peak = Math.max(r, g, b);
  const scale = peak > 0 ? Math.max(1, Math.min(255 / peak, MIN_PEAK / peak)) : 1;
  const fit = (v: number) => Math.min(255, Math.round(v * scale));
  return `${fit(r)} ${fit(g)} ${fit(b)}`;
}

async function extract(src: string): Promise<string> {
  const img = await loadArtwork(src);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "184 148 108";
  ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
  return pickAccent(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data);
}

/**
 * Resolve the "r g b" accent string for an artwork URL. Concurrent calls for the same URL share
 * one computation. Failures resolve to the fallback rather than rejecting, so a missing cover can
 * never break theming.
 */
export function getAccent(src: string | null | undefined): Promise<string> {
  if (!src) return Promise.resolve("184 148 108");
  const hit = CACHE.get(src);
  if (hit) return Promise.resolve(hit);
  const pending = IN_FLIGHT.get(src);
  if (pending) return pending;

  const job = extract(src)
    .then((accent) => {
      CACHE.set(src, accent);
      return accent;
    })
    .catch(() => "184 148 108")
    .finally(() => IN_FLIGHT.delete(src));

  IN_FLIGHT.set(src, job);
  return job;
}

/** Fire-and-forget warm-up for the track that is likely to play next. */
export function prefetchAccent(src: string | null | undefined): void {
  if (src) void getAccent(src);
}

/**
 * Ink that stays legible on top of an accent.
 *
 * The app's global `--on-accent` is a fixed near-black, and that is a decision rather than a
 * coincidence: the theme accent is tuned before it ships. An album's own accent is not — `pickAccent`
 * floors the brightest channel at 178, which still leaves a saturated red around WCAG luminance 0.10,
 * and measured dark ink on that cover is 2.86:1. So anything painting a glyph directly on a per-cover
 * colour has to choose the ink per colour.
 *
 * It picks the winner of the two inks rather than thresholding the accent's luminance, because the
 * threshold is a guess at exactly this ratio and loses: on the current twelve covers a 150 cutoff
 * bottoms out at 3.07:1 while always taking the better of dark and light bottoms out at 4.50:1.
 */
const DARK_INK = [8, 8, 12];
const LIGHT_INK = [244, 245, 247];

const srgb = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : (s + 0.055) ** 2.4 / 1.055 ** 2.4;
};

const wcagLum = (r: number, g: number, b: number) =>
  0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);

const contrast = (a: number[], b: number[]) => {
  const l1 = wcagLum(a[0], a[1], a[2]);
  const l2 = wcagLum(b[0], b[1], b[2]);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

export function inkFor(accent: string | undefined): string {
  if (!accent) return "#08080c";
  const rgb = accent.split(" ").map(Number);
  if (rgb.length !== 3 || rgb.some((v) => !Number.isFinite(v))) return "#08080c";
  return contrast(rgb, DARK_INK) >= contrast(rgb, LIGHT_INK) ? "#08080c" : "#f4f5f7";
}
