/**
 * Arming helper for the click-driven one-shot animations defined in app.css.
 *
 * Two subtleties, both found by measurement rather than by reading:
 *
 * 1. The flag has to fall and rise on separate frames. Setting it false and then true inside one tick
 *    leaves the rendered class unchanged, so CSS never restarts and a second click during a running
 *    sweep does nothing — which reads as a dead control.
 * 2. A previous run's clear must be cancelled, or clicking twice quickly leaves the first click's
 *    `arm(false)` timer pending and it strips the class out of the middle of the second animation.
 *
 * Note this does NOT re-create the element. An attempt to restart by re-keying the glyph instead of
 * holding a class measured the repeat button frozen on its 0% keyframe across a 6s slow-motion
 * capture, while the same pattern worked on the sidebar and on shuffle.
 */
type Timer = ReturnType<typeof setTimeout>;

interface Run {
  raf: number;
  timeout: Timer | null;
}

const pending = new Map<string, Run>();

export function replay(key: string, arm: (on: boolean) => void, ms: number) {
  const previous = pending.get(key);
  if (previous) {
    cancelAnimationFrame(previous.raf);
    if (previous.timeout) clearTimeout(previous.timeout);
  }

  arm(false);
  const run: Run = { raf: 0, timeout: null };
  run.raf = requestAnimationFrame(() => {
    arm(true);
    run.timeout = setTimeout(() => {
      pending.delete(key);
      arm(false);
    }, ms);
  });
  pending.set(key, run);
}
