/**
 * Motion for the lyric reel.
 *
 * The reel used to be a CSS transition: `transform 620ms` toward a target measured once per line
 * change. That target was always wrong, because the measurement is taken while the outgoing and
 * incoming lines are still animating their font size — the column is literally a different height
 * every frame for 420ms after each line change. So the reel glided toward a stale position, arrived
 * somewhere near it, and was yanked to a fresh stale position on the next line. Re-measuring on a
 * second rAF (which both surfaces did) only sampled the drift twice instead of once.
 *
 * This replaces the transition with a follow that re-measures every frame and closes the remaining
 * distance by a fixed fraction of it. Exponential smoothing rather than a spring with velocity: it
 * cannot overshoot, so a line change during a fast passage can never make the reel bounce, and it is
 * frame-rate independent — the same `tau` gives the same feel at 60Hz and at 144Hz.
 *
 * Deliberately free of store imports so the mini player can use it. The mini is a second webview and
 * pulling in a module that touches the audio engine would start a second audio element.
 */

/** Reads where the reel should be, in px of translateY, or null when there is nothing to follow. */
export type ReelMeasure = () => number | null;

/** The reel's own geometry, so a browse can be bounded and recovered from. */
export type ReelLimits = () => { travel: number; view: number };

/** Time to cover ~63% of the remaining distance. 105ms is about 6 frames: quick enough that the
 *  reel is never visibly behind the words, slow enough that a line change reads as one move. */
const TAU = 105;

/** Below this the follow is done. Sub-pixel, so snapping is invisible. */
const SNAP = 0.35;

/** Frames the target has to hold still before the loop parks itself. */
const CALM = 3;

/** Frames the loop will wait for something to measure before giving up. Untimed lyrics have no sung
 *  line to follow at all, and a loop that spun forever would measure the DOM at 60Hz for the length
 *  of the song to no purpose. */
const IDLE = 8;

/**
 * How long a manual scroll keeps the column where the reader left it before the playhead takes over.
 *
 * The reader asked to be somewhere; yanking them back mid-look is worse than a reel that waits. Four
 * seconds is long enough to read the line you stopped on and short enough that coming back feels like
 * the app remembering you rather than fighting you.
 */
const RESUME_MS = 4000;

/**
 * How far the sung line may drift from dead centre before the reel moves to bring it back, as a
 * fraction of the viewport's height.
 *
 * The original reasoning still holds: centring on every line means the column is never at rest, it
 * creeps a few pixels every few seconds, so a band beats a hard lock, and the Schmitt trigger below
 * is what stops a move cancelling itself halfway.
 *
 * But 0.3 was far too generous to read as "centred". Measured on the 927px fullscreen column, the
 * sung line sat 119px below centre and the reel never moved — and because a line change inside the
 * band produces no motion at all, the owner's experience of that was not "it holds still", it was
 * "the auto-scroll is broken". 0.06 is ~55px, roughly one line of slack: close enough that the active
 * line is unmistakably the middle line, wide enough that a short passage does not jitter.
 */
export const HOLD_BAND = 0.06;

function stillnessPreferred(): boolean {
  return (
    document.documentElement.hasAttribute("data-low-power") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function createReelFollow(
  measure: ReelMeasure,
  apply: (y: number) => void,
  limits?: ReelLimits,
) {
  let y = 0;
  let target = 0;
  let prevTarget = 0;
  let raf = 0;
  let last = 0;
  let calm = 0;
  let idle = 0;
  let placed = false;

  /*
     Manual browsing.

     Both lyric surfaces are `overflow: hidden` on purpose — the mask fade at the top and bottom of the
     column, and the pinned active line, both depend on the reel being the only thing that moves. That
     also means there is no native scroller, so a wheel event had nothing to act on at all and the
     column could not be read past the line currently being sung.

     `pinned` is the absolute translateY the reader is holding. While it is non-null the playhead is
     ignored entirely, because a column that drifts while you are reading it is worse than one that
     cannot be moved.

     Control comes back on its own once the sung line re-enters the window: `wasOutside` records that
     the reader had scrolled it off screen, and the frame that brings it back hands over. Without that
     latch a 50px nudge would be snapped straight back to centre, which makes the wheel useless; with
     it, browsing ends exactly where it should — at the line you are hearing. `jump()` drops it for a
     seek or a new track.
  */
  let pinned: number | null = null;
  let wasOutside = false;

  /*
     The guarantee the latch could not make.

     `wasOutside` only ever becomes true once the sung line has been pushed more than half a viewport
     away from where the reader parked the column. A modest scroll never trips it, so the release
     branch below could not fire, and the column stayed pinned for the rest of the song with no way
     back except a seek or a new track. That is the bug: scroll a little, and the reel silently
     stops following forever.

     So the timer is the actual contract — browsing always ends — and the `wasOutside` path below is
     kept only as the early lane: if the line drifts back into view sooner, there is no reason to make
     the reader wait out the clock.

     A real timer rather than a frame count, because a pinned reel is at its target, which lets the
     loop park itself after CALM frames — and a parked loop would never notice the clock expiring.
  */
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;

  function clearResume() {
    if (resumeTimer !== undefined) {
      clearTimeout(resumeTimer);
      resumeTimer = undefined;
    }
  }

  function resume() {
    clearResume();
    if (pinned === null) return;
    pinned = null;
    wasOutside = false;
    kick();
  }

  /*
     Once a move has been triggered it has to finish. Re-testing the band every frame would let the
     glide cancel itself: as the reel approaches the line the drift falls back inside the band, the hold
     re-asserts, and the move stalls halfway — measured, not theorised, stopping at -528 of a -640
     target. So the band is a Schmitt trigger: it releases at > band and re-arms only on arrival.
  */
  let committing = false;

  const bounds = () => limits?.() ?? { travel: Infinity, view: 0 };

  function frame(now: number) {
    // Clamped so a backgrounded window returning after seconds does not teleport the reel.
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;

    const next = measure();

    if (pinned !== null) {
      const { view } = bounds();
      if (next !== null && view > 0) {
        if (Math.abs(pinned - next) > view / 2) wasOutside = true;
        else if (wasOutside) {
          // The early lane: the line came back on its own, so don't make the reader wait for the clock.
          clearResume();
          pinned = null;
          wasOutside = false;
        }
      }
    }

    if (pinned === null && next === null) {
      // Nothing to follow yet — untimed lyrics, or the column has not been built. Wait a few frames
      // in case the lines land next tick, then park; see IDLE.
      if (++idle > IDLE) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }
    idle = 0;
    prevTarget = target;
    target = pinned !== null ? (pinned as number) : (next as number);

    /*
       The hold. `measure()` returns the translateY that would put the sung line dead centre, so the
       line's distance from the centre right now is exactly `y - target`. While that is inside the band
       the reel stays where it is, and `target = y` also lets the loop park itself instead of
       re-measuring a column that is not going anywhere.

       Skipped before `placed`, because a new song or a seek is not drift — `jump()` has to land on the
       line even when the line was already readable.
    */
    if (pinned === null && placed && next !== null) {
      const { view } = bounds();
      const drift = Math.abs(y - (next as number));
      if (committing) {
        // Land the move rather than stopping a third of a pixel short and letting the hold re-assert
        // at the boundary, which is where a completed glide used to park.
        if (drift <= SNAP) {
          y = next as number;
          committing = false;
        }
      } else if (view > 0 && drift <= view * HOLD_BAND) {
        target = y;
      } else {
        committing = true;
      }
    }

    if (!placed) {
      placed = true;
      y = target;
      prevTarget = target;
    } else if (stillnessPreferred()) {
      y = target;
    } else {
      y += (target - y) * (1 - Math.exp(-dt / TAU));
    }

    // Park only once the reel has arrived *and* the layout under it has stopped moving, otherwise the
    // loop quits mid font-size transition and the last few pixels are left uncorrected.
    const done =
      Math.abs(target - y) <= SNAP && Math.abs(target - prevTarget) <= 0.05;
    apply(y);

    if (done && ++calm >= CALM) {
      y = target;
      apply(y);
      raf = 0;
      return;
    }
    if (!done) calm = 0;
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (raf) return;
    last = 0;
    calm = 0;
    idle = 0;
    raf = requestAnimationFrame(frame);
  }

  return {
    /** Follow the current target. Cheap to call repeatedly; a no-op while already running. */
    poke() {
      kick();
    },

    /**
     * Land on the target with no travel, on the first frame the column can be measured.
     *
     * For a new song, where gliding the length of the reel reads as the lyrics scrolling rather than
     * as the track starting. It arms rather than applying straight away: at the moment a track
     * changes, the DOM still holds the previous song's lines, and measuring them would only land the
     * reel where it already is. The arm survives until a frame finds something real to measure, so
     * the new column is placed rather than travelled to whenever it finally arrives.
     */
    jump() {
      placed = false;
      clearResume();
      pinned = null;
      wasOutside = false;
      committing = false;
      kick();
    },

    scroll,
    onWheel,

    destroy() {
      clearResume();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };

  /**
   * Move the column by `dy` px, in the reel's own sign convention: positive reads back toward the top
   * of the song.
   *
   * Applied on the spot rather than eased. The smoothing in `frame` exists to hide the playhead
   * re-measuring a column that is still changing height; putting the reader's wheel through the same
   * filter makes the text feel rubbery, and a direct-manipulation gesture that lags behind the finger
   * reads as broken even when it is working.
   *
   * A plain function rather than a method, because both surfaces hand `onWheel` to Svelte as a bare
   * value and `this` would be gone by the time it ran.
   */
  function scroll(dy: number) {
    if (!Number.isFinite(dy) || dy === 0) return;
    const { travel, view } = bounds();
    const from = pinned !== null ? pinned : y;
    pinned = Math.max(-travel, Math.min(0, from + dy));
    wasOutside = view > 0 && Math.abs(pinned - target) > view / 2;
    y = pinned;
    apply(y);
    // Every scroll restarts the clock, so a reader who keeps scrolling is never pulled away mid-gesture.
    clearResume();
    resumeTimer = setTimeout(resume, RESUME_MS);
    kick();
  }

  /**
   * One place to normalise a wheel event. These surfaces are separate implementations and shared fixes
   * do not propagate between them — the parity rule exists because of exactly that — so the arithmetic
   * lives here rather than twice.
   *
   * `deltaMode` says what the units are: a mouse sends pixels, a trackpad often sends lines, and a
   * legacy device sends pages. Reading `deltaY` alone gives every device a different speed.
   */
  function onWheel(e: WheelEvent) {
    const { view } = bounds();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view : 1;
    const dy = e.deltaY * unit;
    if (!dy) return;
    e.preventDefault();
    // A wheel down moves the content up, which in the reel's convention is toward the next line.
    scroll(-dy);
  }
}
