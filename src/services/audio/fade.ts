/** Per-deck multipliers during a handoff. Both are 0..1 and are applied below user volume. */
export type Ramp = { out: number; in: number };

/**
 * A fade longer than half the track means the incoming and outgoing decks are the same song's
 * tail and head, which is not a crossfade. The caller's stored setting is never rewritten — this
 * only bounds one schedule (spec §7).
 */
export function clampFadeSeconds(requested: number, duration: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(requested, duration / 2);
}

/**
 * Linear equal-gain fade. `fadeSeconds <= 0` is the butt-joint case: an instant swap.
 *
 * Non-finite input answers the same way as "no fade" — full incoming, outgoing released. Anything
 * else is worse than that: `NaN` is falsy, so a defensive `ramp.out || 0` at a call site turns a
 * `NaN` gain into instant silence, and an `Infinity` fade length never reaches its end at all, so
 * the incoming deck would never arrive.
 */
export function rampAt(elapsed: number, fadeSeconds: number): Ramp {
  if (!Number.isFinite(elapsed) || !Number.isFinite(fadeSeconds)) return { out: 0, in: 1 };
  if (fadeSeconds <= 0) return { out: 0, in: 1 };
  const t = Math.max(0, Math.min(1, elapsed / fadeSeconds));
  return { out: 1 - t, in: t };
}
