/**
 * User settings, persisted and applied live.
 *
 * One flat object in `localStorage`, mirrored onto CSS custom properties so a change repaints the
 * whole app without any component having to subscribe. The blur/glass values exist because the
 * intensity that looks right on a desktop GPU is not the intensity that holds frame rate on a weak
 * one, and the owner's own answer to that tension was "let the user choose".
 *
 * Deliberately not `tauri-plugin-store`: everything here is read only by the webview, and the same
 * seam that covers favourites can move later without touching callers.
 */

const KEY = "noctra.settings";

export type RepeatMode = "off" | "all" | "one" | "times";

/** The three the R key cycles through; `times` is picked from a menu because it needs a number. */
export const REPEAT_CYCLE: RepeatMode[] = ["off", "all", "one"];

/** What opening the app does: re-arm the track you left on, or start somewhere new. */
export type LaunchAction = "resume" | "shuffle";

export type Settings = {
  /** Extra darkness over the backdrop, added to the automatic per-cover veil. 0..0.4. */
  backdropDim: number;
  /**
   * Corner rounding as a percentage of the shipped design, applied to every radius token at once.
   *
   * A scale rather than one absolute number because the three radii are deliberately different —
   * artwork, cards and the floating rail each sit at a different depth, and a single shared value
   * would flatten that. Scaling keeps their relationship and still lets you go to sharp corners.
   */
  cornerScale: number;
  /** Stops the background drift and the entrance animations. */
  lowPower: boolean;
  /** Nudges lyric timing, in milliseconds. Line sync is the feature most sensitive to drift. */
  lyricsOffset: number;
  /** Replace Indic lyric lines with a Latin-alphabet reading. See services/lyrics/romanize.ts. */
  romanise: boolean;
  /** Base lyric font size as a percentage of the default. Tuned while reading, not in a manual. */
  lyricsScale: number;
  /** How soft the non-singing lines go, in px of blur at their maximum. */
  lyricsBlur: number;
  /** How far the non-singing lines fade. Kept separate from blur so either can be dialled alone. */
  lyricsDim: number;
  /** Re-scan the music folders on focus and periodically to pick up new files. */
  autoScan: boolean;
  shuffle: boolean;
  /**
   * "Play similar" as a standing mode rather than a one-shot.
   *
   * Off, a shuffle draws from the whole library. On, each advance is picked from the tracks related to
   * the one actually playing, so the run keeps going without ever leaving the seed's neighbourhood.
   */
  similar: boolean;
  /**
   * Start the next track on a second, already-decoded audio element so there is no gap at the
   * boundary.
   *
   * Honest labelling matters here: this is *seamless*, not *sample-accurate*. A timer-driven handoff
   * between two HTML5 elements leaves a few milliseconds either way, and joining to the sample would
   * need decode-to-buffer — a different engine entirely.
   */
  gapless: boolean;
  /**
   * Seconds of overlap between the outgoing and incoming track. 0 = a butt joint (gapless with no
   * fade); the two settings solve different problems, which is why they are separate controls.
   */
  crossfadeSec: number;
  repeat: RepeatMode;
  /** Plays per track in "times" mode. */
  repeatTimes: number;
  volume: number;
  muted: boolean;
  /**
   * The track that was armed when the app last closed, so the next session reopens on it.
   *
   * Stored as an id rather than a path because the id is what the library is keyed on, so a track that
   * has been moved, renamed or removed simply fails the lookup at startup instead of loading a stale
   * file. Empty until something has actually been played.
   */
  lastTrackId: string;
  /**
   * Where that track was, in seconds. Written at two-second granularity — see the throttle in
   * App.svelte, because `position` updates about fifteen times a second and every `set` here
   * re-serialises and re-writes the whole settings object.
   */
  lastPosition: number;
  /**
   * Which startup behaviour the owner gets.
   *
   * `"resume"` re-arms `lastTrackId` at `lastPosition`. `"shuffle"` picks a random track and excludes
   * the one it would otherwise have resumed, so choosing shuffle never produces the same song and
   * looks like a resume that failed.
   */
  onLaunch: LaunchAction;
};

export const DEFAULTS: Settings = {
  // Not zero on purpose. The per-cover veil is computed from measured luminance, and the covers it
  // has to protect against are the bright ones; a dark cover is already behind dark text, so the
  // standing floor costs nothing where it is not needed and guarantees legibility everywhere else.
  backdropDim: 0.12,
  cornerScale: 100,
  lowPower: false,
  lyricsOffset: 0,
  romanise: true,
  lyricsScale: 100,
  lyricsBlur: 4.5,
  lyricsDim: 42,
  autoScan: true,
  shuffle: false,
  similar: false,
  // On by default: a gap between album tracks is the thing people notice, and the standby element is
  // only ever given a src inside the lead window, so the idle cost is one paused media element.
  gapless: true,
  // Off by default: overlapping two songs is a taste choice, and 0 still yields the seamless joint.
  crossfadeSec: 0,
  repeat: "off",
  repeatTimes: 3,
  volume: 0.8,
  muted: false,
  lastTrackId: "",
  lastPosition: 0,
  /*
     Shuffle is the default, and it overrode a design-fidelity argument.

     Resume used to be the default because that is what Spotify and Noctis both do on launch. The owner
     has now complained about it more than once — re-opening the app onto the same song every time reads
     as the app having been left on, not as a remembered position — so the reference match loses to the
     thing they actually asked for. Anyone restoring the reference behaviour should change this back
     rather than special-casing it at the call site in App.svelte.
  */
  onLaunch: "shuffle",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The shipped radii, in px, which `cornerScale` multiplies.
 *
 * Kept here rather than read out of the stylesheet because the stylesheet is the fallback when the
 * setting is untouched, and a slider that derives its own baseline from computed CSS would silently
 * drift if anyone ever edits `app.css`.
 */
const RADIUS_BASE = { art: 14, panel: 18, float: 28 };

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return sanitize({ ...DEFAULTS, ...parsed });
  } catch {
    // A corrupt settings file must not stop the app launching.
    return { ...DEFAULTS };
  }
}

/** Guards against a hand-edited or half-written file putting the UI into an unusable state. */
function sanitize(s: Settings): Settings {
  return {
    ...s,

    backdropDim: clamp(Number(s.backdropDim) || 0, 0, 0.4),
    // Zero is a real choice here (sharp corners), so this cannot use the `|| default` shorthand.
    cornerScale: clamp(Number.isFinite(s.cornerScale) ? s.cornerScale : 100, 0, 200),
    lyricsOffset: clamp(Number(s.lyricsOffset) || 0, -10000, 10000),
    lyricsScale: clamp(Number(s.lyricsScale) || 100, 70, 150),
    lyricsBlur: clamp(Number.isFinite(s.lyricsBlur) ? s.lyricsBlur : 4.5, 0, 10),
    lyricsDim: clamp(Number.isFinite(s.lyricsDim) ? s.lyricsDim : 42, 0, 80),
    volume: clamp(Number.isFinite(s.volume) ? s.volume : 0.8, 0, 1),
    gapless: typeof s.gapless === "boolean" ? s.gapless : DEFAULTS.gapless,
    // Zero is a real choice (a butt joint rather than a fade), so this cannot use the `|| default`
    // shorthand. Crossfade is a taste axis with no contrast cliff, which is why it survives where the
    // blur and dim sliders were deleted (D-061): every value in the range is plainly audible.
    crossfadeSec: clamp(Number.isFinite(s.crossfadeSec) ? s.crossfadeSec : 0, 0, 12),
    repeat: (["off", "all", "one", "times"] as const).includes(s.repeat) ? s.repeat : "off",
    repeatTimes: clamp(Math.round(Number(s.repeatTimes) || 3), 2, 20),
    lastTrackId: typeof s.lastTrackId === "string" ? s.lastTrackId : "",
    lastPosition: Math.max(0, Number(s.lastPosition) || 0),
    onLaunch: s.onLaunch === "resume" ? "resume" : "shuffle",
  };
}

class SettingsStore {
  value = $state<Settings>(load());

  /** Written back on every change; settings are small and infrequent enough to save eagerly. */
  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* Quota or a disabled store: the session still works. */
    }
  }

  set<K extends keyof Settings>(key: K, v: Settings[K]) {
    if (this.value[key] === v) return;
    this.value = { ...this.value, [key]: v };
    this.apply();
    this.persist();
  }

  reset() {
    this.value = { ...DEFAULTS };
    this.apply();
    this.persist();
  }

  /** Push the visual knobs onto the root element as custom properties. */
  apply() {
    const s = this.value;
    const style = document.documentElement.style;

    style.setProperty("--backdrop-dim", String(s.backdropDim));
    style.setProperty("--lyrics-scale", String(s.lyricsScale / 100));
    const f = s.cornerScale / 100;
    style.setProperty("--radius-art", `${(RADIUS_BASE.art * f).toFixed(1)}px`);
    style.setProperty("--radius-panel", `${(RADIUS_BASE.panel * f).toFixed(1)}px`);
    style.setProperty("--radius-float", `${(RADIUS_BASE.float * f).toFixed(1)}px`);
    document.documentElement.toggleAttribute("data-low-power", s.lowPower);
  }
}

export const settings = new SettingsStore();
