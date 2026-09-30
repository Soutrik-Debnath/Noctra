/**
 * How far ahead of the gate the standby deck starts loading. Two live streams is the cost, so this
 * is deliberately short: long enough for Chromium to decode a FLAC behind a patched header, short
 * enough that it is not holding two files for a whole track (spec §5).
 */
export const ARM_LEAD_SEC = 6;

/**
 * A butt joint has to start the incoming deck slightly *before* the outgoing one ends, or the
 * output device idles and you hear the gap the feature exists to remove.
 */
export const BUTT_JOINT_LEAD_SEC = 0.12;

export type HandoffInput = {
  gapless: boolean;
  /** Already clamped by `clampFadeSeconds`. */
  fadeSeconds: number;
  position: number;
  duration: number;
  hasNext: boolean;
  armed: boolean;
  standbyReady: boolean;
  fading: boolean;
};

export type HandoffAction =
  | { kind: "none" }
  | { kind: "arm" }
  /** `fade` is the already-clamped length, so no caller has to recompute it and disagree. */
  | { kind: "begin-fade"; fade: number }
  | { kind: "begin-butt-joint"; fade: number }
  | { kind: "abort-fade" };

const NONE: HandoffAction = { kind: "none" };

/**
 * Pure: one call per position tick, no I/O, no element. Every way this can be wrong is a silent
 * hole in the audio, which is why the rules live here rather than inline in the engine.
 */
export function decideHandoff(input: HandoffInput): HandoffAction {
  // Crossfade is a kind of gapless. If gapless is off, no second deck ever exists.
  if (!input.gapless) return NONE;
  // A fade already running is driven by the ramp loop, not by this decision.
  if (input.fading) return NONE;
  // No duration yet, a broken clock, or nothing queued: fall through to `ended` exactly as today.
  // A NaN `position` makes every comparison below false, which without this would read as "at the
  // gate" and commit us to a fade driven by a clock that is not reporting anything real.
  if (!Number.isFinite(input.duration) || input.duration <= 0 || !Number.isFinite(input.position))
    return NONE;
  if (!input.hasNext) return NONE;

  const remaining = input.duration - input.position;
  const fade = input.fadeSeconds > 0;

  // One definition of the gate, evaluated before arming. Arming inside the gate window can never
  // make the standby ready in time, so answering `arm` here would mask §7's abort fallback on every
  // remaining tick and re-open a second stream at exactly the moment we should abandon the handoff.
  const gate = fade ? input.fadeSeconds : BUTT_JOINT_LEAD_SEC;
  if (remaining <= gate) {
    if (input.armed && input.standbyReady) {
      return fade
        ? { kind: "begin-fade", fade: input.fadeSeconds }
        : { kind: "begin-butt-joint", fade: 0 };
    }
    // §7 defines an abort for the fade path only; a dropped butt joint falls through to `ended`,
    // which is audibly the same result and is what the existing test pins.
    return fade ? { kind: "abort-fade" } : NONE;
  }

  // Outside the gate: arm early enough that the standby can decode before it is needed.
  const lead = fade ? input.fadeSeconds + ARM_LEAD_SEC : ARM_LEAD_SEC;
  if (!input.armed && remaining <= lead) return { kind: "arm" };
  return NONE;
}
