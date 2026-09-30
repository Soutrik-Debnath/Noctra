/**
 * Artwork blur — computed once per source, then reused.
 *
 * This is the core of the performance budget. A live `backdrop-filter: blur()` over a
 * full window destroys frame rate on integrated graphics, so instead we:
 *   1. downscale the artwork to a tiny tile,
 *   2. blur that tile once,
 *   3. hand back a data URL to be used as a plain background-image.
 *
 * Because the blur happens at ~180px rather than ~1280px, the cost is negligible and — more
 * importantly — it is paid *once*. Anything animating on screen afterwards only touches
 * `transform` and `opacity`, which the compositor handles without repaint.
 *
 * Phase 4 upgrades this from an in-memory map to a disk cache keyed by track fingerprint,
 * so a track never re-blurs across app restarts either.
 */

/** Width of the tile the blur is computed at. Small on purpose. */
const TILE = 180;

/** Blur radius relative to TILE. Looks far heavier once scaled to full window. */
const RADIUS = 14;

/**
 * The mean luminance the finished backdrop should land on, out of 255.
 *
 * This is the fix for bright covers washing the window out. The old pass applied a flat
 * `brightness(1.3)` to every artwork, which is right for a dark cover and catastrophic for a white
 * one — it clipped to 255 and every label on top of it went unreadable. Normalising toward a target
 * instead leaves the hue and the saturation exactly as they were and only reins in the level, so a
 * white cover stops blowing out without the whole app going muddy.
 */
const TARGET_LUMINANCE = 84;

/**
 * Chroma boost applied after luminance normalisation.
 *
 * The reference backdrop is deeply saturated AND deeply dark — those are independent axes. The
 * previous pass confused them by lifting brightness to 112 alongside the saturation, which is what
 * turned a vivid orange cover into a wash that no text could survive. Colour comes from this number;
 * level comes from TARGET_LUMINANCE, which stays low on purpose.
 */
const SATURATION = 2.75;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type BlurredArtwork = {
  url: string;
  /** 0..1, how bright the finished backdrop is. Drives how much veil the scrim needs. */
  luminance: number;
  /** 0..1, how bright the cover was before any correction. Drives ink choices over the art. */
  raw: number;
};

const cache = new Map<string, BlurredArtwork>();
const inFlight = new Map<string, Promise<BlurredArtwork>>();

import { loadArtwork } from "./imageCache";

/** Mean perceived luminance of an image, sampled at 16x16 — cheap and stable enough. */
function measureLuminance(img: CanvasImageSource): number {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 90;
  ctx.drawImage(img, 0, 0, 16, 16);
  const d = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  }
  return sum / n;
}

async function computeBlur(src: string): Promise<BlurredArtwork> {
  const img = await loadArtwork(src);
  const mean = measureLuminance(img);

  // Clamped at both ends: dark covers still need the lift that BUG-004 was about, and a ceiling
  // keeps a mid-tone cover from being crushed when the target divides it down.
  const brightness = clamp(TARGET_LUMINANCE / Math.max(mean, 18), 0.5, 1.45);

  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  // Saturation goes up to make up for the level coming down — the colour flooding the window is the
  // signature look, and it is chroma that carries it, not brightness. Without this the normalised
  // backdrop reads as muddy grey rather than dimmed colour.
  ctx.filter = `blur(${RADIUS}px) brightness(${brightness.toFixed(3)}) saturate(${SATURATION})`;
  // Overscan slightly so the blurred edges don't pull in transparent fringing.
  const over = RADIUS * 2;
  ctx.drawImage(img, -over, -over, TILE + over * 2, TILE + over * 2);

  return {
    url: canvas.toDataURL("image/jpeg", 0.72),
    luminance: (mean * brightness) / 255,
    raw: mean / 255,
  };
}

/**
 * Returns the blurred backdrop for an artwork, plus how bright it came out.
 * Concurrent calls for the same source share one computation, so a fast double-render can't
 * trigger two blurs.
 */
export function getBlurredArtwork(src: string): Promise<BlurredArtwork> {
  const hit = cache.get(src);
  if (hit) return Promise.resolve(hit);

  const pending = inFlight.get(src);
  if (pending) return pending;

  const job = computeBlur(src)
    .then((result) => {
      cache.set(src, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(src);
    });

  inFlight.set(src, job);
  return job;
}

/** Pre-warm the blur for a track that is likely to play next. */
export function prefetchBlurredArtwork(src: string): void {
  void getBlurredArtwork(src).catch(() => {
    /* A failed prefetch must never surface — the UI falls back to a flat colour. */
  });
}
