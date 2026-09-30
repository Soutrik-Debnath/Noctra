<script lang="ts">
  /**
   * Floating desktop mini-player — the root mounted in the second, frameless webview.
   *
   * The card, after docs/references/05: a rounded panel tinted with the cover's colour, small art and
   * title/artist across the top, and the lyrics scrolling below with the line being sung in white and
   * every other line dimming *and blurring* the further it is away. No controls until the pointer is
   * over the card, which is what keeps it looking like a lyric sheet rather than a media widget.
   *
   * It owns no playback state. The main window broadcasts `player-state` and `lyrics-state` and
   * this renders them; presses come back as `mini-command`. One audio element, in one place.
   *
   * Note on the glass: a transparent webview cannot `backdrop-filter` the desktop behind it — that
   * only blurs page content. The card is therefore a translucent tinted panel, not a real blur of the
   * wallpaper.
   */
  import { emit, listen } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LogicalSize } from "@tauri-apps/api/dpi";
  import Icon from "./components/Icon.svelte";
  import { paths } from "./components/icons";
  import VolumePill from "./components/VolumePill.svelte";
  import { getBlurredArtwork } from "./services/artwork/blur";
  import { settings } from "./stores/settings.svelte";
  import { activeWord, isInstrumental, lineDistance, type SyncLevel, type Word } from "./services/lyrics/lrc";
  import { createReelFollow } from "./services/lyrics/reelFollow";
  import { needsRomanisation, romanise } from "./services/lyrics/romanize";
  import { formatTime } from "./utils/format";

  type MiniState = {
    title: string;
    artist: string;
    album: string;
    artwork: string;
    position: number;
    duration: number;
    playing: boolean;
    accent: string;
    liked: boolean;
    volume: number;
    /** Optional so a card that loaded against an older snapshot still renders. */
    muted?: boolean;
    /**
     * Optional for the same reason, and absent reads as "not buffering" — the safe way to be wrong,
     * since it only ever shows the waiting dots a moment early rather than hiding them forever. The
     * card needs this because the waiting dots must not dance while the audio is stalled, and the
     * stall happens in the main window's media element, which this webview cannot see directly.
     */
    buffering?: boolean;
  };

  // 406x394 window minus the card's own 8px margin = a 390x378 card, which is the measured
  // reference box (aspect 1.032). The old 360x330 gave 344x314 at aspect 1.096 — smaller and
  // visibly squarer than the thing it is meant to copy.
  const CARD_SIZE: [number, number] = [406, 394];

  type LyricLine = { time: number; text: string; words?: Word[] | null };

  /** How long the main window may go silent before this card assumes the bridge has dropped. The
   *  healthy feed is one snapshot every 250ms, so this is eight missed pushes. */
  const FEED_STALE_MS = 2000;

  // Not named `state`: Svelte's TS store transform rewrites `$state` to `state`, which would make
  // this initializer reference itself.
  let track = $state<MiniState | null>(null);
  let lines = $state<LyricLine[]>([]);
  /**
   * Plain `let`, deliberately not `$state`. Only the watchdog below reads it and nothing renders it,
   * so making it reactive would dirty this component four times a second for no reason.
   */
  let lastHeardAt = 0;
  /**
   * What the main window's lookup actually got back. `"plain"` means no timestamps anywhere, which the
   * card has to know, or every line reads at `time: 0`, the last one wins the active slot, and static
   * words appear to be perfectly synced.
   */
  let level = $state<SyncLevel>("plain");
  const appWindow = getCurrentWindow();

  /** Runs on the first pass, before the window is ever shown, so it never opens at the wrong size. */
  $effect(() => {
    const [w, h] = CARD_SIZE;
    void appWindow.setSize(new LogicalSize(w, h)).catch(() => {});
  });

  $effect(() => {
    const un = listen<MiniState>("player-state", (e) => {
      track = e.payload;
      lastHeardAt = Date.now();
    });
    return () => void un.then((f) => f());
  });

  /** Ask for a full state push once the listeners exist, so the card never opens empty. */
  $effect(() => {
    void emit("mini-command", "sync");
  });

  /**
   * Watchdog for a card that has gone deaf.
   *
   * The one ask above is not enough. Every push out of the main window is gated on its `ui.miniOpen`
   * mirror, and that mirror is re-derived from OS truth only when the *main* window starts. So a Vite
   * full reload or a recreated main window shuts the gate while this card sits there with a healthy
   * window and healthy listeners on both sides, frozen on the last frame it received — which is BUG-087
   * presenting as a card stuck on "Connecting…". Re-asking is the only repair reachable from here, and
   * the main window's `sync` handler is already built to take it.
   *
   * There is deliberately no visibility check in front of the ask. Two were tried and both misreport
   * this window: the main side's `mini_visible` command returns false on any error, and
   * `appWindow.isVisible()` measured `false` while this card was the focused, on-screen window at
   * 406x394 — a transparent always-on-top webview is simply not something either query answers
   * honestly, which is also how the mirror went wrong in the first place. A guard built on one would
   * fail in exactly the direction that reintroduces the bug. The cost of asking from a hidden card is
   * one event every two seconds; the cost of not asking is a card that never recovers.
   */
  $effect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastHeardAt > FEED_STALE_MS) void emit("mini-command", "sync");
    }, FEED_STALE_MS);
    return () => clearInterval(id);
  });

  $effect(() => {
    const un = listen<{ lines: LyricLine[]; level: SyncLevel }>("lyrics-state", (e) => {
      lines = e.payload.lines;
      level = e.payload.level;
    });
    return () => void un.then((f) => f());
  });

  // The card has its own document, so the accent has to be published here too or the tint and the
  // progress fill fall back to the default token.
  $effect(() => {
    if (track) document.documentElement.style.setProperty("--accent-rgb", track.accent);
  });

  const timed = $derived(level === "word" || level === "line");
  /*
     Same timing source as the fullscreen view. The card used to read the raw position, so the
     "lyrics drift" nudge in Settings moved the fullscreen and left this frozen — the two surfaces
     disagreed about which line is being sung, on the same song, at the same moment.
  */
  const nowMs = $derived((track?.position ?? 0) * 1000 + settings.value.lyricsOffset);
  const index = $derived.by(() => {
    if (!timed) return -1;
    let best = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= nowMs) best = i;
      else break;
    }
    return best;
  });

  /**
   * Whether to show the waiting dots. Same rule as the fullscreen view's, and `playing` and
   * `!buffering` are load-bearing rather than decoration: this is a CSS animation, so it does not stop
   * when the audio does. Left ungated it danced through a pause and through the stall after a seek or a
   * track change, on a clock that was frozen.
   */
  const waiting = $derived(
    timed && lines.length > 0 && index < 0 && !!track?.playing && !track?.buffering,
  );

  const words = $derived(timed ? (lines[index]?.words ?? []) : []);
  const currentWord = $derived(activeWord(words, nowMs));

  /**
   * Depth of field. Copied line-for-line from the fullscreen view's `depth()` — same ramp, same
   * active-line glow, and it reads the same Blur, Dim and Size settings so the two surfaces cannot
   * drift out of step the way they kept doing while each one had its own numbers.
   */
  const lyrScale = $derived(settings.value.lyricsScale / 100);

  function depth(i: number) {
    // Static words have no line being sung, so nothing is pushed out of focus. The column just reads.
    if (level === "plain") {
      return { filter: "blur(0px)", alpha: 0.88, scale: 1, size: 20 * lyrScale };
    }
    // Before the first timestamp nothing is being sung, so the column rests: sharp, uniform, at the
    // inactive size and brightness, with no glow. Collapsing this onto line 0 made the card open on
    // every track with the first line rendered exactly like the line being sung — bigger, brighter and
    // glowing — for the whole length of the intro. See `lineDistance`.
    const d = lineDistance(index, i);
    if (d === null) {
      return { filter: "blur(0px)", alpha: 0.85, scale: 0.95, size: 19 * lyrScale };
    }
    if (d === 0) {
      return {
        filter:
          "blur(0px) drop-shadow(0 1px 2px rgba(0,0,0,0.8)) " +
          "drop-shadow(0 0 12px rgba(255,255,255,0.22)) drop-shadow(0 5px 20px rgba(0,0,0,0.55))",
        alpha: 1,
        scale: 1,
        size: 24 * lyrScale,
      };
    }
    const maxBlur = settings.value.lyricsBlur * CARD_BLUR_SCALE;
    const dimFloor = 1 - settings.value.lyricsDim / 100;
    return {
      filter: `blur(${(maxBlur * blurBand(d)).toFixed(2)}px)`,
      alpha: Math.max(dimFloor, 0.9 - d * 0.13),
      scale: Math.max(0.88, 0.96 - d * 0.025),
      // 19, not the 15.5 this used to hand back. The scale ramp below takes a far line down to 0.88
      // of its declared size, so 15.5 rendered at 13.6px against a 23px sung line — an effective
      // ratio of 0.59. The fullscreen runs 26 × 0.88 against 32, which is 0.72, and the whole point of
      // copying its `depth()` was that the two surfaces could not drift apart. At 19 the card lands
      // on the same ratio instead of merely claiming it.
      size: 19 * lyrScale,
    };
  }

  /**
   * Blur in three bands rather than a continuous ramp — the same rule as the fullscreen view's
   * `blurBand()`, kept here rather than shared because the two `depth()` functions differ in the
   * sizes they return and splitting one from the other would be more code than it saves.
   *
   * `blur()` is the expensive half of the depth of field: a line whose blur changes has to be
   * re-rastered. Everything past the second neighbour now sits at the cap, so an advancing line
   * re-rasters six layers instead of ten and the far field is left alone.
   */
  function blurBand(d: number) {
    return d === 1 ? 0.37 : d === 2 ? 0.55 : 1;
  }

  /**
   * Blur is in pixels and the card's type is small, so the shared setting over-defocuses here.
   *
   * `lyricsBlur` was tuned against the fullscreen reel, where a non-active line renders at 46px. The
   * card's non-active lines are 15.5px, so the same 4.5px of blur eats roughly three times as much of
   * the glyph — which is why the card read as muddy while the fullscreen read as depth of field.
   * Scaling by the two type sizes makes the *perceived* defocus match the surface it was designed on,
   * rather than making the number equal.
   */
  const CARD_BLUR_SCALE = 15.5 / 46;

  /** Same rule as the fullscreen: a reading line only appears under script the user cannot read. */
  const romaniseLine = $derived.by(() => {
    const on = settings.value.romanise;
    return (text: string) => (on && needsRomanisation(text) ? romanise(text) : "");
  });

  // The card only shows a few lines, so the active one has to be held at a fixed height rather than
  // scrolling out below the fold. The line is read from the rendered DOM rather than a parallel refs
  // array, which drifts out of sync with a keyed each block across track changes.
  let viewport: HTMLDivElement | undefined = $state();
  let reelY = $state(0);

  /**
   * How far the title overflows its box, in px. Zero means it fits and must not move.
   *
   * Measured rather than guessed at a character count: the card's title is 800-weight with negative
   * tracking, so "Woo Hoo" and "Anhedonia" are the same length in characters and nowhere near the same
   * length in pixels. A marquee on text that already fits reads as a bug, not as a feature.
   */
  let titleEl: HTMLSpanElement | undefined = $state();
  let titleOver = $state(0);
  /** The name's own layout width, which is what one carousel period is built from. */
  let titleText = $state(0);
  /** The clip window's own width. The ticker enters off its right edge, so the travel needs it. */
  let titleWin = $state(0);

  $effect(() => {
    void track?.title;
    // After layout, or the metrics report the previous title's box.
    queueMicrotask(() => {
      const el = titleEl;
      const tk = el?.querySelector<HTMLElement>(".pass");
      if (!el || !tk) {
        titleOver = 0;
        titleText = 0;
        titleWin = 0;
        return;
      }
      // Measured off the ticker's own layout width, never the window's `scrollWidth`. The window's
      // scroll width follows the child's *transform*, so while the name is travelling it reports
      // steadily less overflow — 324px down to 107px across one pass — and since that number feeds
      // the animation's own duration, the ticker retimed itself every frame. `offsetWidth` is layout,
      // so it ignores the transform entirely.
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      /*
         The name's own rect, not the window's `scrollWidth`. The window's scroll width follows the
         child's *transform*, so while the name is travelling it reports steadily less overflow — 324px
         down to 107px across one pass — and since that number feeds the animation's own duration, the
         ticker retimed itself every frame. `.pass` is inline rather than inline-block, because making it
         a block-level box would cost the resting ellipsis, which only renders for inline content; a
         range rect reports an inline element's layout width fine, and a translateX never changes one.
      */
      const textW = Math.round(tk.getBoundingClientRect().width);
      const over = textW - (el.clientWidth - pad);
      // The slack is added only once there is something to scroll. Measured the other way it made
      // every title "overflow" by exactly the padding, so short titles got the class, lost their
      // ellipsis, and ticked two pixels for no reason.
      titleText = textW;
      titleOver = over > 0 ? over + 2 : 0;
      titleWin = el.clientWidth;
    });
  });

  /**
   * Where the ticker starts, where it ends, and how long that takes.
   *
   * One period is the name plus the blank that follows it, and the animation runs exactly one period.
   * The second copy of the title sits one period behind the first, so the instant the loop restarts it
   * is occupying the pixels the first copy just vacated — the wrap is invisible. That is what makes it a
   * carousel rather than a slide: the name never jumps back to the left edge, it keeps arriving from the
   * right one, and the `gap` is the space you see between the end of a name and its own beginning again.
   *
   * Speed is fixed at 40px/s rather than a fixed duration, because a fixed duration makes a long name
   * crawl and a short one sprint. Clamped so neither an eight-character title nor a fourteen-word one
   * lands outside a sane loop.
   */
  const MARQUEE_PX_PER_S = 40;
  const marquee = $derived.by(() => {
    if (titleOver <= 0) return { gap: "0px", period: "0px", dur: "0s" };
    const gap = Math.max(48, Math.round(titleWin * 0.4));
    const period = titleText + gap;
    const secs = Math.min(28, Math.max(6, period / MARQUEE_PX_PER_S));
    return { gap: `${gap}px`, period: `${period}px`, dur: `${secs.toFixed(1)}s` };
  });

  /**
   * Whether the grown cover is showing.
   *
   * Driven by pointer handlers rather than `.card:has(.art:hover)` in CSS. That selector is correct —
   * `element.matches()` and `document.querySelector()` both return true while the pointer sits on the
   * thumbnail — but this webview never repaints for it, so the style engine and the selector engine
   * disagree and the cover simply never grows. Measured, not assumed: the exact compiled selector from
   * the CSSOM matched the element while `getComputedStyle` still reported `scale(0.17)`.
   *
   * Two flags, unioned, because the grown cover paints over the thumbnail: the moment it opens, the
   * pointer that summoned it is no longer over `.art`. A single "is the thumb hovered" test would
   * collapse the cover under the cursor the instant it appeared.
   */
  let artHot = $state(false);
  let coverHot = $state(false);
  const coverOpen = $derived(artHot || coverHot);

  /**
   * Clearance above and below the column, as a fraction of the viewport height. The same asymmetric
   * rule the fullscreen view uses — the argument for each figure is on its REEL_TOP / REEL_BOTTOM.
   *
   *   - TOP 0.20 — the first lines sit near the top of the card and *stay there*. The reel does not
   *     move at all until the sung line's own centre would pass the viewport's centre, which is
   *     several lines in. Half a viewport here, which is what it used to be, dragged line one to dead
   *     centre the moment the song started — the "first line in the middle" the owner screenshotted.
   *   - BOTTOM 0.22 — the last lines come to rest around 78% down, between the middle and the bottom
   *     edge. Zero would pin them flush to the edge, inside the mask's fade.
   */
  const REEL_TOP = 0.2;
  const REEL_BOTTOM = 0.22;
  let padHeight = -1;

  function measure(): number | null {
    const el = index >= 0 ? viewport?.querySelectorAll<HTMLElement>(".line")[index] : undefined;
    const reel = viewport?.querySelector<HTMLElement>(".reel");
    if (!viewport || !el || !reel) return null;
    const H = viewport.clientHeight;
    /*
       Written in px from the measured height, and only when that height changes. Percentage padding
       resolves against the *inline* axis, so `padding-block: 20%` would have been 20% of the card's
       width, and a style write every frame would dirty the whole reel.

       Set on the *viewport*, not on the reel, and that is load-bearing: the reel's style attribute is
       rewritten whole by the template every frame (`transform: translateY(…)`), which takes any
       custom property set on it with it. Both webviews were caught with `--reel-top` gone and the
       padding computing to 0px, so the clamp had silently stopped existing and the first line of the
       song was yanked to dead centre — the exact complaint this rule was written to answer. Custom
       properties inherit, so the reel still reads them from its parent.
    */
    if (H !== padHeight) {
      padHeight = H;
      viewport.style.setProperty("--reel-top", `${Math.round(H * REEL_TOP)}px`);
      viewport.style.setProperty("--reel-bottom", `${Math.round(H * REEL_BOTTOM)}px`);
    }
    // Measured against the reel's own box rather than `offsetTop`, whose origin is the nearest
    // *positioned* ancestor rather than the scroll viewport. Both rects carry the same translateY, so
    // subtracting them cancels the reel's own transform instead of feeding it back into its target.
    const topInReel = el.getBoundingClientRect().top - reel.getBoundingClientRect().top;
    const target = H / 2 - topInReel - el.offsetHeight / 2;
    const travel = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    return Math.max(-travel, Math.min(0, target));
  }

  const follow = createReelFollow(measure, (y) => (reelY = y), () => ({
    travel: viewport ? Math.max(0, viewport.scrollHeight - viewport.clientHeight) : 0,
    view: viewport?.clientHeight ?? 0,
  }));
  $effect(() => () => follow.destroy());

  // Every line change hands over to the follow rather than measuring once here. The column is still
  // changing height while the outgoing line shrinks and the incoming one grows, so a single
  // measurement — or two, which is what the extra rAF was for — samples that drift instead of riding
  // it, and the reel then glides to a position that is already wrong.
  //
  // A *new column* lands instead of travelling: gliding the length of the reel reads as the lyrics
  // scrolling rather than as the song starting. `pushLyrics` sends one event per lyric change and not
  // one per tick, so a fresh array identity means a new song, not another quarter-second.
  let seenLines: LyricLine[] | undefined;
  $effect(() => {
    void index;
    void settings.value.lyricsScale;
    const src = lines;
    if (src !== seenLines) {
      seenLines = src;
      follow.jump();
    } else {
      follow.poke();
    }
  });

  /*
     A ResizeObserver on the viewport, not a window `resize` listener — the card's lyric box is a flex
     row under the header, so its height changes when the header does (the art thumbnail and the title
     row only exist once a track arrives) and no window resize is involved. Same finding as the
     fullscreen view, where the reel was caught carrying padding for a height the viewport no longer
     had, so the clamp was working from stale geometry.
  */
  $effect(() => {
    const box = viewport;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      padHeight = -1;
      follow.poke();
    });
    ro.observe(box);
    return () => ro.disconnect();
  });

  /** Drag the frameless window from anywhere that isn't a control. */
  function drag(e: PointerEvent) {
    // The card's own seek stops propagation, so it never reaches here; buttons are excluded so a
    // press on a control does not shove the window across the desktop.
    if ((e.target as HTMLElement).closest("button")) return;
    void appWindow.startDragging();
  }

  function send(
    command:
      | "toggle"
      | "next"
      | "prev"
      | "close"
      | "show-fullscreen"
      | "show-library"
      | "show-settings",
  ) {
    void emit("mini-command", command);
  }

  /** One-shot pop on the card's heart. Mirrors the fullscreen view; see `heart-pop-lg` in app.css. */
  let favPop = $state(false);
  /** Matches the 1250ms fracture defined in app.css. */
  const BREAK_MS = 1250;
  let favBreak = $state(false);

  /**
   * The glyph drawn, held filled for the length of the break.
   *
   * The card's `track` is a snapshot arriving from the main window four times a second, so
   * `track.liked` flips at an unpredictable point partway through the animation. Reading it directly
   * would turn the heart into a hairline outline mid-fall, and what cracked apart would be a stroke
   * rather than the opaque heart.
   */
  const heartGlyph = $derived(favBreak || track?.liked ? "heart-filled" : "heart");
  /** The hit clip reads the glyph's own path, so the clickable heart cannot drift from the drawn one. */
  const heartPath = $derived(paths.heart[0]);

  function sendFav() {
    if (!track) return;
    if (!track.liked) {
      // Only on the way in — pulsing on un-like reads as a reward for removing it.
      favPop = true;
      setTimeout(() => (favPop = false), 540);
    } else {
      favBreak = true;
      setTimeout(() => (favBreak = false), BREAK_MS);
    }
    void emit("mini-command", "favorite");
  }

  /** Jump the song to a lyric line's timestamp, reported as a fraction like the scrubber does. */
  function seekTo(atMs: number) {
    const dur = (track?.duration ?? 0) * 1000;
    if (dur <= 0) return;
    void emit("mini-command", `seek:${Math.min(1, Math.max(0, atMs / dur)).toFixed(4)}`);
  }

  /*
     The cover's progress row. It was render-only — no pointer handler existed — so clicking or
     dragging it did nothing, and it also had to be kept out of the card's window drag. Same contract
     as the fullscreen seek row: follow the pointer while dragging, commit once on release.
  */
  let railEl = $state<HTMLSpanElement | null>(null);
  let railDrag = $state(false);
  let railPreview = $state<number | null>(null);

  function railFrac(e: MouseEvent) {
    const r = railEl?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  function onRailDown(e: PointerEvent) {
    if (!track || track.duration <= 0) return;
    railDrag = true;
    railPreview = railFrac(e);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic or already-released pointer; the up handler still lands the seek */
    }
    // Without this the press reaches the card's own pointerdown, which starts an OS window drag.
    e.preventDefault();
    e.stopPropagation();
  }

  function onRailMove(e: PointerEvent) {
    if (railDrag) railPreview = railFrac(e);
  }

  function onRailUp() {
    if (!railDrag) return;
    railDrag = false;
    if (railPreview !== null) void emit("mini-command", `seek:${railPreview.toFixed(4)}`);
    railPreview = null;
  }

  /** The rail is focusable, so it has to answer the keyboard the way the fullscreen bar does. */
  function onRailKey(e: KeyboardEvent) {
    if (!track || track.duration <= 0) return;
    const step = e.key === "PageUp" || e.key === "PageDown" ? 30 : 5;
    let to: number | null = null;
    if (e.key === "ArrowRight") to = Math.min(track.duration, track.position + step);
    else if (e.key === "ArrowLeft") to = Math.max(0, track.position - step);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = track.duration - 1;
    if (to === null) return;
    e.preventDefault();
    void emit("mini-command", `seek:${(to / track.duration).toFixed(4)}`);
  }

  /*
     The snapshot that carries volume arrives four times a second, so mirroring it unconditionally
     would yank the thumb back out from under the pointer mid-drag. Optimistic locally, reconciled
     once the drag has been idle long enough that the echo can only be the real value.
  */
  let vol = $state(0.8);
  let volTouched = 0;
  $effect(() => {
    if (!track || Date.now() - volTouched < 450) return;
    vol = track.volume;
  });

  function setVol(v: number) {
    volTouched = Date.now();
    vol = v;
    void emit("mini-command", `vol:${v.toFixed(3)}`);
  }

  /** Mute is a toggle resolved in the main window, which owns the audio element. */
  function sendMute() {
    void emit("mini-command", "mute");
  }

  /** The scrubber is a real control, so it reports a fraction rather than a pixel. */
  function sendSeek(e: PointerEvent, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const f = (e.clientX - r.left) / Math.max(1, r.width);
    void emit("mini-command", `seek:${Math.min(1, Math.max(0, f)).toFixed(4)}`);
  }

  /** Keyboard parity for the same control: arrows nudge by 2% of the track. */
  function nudgeSeek(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 0.02 : e.key === "ArrowLeft" ? -0.02 : 0;
    if (!step || !track || track.duration <= 0) return;
    e.preventDefault();
    const f = (track.position + step * track.duration) / track.duration;
    void emit("mini-command", `seek:${Math.min(1, Math.max(0, f)).toFixed(4)}`);
  }

  /**
   * The position the rail reports, in seconds.
   *
   * `railPreview` is a 0..1 fraction, because that is the unit every `seek:` command on this channel
   * carries. It has to be scaled back to seconds before it can be displayed. It wasn't: the fill was
   * computed as `fraction / duration`, so grabbing the bar collapsed it to ~0% and the elapsed label
   * read 0:00 for the whole drag — this is the "time slider appears broken and glitchy" report.
   */
  const shownPos = $derived(
    track ? (railPreview !== null ? railPreview * track.duration : track.position) : 0,
  );

  const played = $derived(
    track && track.duration > 0 ? Math.min(100, (shownPos / track.duration) * 100) : 0,
  );

  /**
   * The same pre-blurred artwork the fullscreen view uses, clipped to the card. Computed here rather
   * than shared from the main window because a transparent webview cannot `backdrop-filter` the
   * desktop, so the card needs its own opaque artwork layer to sit on.
   */
  let blurred = $state("");

  $effect(() => {
    const src = track?.artwork;
    if (!src) {
      blurred = "";
      return;
    }
    let stale = false;
    void getBlurredArtwork(src).then((b) => {
      if (!stale) blurred = b.url;
    });
    return () => {
      stale = true;
    };
  });
</script>

<div
  class="card"
  class:cover-open={coverOpen}
  role="group"
  aria-label="Noctra mini player"
  onpointerdown={drag}
  onpointerleave={() => {
    artHot = false;
    coverHot = false;
  }}
>
  {#if blurred}
    <img class="bg" src={blurred} alt="" draggable="false" />
  {/if}

  <div class="head">
    {#if track}
      <img
        class="art"
        src={track.artwork}
        alt=""
        draggable="false"
        onpointerenter={() => (artHot = true)}
        onpointerleave={() => (artHot = false)}
      />
      <div class="meta">
        <span
          class="title"
          class:scrolling={titleOver > 0}
          style="--period: {marquee.period}; --gap: {marquee.gap}; --mq-dur: {marquee.dur}"
          bind:this={titleEl}
        ><span class="ticker"
            ><span class="pass">{track.title}</span
            ><span class="loop" aria-hidden="true"
              ><span class="spacer"></span><span class="pass">{track.title}</span></span
            ></span
          ></span
        >
        <span class="artist">{track.artist}</span>
      </div>
    {:else}
      <div class="meta"><span class="artist">Connecting…</span></div>
    {/if}
  </div>

  <div class="lyrics" class:static={level === "plain"} bind:this={viewport} aria-live="polite" onwheel={follow.onWheel}>
    <div class="reel" style="transform: translateY({reelY}px);">
      <!--
        Three dots while the track plays and no line has started. Same instrument as the fullscreen
        view's, scaled to this surface's type. Absolutely positioned so it cannot shift the reel the
        follow is measuring every frame.
      -->
      <div
        class="waiting"
        class:shown={waiting}
        aria-hidden="true"
      >
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
      {#if lines.length === 0}
        <span class="blank">No lyrics for this track</span>
      {:else}
        {#each lines as line, i (i)}
          {@const d = depth(i)}
          {@const inst = isInstrumental(line.text)}
          {@const rom = romaniseLine(line.text)}
          <!--
            A button, not a <p>: clicking a line jumps to it, which is what the fullscreen view does
            and what every lyric surface a person has ever used does. It was a static paragraph here,
            so the words looked tappable and were not.
          -->
          <button
            class="line"
            class:active={i === index}
            class:inst={inst}
            style="opacity: {d.alpha}; filter: {d.filter}; transform: scale({d.scale}); font-size: {d.size}px;"
            title={inst ? "Play from this break" : "Play from here"}
            aria-label={inst ? "Instrumental break" : undefined}
            onclick={() => seekTo(line.time)}
          >
            <!-- An instrumental break arrives from the source as a lone `♪`; see the fullscreen view. -->
            {#if inst}
              <span class="dots" aria-hidden="true">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </span>
            {:else if rom}
              {rom}
            {:else if i === index && words.length > 0}
              {#each words as w, wi (wi)}
                <span class="word" class:lit={wi <= currentWord}>{w.text}</span>
              {/each}
            {:else}
              {line.text}
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  </div>

  {#if track}
    <!--
      Hover replaces the whole card with the artwork itself, carrying the controls the same way the
      fullscreen view does: favourite in the middle, transport along the bottom, volume down the
      right edge. The previous design shrank the same idea into a 46px thumbnail with 13px glyphs
      inside it, which is why it read as broken rather than as a smaller version of the real thing.

      There is deliberately no play/pause left in the card body. The expanded artwork already owns
      one, and two transport controls in a 344px card is just clutter.
    -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!--
      Suppressed rather than given a fake role: these handlers only track whether the pointer is inside
      the overlay so the grown cover stays open after it has swallowed the thumbnail. They change no
      semantics and expose no action — the controls that do have actions are the buttons inside, each
      already labelled. `role="group"` would put a second unnamed group around them for no reason.
    -->
    <div
      class="cover"
      onpointerenter={() => (coverHot = true)}
      onpointerleave={() => {
        // Leaving the cover closes it and disarms the thumbnail too, so the only way back in is to
        // cross the thumbnail again. Without the `artHot` reset, hovering the thumb once would leave
        // the cover one pointer-move away from reopening over the lyric sheet.
        coverHot = false;
        artHot = false;
      }}
    >
      <img class="cover-art" src={track.artwork} alt="" draggable="false" />

      <!--
        The fullscreen surface has carried this row on the sleeve the whole time and the card had only
        a close button, so the two looked like different products. Same affordances, same order.
      -->
      <div class="cover-orbs">
        <button aria-label="Open fullscreen" title="Open fullscreen" onclick={() => send("show-fullscreen")}>
          <Icon name="expand" size={14} />
        </button>
        <button aria-label="Library" title="Library" onclick={() => send("show-library")}>
          <Icon name="library" size={14} />
        </button>
        <button class="cover-x" aria-label="Close" title="Close" onclick={() => send("close")}>
          <Icon name="close" size={13} />
        </button>
      </div>

      <svg class="clip-src" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="heart-hit" clipPathUnits="objectBoundingBox">
            <path transform="translate(0.06 0.06) scale(0.0366667)" d={heartPath} />
          </clipPath>
        </defs>
      </svg>
      <button
        class="cover-heart"
        class:heart-lit={track.liked}
        class:heart-breaking={favBreak}
        class:heart-pop-lg={favPop}
        aria-label={track.liked ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={track.liked}
        title={track.liked ? "Remove from favorites" : "Add to favorites"}
        onclick={sendFav}
      >
        <span class="hit" aria-hidden="true"></span>
        <span class="heart-half left"><Icon name={heartGlyph} /></span>
        <span class="heart-half right"><Icon name={heartGlyph} /></span>
      </button>

      <div class="cover-trans cluster">
        <button aria-label="Previous" title="Previous" onclick={() => send("prev")}>
          <Icon name="skipBack" size={22} />
        </button>
        <button
          class="pp"
          aria-label={track.playing ? "Pause" : "Play"}
          title={track.playing ? "Pause" : "Play"}
          onclick={() => send("toggle")}
        >
          <Icon name={track.playing ? "pause" : "play"} size={31} />
        </button>
        <button aria-label="Next" title="Next" onclick={() => send("next")}>
          <Icon name="skipForward" size={22} />
        </button>
      </div>

      <div class="cover-prog">
        <span class="t">{formatTime(shownPos)}</span>
        <span
          class="rail"
          class:dragging={railDrag}
          bind:this={railEl}
          role="slider"
          tabindex="0"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(track.duration)}
          aria-valuenow={Math.round(shownPos)}
          aria-valuetext="{formatTime(shownPos)} of {formatTime(track.duration)}"
          onpointerdown={onRailDown}
          onpointermove={onRailMove}
          onpointerup={onRailUp}
          onpointercancel={onRailUp}
          onlostpointercapture={onRailUp}
          onkeydown={onRailKey}
          oncontextmenu={(e) => e.preventDefault()}
        >
          <span class="fill" style="width: {played}%"></span>
          <span class="head" style="left: {played}%"></span>
        </span>
        <span class="t">{formatTime(track.duration)}</span>
      </div>

      <div class="cover-vol">
        <VolumePill
          width={26}
          height={132}
          value={vol}
          muted={!!track.muted}
          oninput={(v) => setVol(v)}
          onmute={sendMute}
        />
      </div>
    </div>
  {/if}
</div>


<style>
  :global(html),
  :global(body) {
    background: transparent !important;
  }

  .card {
    position: relative;
    margin: 8px;
    height: calc(100% - 16px);
    border-radius: 20px;
    padding: 16px 18px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
    cursor: grab;
    /* The cover, blurred, with the accent washed over it and a dark diagonal base underneath so
       white lyric text stays legible whatever the artwork happens to be. Same source as the
       fullscreen backdrop, which is the point: the card reads as a window onto the same scene.

       The veil sits over the artwork rather than the artwork over the veil, because `.bg` is at
       `z-index: -1` and paints behind this background — so every point of alpha here multiplies
       straight into the cover's colour. It used to run 0.55 to 0.78 dark, which is what made the card
       look muddy next to the fullscreen view: the same bitmap, smothered.

       The ramp is shallow on purpose and it is the ONLY layer doing the vertical shading. An earlier
       attempt to protect the header added a separate `to bottom` scrim over the top 26% of the card.
       It worked on the numbers and ruined the surface: a wide flat band with a visible horizontal edge
       where it stopped, which is the "rectangular black-ish tint on the song name" the owner reported.
       A gradient that ends inside a large smooth field reads as a plate, and a plate behind the header
       is the same mistake as a plate behind a Settings row. The header is protected by the top stop of
       this continuous ramp instead, plus a text shadow tight enough not to pool. */
    background:
      radial-gradient(130% 105% at 10% -5%, rgb(var(--accent-rgb) / 0.5) 0%, transparent 72%),
      linear-gradient(160deg, rgba(24, 19, 29, 0.52) 0%, rgba(8, 7, 11, 0.62) 72%);
    border: 1px solid rgba(255, 255, 255, 0.14);
    /* No outer drop shadow, deliberately. The card sits 8px inside a transparent window, and the old
       `0 20px 50px -14px` reaches ~36px — so the webview sliced it at 8px and the cut read as a hard
       rectangular seam around the card. That seam is the "transparent line beside the miniplayer"
       reported three times. The measured reference fades to the wallpaper within ~8px, so a hairline
       rim and the inset highlight are all the separation it actually uses. */
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
    transition: background 500ms var(--ease-out);
  }

  /* The blurred cover, clipped to the card by its own overflow: hidden.

     Three filters, and the blur is the one that matters most. The backdrop bitmap is a 180px tile, but
     the card is ~360px wide, so it is being scaled up — and at that size the cover's own structure
     (window frames, lettering, a car door) is still legible behind the lyrics. A busy background does
     not read as colourful, it reads as muddy, because the eye cannot settle on a single hue; smoothing
     it into a wash is what lets the chroma from the blur pass actually land. `saturate` and a small
     `contrast` lift sit on top of that, tuned for a card viewed at arm's length against a wallpaper that
     competes with it — the fullscreen window is large enough to carry the raw tile.

     The 40px bleed on every side is what makes the blur possible: it has to exceed the radius, or the
     faded edge of the image shows up as a halo inside the card's rounded corner. */
  .bg {
    position: absolute;
    inset: -40px;
    width: calc(100% + 80px);
    height: calc(100% + 80px);
    object-fit: cover;
    z-index: -1;
    opacity: 1;
    filter: blur(18px) saturate(1.34) contrast(1.05);
    transition: opacity 600ms var(--ease-out);
    pointer-events: none;
  }


  .art {
    width: 46px;
    height: 46px;
    border-radius: 6px;
    object-fit: cover;
    display: block;
    box-shadow:
      0 4px 12px -4px rgba(0, 0, 0, 0.7),
      inset 0 0 0 1px rgba(255, 255, 255, 0.16);
    transition: transform 320ms var(--ease-spring);
    transform-origin: left center;
  }








  .head {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  /* Painted above the title so the ticker disappears under the cover's edge rather than popping in and
     out at a hard seam in mid-air. Without this the clip boundary sits 12px clear of the artwork, which
     reads as the text being cut, not as the text passing behind something. */
  .art {
    position: relative;
    z-index: 2;
  }

  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
    flex: 1;
  }

  /* `body` carries a global `text-shadow` whose second stop is an 18px black bloom at 32% alpha. On the
     main window that is what keeps a label readable when it sits directly on bright artwork. Here the
     veil already does that job, and 18px of pooled black around a 12px artist line is not a legibility
     aid — it is a soft rectangle the same shape as the words, which is the other half of the "black-ish
     tint on the song name and the artist name". Keep a one-pixel edge for definition; drop the cloud. */
  .title,
  .artist {
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }

  /* The card floats over the desktop at arm's length, so it is not reading the same scale as the
     app window — at --fs-md the title looked like a caption pasted onto a widget. Heaviest weight
     the bundled variable face carries, and negative tracking to stop 800 at this size going soft
     and wide. */
  .title {
    font-size: var(--fs-xl);
    font-weight: 800;
    letter-spacing: -0.4px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* The clip window reaches 14px to the left, underneath the cover's right edge, and the padding puts
       the text back exactly where it was. So the ticker travels into the space behind the artwork and
       is hidden by it — which is the "going behind the album art" look — instead of being sliced at a
       visible vertical line twelve pixels short of the cover. The overflow measurement needs no
       correction: `scrollWidth - clientWidth` already accounts for the padding, since the usable window
       is `clientWidth - padding`. */
    margin-left: -14px;
    padding-left: 14px;
  }

  /* At rest the ellipsis is the only thing that says "there is more", so it stays. While the name is
     actually travelling the movement says it, and an ellipsis parked over the middle of the text being
     read is just noise. */
  .title.scrolling:hover {
    text-overflow: clip;
  }

  /*
     The ticker.

     Two elements on purpose. `overflow: hidden` and `transform` cannot live on the same box: a
     clipping container that moves itself clips nothing, so the entire title slid left across the
     artwork and read as text lying on top of the cover. The outer `.title` is the window and this
     inner span is the thing that travels, so the name now passes behind the album art the way it
     should and never escapes the box to overlap it.

     It runs on hover and only on hover. Running whenever the name did not fit was the earlier call,
     on the grounds that a ticker you have to go looking for is hiding the truncation — but on a card
     that stays on the desktop for a whole session, the same name re-reading itself forever is not
     information, it is movement in the corner of your eye. At rest the name shows from its first
     letter with an honest ellipsis; pointing at it is asking what the rest says.

     A carousel, not a slide. The name is laid out twice, one period apart, and the animation runs
     exactly one period — the name's width plus `--gap` of blank. So when the loop restarts, the second
     copy is standing in the pixels the first one just vacated and there is nothing to see: the tail of
     a name leaves the left edge, the gap passes, and its own head arrives from the right edge. The
     previous version translated the single copy all the way off and then jumped it back, which made the
     name reappear by teleporting onto the left edge — the thing that still read as broken.

     `linear`, not `ease-in-out`: easing made the middle of the pass about half again faster than the
     average, so the part you were actually trying to read was the part that moved quickest.
  */
  .title.scrolling .ticker {
    display: inline-block;
    white-space: nowrap;
  }

  /* The duplicate only exists while the name is travelling. Parked off the right edge at rest it would
     turn the honest "Title…" into "Title  Title…", so it is not laid out until the hover that starts
     the loop — which is the same moment the animation begins, so the two cannot disagree. */
  .loop {
    display: none;
  }

  .title.scrolling:hover .loop {
    display: inline;
  }

  .spacer {
    display: inline-block;
    width: var(--gap, 48px);
  }

  .title.scrolling:hover .ticker {
    animation: title-marquee var(--mq-dur, 14s) linear infinite;
  }

  @keyframes title-marquee {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(calc(-1 * var(--period, 0px)));
    }
  }

  /* Low power stops the movement, so the name goes back to an honest ellipsis. It used to set
     `overflow: visible` here, which let the full title spill across the artwork permanently. The
     `:hover` half matters now that the clip is hover-gated: without it a hovered title in low power
     would lose its ellipsis and gain no movement, so the end of the name would simply vanish. */
  :global(html[data-low-power]) .title.scrolling,
  :global(html[data-low-power]) .title.scrolling:hover {
    text-overflow: ellipsis;
  }

  :global(html[data-low-power]) .title.scrolling:hover .ticker {
    animation: none;
  }

  .artist {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: -0.1px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The lyric area is a viewport; the reel inside it slides so the active line stays pinned at a
     fixed height instead of scrolling out below the fold. */
  .lyrics {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    /* Symmetric. It used to fade out from 78%, so the middle of the clear band sat at 43% of the box
       while the active line was pinned at 30% — two different "centres", neither of them the middle,
       which is a large part of why the line never seemed to sit where it should. */
    mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  }

  /* With no timing to follow, the reel cannot centre on a line that does not exist — so the column
     scrolls instead, and the words stay readable rather than frozen at whatever the first screen fits. */
  .lyrics.static {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .word {
    display: inline-block;
    /* The trailing space of a word is trimmed at the edge of an inline-block box, so the gap has to be
       a margin. Same reason as in the fullscreen view — see BUG-019. */
    margin-right: 0.22em;
    opacity: 0.4;
    transition:
      opacity 180ms linear,
      text-shadow 240ms var(--ease-out);
  }

  .word:last-child {
    margin-right: 0;
  }

  .word.lit {
    opacity: 1;
  }

  .reel {
    position: relative;
    display: flex;
    flex-direction: column;
    /* Clearance at each end, written in px by measure() from the real height of this box — the rule it
       implements is documented on REEL_TOP / REEL_BOTTOM above. Defaults to nothing so the untimed
       scroll mode starts at the top like a normal column of text. */
    padding-block: var(--reel-top, 0px) var(--reel-bottom, 0px);
    /* Looser than it was. At 7px the column filled the panel edge to edge and read as a wall of
       text; the reference keeps real air between lines, which is most of why it looks calm. */
    gap: 11px;
    /* No transition on transform, on purpose. The reel is positioned every frame by the follow in
       services/lyrics/reelFollow.ts. A transition here would ease toward each frame's value in turn,
       which is how the card came to trail the words by most of a second. */
    will-change: transform;
  }

  /*
     The waiting indicator. Same instrument as the fullscreen view's, same wave timing, and the same
     measured geometry — scripts/measure-dots.mjs over the reference recording at 1918x1078: 26px dots
     on a 38px pitch, rising 16px.

     Scaled by the sung line rather than copied: this surface sings at 24px where the reference is
     ~57px, so 0.42 of it — 11px dots on a 16px pitch, travelling 7px. Left-aligned, because the card's
     column is left-aligned, which is also what the reference does.
  */
  .waiting {
    position: absolute;
    left: 0;
    top: calc(var(--reel-top, 0px) - 19px);
    display: flex;
    gap: 5px;
    opacity: 0;
    transition: opacity var(--dur-lyric) var(--ease-lyric);
    pointer-events: none;
  }

  .waiting.shown {
    opacity: 1;
  }

  .waiting .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #fff;
    --wait-rise: -7px;
  }

  .waiting.shown .dot {
    animation: lyric-wait 1.2s ease-in-out infinite;
    will-change: transform, opacity;
  }

  .waiting.shown .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .waiting.shown .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  /* The same wave inside an instrumental line, scaled to this surface's type and inheriting the line's
     colour so the depth ramp reaches it the way it reaches words. */
  .dots {
    display: inline-flex;
    gap: 5px;
    align-items: center;
    vertical-align: middle;
  }

  .line.inst .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
    --wait-rise: -5px;
  }

  .line.inst.active .dot {
    animation: lyric-wait 1.2s ease-in-out infinite;
  }

  .line.inst.active .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .line.inst.active .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes lyric-wait {
    0%,
    60%,
    100% {
      transform: translateY(0) scale(1);
      opacity: 0.5;
    }
    30% {
      transform: translateY(var(--wait-rise, -7px)) scale(1.1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .waiting.shown .dot,
    .line.inst.active .dot {
      animation: none;
      opacity: 1;
    }
  }

  :global(html[data-low-power]) .waiting.shown .dot,
  :global(html[data-low-power]) .line.inst.active .dot {
    animation: none;
    opacity: 1;
  }

  .blank {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-faint);
  }

  /* Same letterform settings as the fullscreen `.line`: weight 800, tight negative tracking, and a
     two-layer shadow so the edge of each glyph survives a bright sleeve. The card's own size ramp is
     kept because 26-46px will not fit a 390px panel, but the type is now the same type. */
  .line {
    font-weight: 800;
    line-height: 1.22;
    letter-spacing: -0.5px;
    color: #fff;
    flex: none;
    text-shadow:
      0 1px 3px rgba(0, 0, 0, 0.72),
      0 3px 22px rgba(0, 0, 0, 0.5);
    /* opacity / blur / scale / size are all one event — this line is now the sung one — so they share
       a duration and a curve. On separate schedules the change read as two things happening to the
       text rather than one, and `--ease-out` front-loads ~70% of its distance into the first quarter
       of its time, which is most of what made the enlargement look cheap. */
    transition:
      font-size var(--dur-lyric) var(--ease-lyric),
      opacity var(--dur-lyric) var(--ease-lyric),
      filter var(--dur-lyric) var(--ease-lyric),
      transform var(--dur-lyric) var(--ease-lyric),
      /* `text-shadow` belongs on this list too. Both the sung line below and the hover glow further
         down change it, and with no transition behind either the shadow snapped while the size and
         the blur eased — the glow popping in a beat after the line had finished growing. It rides
         the lyric schedule rather than `--dur-hover` because on this surface the shadow *is* the
         highlight, and the note above is the reason those cannot be on separate tempos. */
      text-shadow var(--dur-lyric) var(--ease-lyric);
    /*
       The origin has to be the left edge, because this box is full width with left-aligned text.
       Scaling about the centre — the default — moves the left edge with it, so the depth ramp was
       also an indent ramp: at the 0.88 floor the far lines sat ~21px to the right of the sung one,
       in a 354px card, and the column's left edge read as ragged rather than as receding. Pinning
       the origin leaves every line flush and lets size, weight and blur carry the depth alone.
       It also stops the arrival bloom below from sliding the words sideways as it grows them.
    */
    transform-origin: left center;
  }

  .line.active {
    text-shadow: 0 1px 14px rgba(0, 0, 0, 0.45);
    /* The arrival rides the independent `scale` property rather than `transform`, `opacity` and
       `filter`. Those are already being transitioned by the rule above for the depth of field, and an
       animation on the same properties does not blend with a transition — it replaces it for its whole
       length and then hands back to wherever the transition had got to, which is short. `scale`
       composes with the inline `transform: scale()` instead of competing with it. The card had no
       arrival at all before this, so the sung line simply snapped bigger while its neighbours eased. */
    animation: line-arrive var(--dur-lyric) var(--ease-lyric);
    will-change: transform;
  }

  /* Only `scale` moves, so nothing here can fall out of step with the resting state that `depth(0)`
     writes inline. The card's size step is proportionally larger than the fullscreen one's (19px to
     24px rather than 26px to 32px), so it starts further under and settles onto its size over exactly
     the window the font-size transition is growing through. */
  @keyframes line-arrive {
    0% {
      scale: 0.95;
    }
    70% {
      scale: 1.012;
    }
    100% {
      scale: 1;
    }
  }

  /* Reduced motion and Low Power both drop the movement and keep the bloom: the glow is the part that
     carries meaning, the scale is the part that can make someone ill. */
  @media (prefers-reduced-motion: reduce) {
    .line.active {
      animation: line-arrive-reduced 200ms ease-out;
    }
  }

  @keyframes line-arrive-reduced {
    from {
      opacity: 0.7;
    }
    to {
      opacity: 1;
    }
  }

  /* `:global()` is required — a bare `html[...]` selector can never match from inside scoped
     component CSS, because `<html>` carries no scope attribute. */
  :global(html[data-low-power]) .line.active {
    animation: line-arrive-reduced 200ms ease-out;
  }

  /* Hidden until the pointer is over the card, so the default state is just the lyric sheet. */






  /* ---------------- hover cover ---------------- */

  /*
     The cover is a RECT INSIDE the card, not the card. It used to be `inset: 0`, which painted the
     sleeve edge-to-edge over the border and read as the whole widget turning into a picture. It now
     stops at ~87% so the card's own frame stays visible around it.

     The growth is a shared-element move out of the thumbnail rather than a cross-fade in place: the
     box is scaled down to the thumb's size with its transform origin pinned to the thumb's centre,
     so releasing the pointer walks the artwork back into the corner it came from. Origin is 6%/6%
     because the thumb sits at roughly (46,44) in the card and the cover box starts at ~25px.
  */
  .cover {
    position: absolute;
    inset: 8%;
    z-index: 5;
    overflow: hidden;
    border-radius: 16px;
    transform: scale(0.17);
    transform-origin: 6% 6%;
    opacity: 0;
    pointer-events: none;
    box-shadow: 0 18px 40px -18px rgba(0, 0, 0, 0.75);
    /*
       --ease-out (cubic-bezier(.22,1,.36,1)), NOT --ease-spring. The spring curve peaks at 1.56, so
       it overshoots: the cover ballooned slightly past its box and snapped back, which is exactly the
       cheap, wobbly feel. A long-tail ease-out decelerates into place instead — reads as deliberate
       and expensive. 620ms is slow enough to feel gradual without feeling laggy; the opacity resolves
       well before it so the artwork is never a ghost for the first third.
    */
    transition:
      transform 620ms var(--ease-out),
      opacity 260ms var(--ease-out);
  }

  /*
     The trigger is the thumbnail, not the card.

     `.card:hover` meant the artwork took over the whole widget whenever the pointer crossed the lyric
     panel, which is most of the card's area — so the words you were trying to read and click vanished
     under a growing picture you had not asked for. `.cover-open` is set from the thumbnail's own
     pointerenter, so the growth comes out of the 46px square it is supposed to come out of. See the
     note on `coverOpen` in the script for why this is a class rather than `:has(.art:hover)`.

     The cover reports its own hover for the same reason, and it is not optional: the grown cover
     paints over the thumbnail, so the moment the pointer travels from the thumb onto the controls it is
     no longer over `.art`. Without that second flag the cover collapses under the cursor, reopens,
     collapses again — a flicker loop exactly where the interaction should feel most solid.

     `:focus-within` is the keyboard route in: the cover itself is not focusable, its buttons are.
  */
  .card.cover-open .cover,
  .cover:focus-within {
    transform: scale(1);
    opacity: 1;
    pointer-events: auto;
  }

  /* The lyric sheet and the head are behind the cover, not under it — the cover stops at 8% so the
     blurred frame stays visible all the way round, and at that inset the title and the first line
     poked out past its edge. Fading them is what makes the grown state read as one object. */
  .head,
  .lyrics {
    transition:
      opacity 180ms var(--ease-out),
      transform 420ms var(--ease-out);
  }

  .card.cover-open :is(.head, .lyrics) {
    opacity: 0;
    transform: scale(0.97);
    pointer-events: none;
  }

  /* The controls ride inside the scaling box, so at rest they are 17% of their size. Holding them at
     zero opacity until the grow has nearly landed keeps them from being read mid-scale, which is what
     used to blur the transport glyphs. */
  .cover-x,
  .cover-trans,
  .cover-vol,
  .cover-prog,
  .cover-orbs {
    opacity: 0;
    transition: opacity 200ms var(--ease-out);
  }

  .card.cover-open :is(.cover-x, .cover-trans, .cover-vol, .cover-prog, .cover-orbs),
  .cover:focus-visible :is(.cover-x, .cover-trans, .cover-vol, .cover-prog, .cover-orbs) {
    opacity: 1;
    /* Tracks the slower grow: arriving at 260ms would have put the controls on screen while the box
       was still visibly moving, which is what made the whole thing feel jumpy. */
    transition: opacity 240ms var(--ease-out) 380ms;
  }

  /* A slow push-in on the picture itself, inside the already-clipping cover, so the sleeve keeps
     moving after the box has arrived. Same idea as the fullscreen backdrop. */
  .cover-art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    /* A picture is not a control. It is also promoted into its own layer by the transform below, and
       an image that paints above the transport will swallow its clicks. */
    pointer-events: none;
    transform: scale(1);
    transform-origin: 50% 45%;
    will-change: transform;
    transition: transform 1600ms var(--ease-out);
  }

  .card.cover-open .cover-art {
    transform: scale(1.12);
  }

  :global(html[data-low-power]) .cover-art {
    transform: none;
    transition: none;
    will-change: auto;
  }

  :global(html[data-low-power]) .cover {
    transform: none;
    transition: opacity 160ms linear;
  }

  /* Only while the controls are up, and only at the two bands they occupy. The middle of the
     artwork stays untouched so the cover still reads as the cover. */
  .cover::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    pointer-events: none;
    background:
      linear-gradient(to bottom, rgba(5, 5, 9, 0.62), transparent 30%),
      linear-gradient(to top, rgba(5, 5, 9, 0.7), transparent 38%);
  }

  /* A row rather than a lone corner button, so the card carries the same affordances as the
     fullscreen sleeve. Centred along the top edge of the cover, matching the reference. */
  .cover-orbs {
    position: absolute;
    top: 10px;
    left: 50%;
    translate: -50% 0;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cover-orbs button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.82);
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid rgba(255, 255, 255, 0.18);
    backdrop-filter: var(--glass-filter-clear);
    -webkit-backdrop-filter: var(--glass-filter-clear);
    cursor: pointer;
    transition:
      color var(--dur-hover) var(--ease-out),
      background-color var(--dur-hover) var(--ease-out),
      transform var(--dur-hover) var(--ease-spring);
  }

  .cover-orbs button:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.22);
    transform: scale(1.1);
  }

  /* The favourite is the centrepiece at the same proportion the fullscreen view uses — about a
     quarter of the sleeve — so the two surfaces read as one product rather than two widgets. */
  /*
     Same bloom as the fullscreen view: the card's controls arrive with the 220ms `.cover` fade, but the
     heart is still coming in a second later. Slow on the way in (declared on the hovered state, which
     is the one that governs the transition *to* it), fast on the way out so it does not sit over the
     cover once the pointer has gone.
  */
  .cover-heart {
    position: absolute;
    left: 50%;
    top: 47%;
    z-index: 3;
    translate: -50% -50%;
    /* An explicit box so the two clipped halves have something to fill. Sized as a share of the
       sleeve rather than in px so it tracks the card's own scale, at 1.75x the original 42%. */
    width: clamp(192px, 67%, 336px);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    padding: 0;
    opacity: 0;
    transition:
      opacity 380ms var(--ease-out),
      color var(--dur-hover) var(--ease-out),
      filter var(--dur-hover) var(--ease-out),
      transform var(--dur-hover) var(--ease-spring);
  }

  /* Unliked owns the white ink and the depth; `.heart-lit` in app.css owns the liked state and its
     bloom — which is now white rather than red, following the sleeve reference, so liked reads as
     *filled* and unliked as a hollow outline. Written as `:not()` so the two never compete —
     component CSS lands after the global sheet, so a plain `.cover-heart { color }` would have
     overridden the shared glow. */
  .cover-heart:not(.heart-lit) {
    color: rgba(255, 255, 255, 0.9);
    filter: drop-shadow(0 3px 14px rgba(0, 0, 0, 0.6));
  }

  .card.cover-open .cover-heart,
  .cover-heart:focus-visible {
    opacity: 1;
    transition:
      opacity 1500ms var(--ease-out) 120ms,
      color var(--dur-hover) var(--ease-out),
      filter var(--dur-hover) var(--ease-out),
      transform var(--dur-hover) var(--ease-spring);
  }

  .heart-half :global(svg) {
    width: 88%;
    height: 88%;
  }

  /* Same hit-area rule as the fullscreen view: the button is 42% of the sleeve, so leaving it
     clickable would favourite the track whenever the middle of the artwork was tapped. `.hit` is
     clipped to the heart's own silhouette, so only the heart answers a click and the cover around it
     does nothing. Keyboard activation is unaffected. */
  .cover-heart {
    pointer-events: none;
  }

  .clip-src {
    position: absolute;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  .hit {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    clip-path: url(#heart-hit);
    cursor: pointer;
  }

  /*
     On the <path>, not the <svg>. `vector-effect` is a graphics-element property, so declared on the
     container it is inert and the stroke keeps scaling with the viewBox.

     But non-scaling-stroke is exactly why the heart looked small: it pins the stroke to literal
     device pixels, so 1.5px drew a hairline around a 139px heart. The heart was never undersized —
     the glyph only fills ~63% of its 24-unit viewBox, so the 221px svg draws a 139px heart against
     the reference's measured 145px. What the reference has and this lacked was mass, so the outline
     is now heavy enough to read as a shape rather than as a thread.
  */
  .cover-heart :global(svg path) {
    vector-effect: non-scaling-stroke;
    stroke-width: 3px;
  }

  .cover-heart:not(.heart-lit):hover {
    transform: scale(1.06);
    color: #fff;
    /* Only the depth shadow. The extra white bloom that used to sit here is not in the reference,
       which is a flat hairline at every state — the glow is what made it look decorated rather than
       drawn. The dark shadow stays because it is doing real work: on a pale sleeve a 3px light line
       needs something to separate it from the artwork. */
    filter: drop-shadow(0 3px 14px rgba(0, 0, 0, 0.6));
  }

  .cover-trans {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 46px;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
  }

  /*
     The reference carries elapsed and total either side of a hairline rail along the bottom of the
     cover. It was missing entirely, which is most of why the grown card read as a picture with three
     buttons on it rather than as a player.
  */
  .cover-prog {
    position: absolute;
    left: 16px;
    right: 16px;
    bottom: 16px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.78);
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }

  /*
     The main seek bar's spec, copied rather than shared. `ProgressBar.svelte` could not be imported
     here: it reaches for the `player` store, and that module constructs its `AudioEngine` singleton at
     import time — pulling it into the mini webview would start a second audio element in a window whose
     only job is to relay commands to the first one. So the geometry, colour and behaviour are matched
     line for line instead, and the reason is recorded here for the next person who reaches for `import`.

     What this replaced: an accent-filled rest with a 42% black wash over it, a white played portion
     driven by an animated `width` with a 250ms linear transition fighting position updates arriving
     ~15 times a second (the rubber-band that read as glitchy), and no playhead at all.
  */
  .cover-prog .rail {
    position: relative;
    flex: 1;
    height: 18px;
    display: flex;
    align-items: center;
    cursor: pointer;
    /* Without this a drag on the bar scrolls the card instead of seeking. */
    touch-action: none;
  }

  .cover-prog .rail::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: 6px;
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.35);
  }

  .cover-prog .fill {
    position: absolute;
    left: 0;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    box-shadow: 0 0 12px -1px rgb(var(--accent-rgb) / 0.8);
    /*
       `width`, not `transform: scaleX()` — mirrors the fix in ProgressBar.svelte. A scaled fill scales
       its own border-radius, so the pill became a sharp rectangle at low progress and the glow
       flattened with it. The card updates at 15Hz and the fill is absolutely positioned, so the width
       change reflows nothing around it. No width transition: that is what made the old bar lag.
    */
    transition: background-color 500ms var(--ease-out);
  }

  .cover-prog .rail.dragging .fill {
    transition: none;
  }

  .cover-prog .head {
    position: absolute;
    top: 50%;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    background: #fff;
    opacity: 0;
    translate: -50% -50%;
    transition: opacity 180ms var(--ease-out);
  }

  /* Same rule as the shared bar: no hover reveal. The head reports the position being set, or the
     focus when the keyboard owns it. */
  .cover-prog .rail.dragging .head,
  .cover-prog .rail:focus-visible .head {
    opacity: 1;
  }

  /* Bare glyphs, no plate and no filled circle — the transport rule the rest of the app follows. */
  .cover-trans button {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    color: rgba(255, 255, 255, 0.92);
    transition:
      color var(--dur-hover) var(--ease-out),
      transform var(--dur-hover) var(--ease-spring),
      text-shadow var(--dur-hover) var(--ease-out),
      opacity var(--dur-hover) var(--ease-out);
  }

  .cover-trans button:hover {
    color: #fff;
    transform: scale(1.14);
    text-shadow: 0 0 18px rgba(255, 255, 255, 0.5);
  }

  /* Play carries the same 1.4 × skip hierarchy as the fullscreen view, so its box grows with it —
     otherwise the larger glyph crowds the skips and the row loses its even optical rhythm. */
  .cover-trans .pp {
    width: 44px;
    height: 44px;
    color: #fff;
  }

  .cover-vol {
    position: absolute;
    right: 10px;
    top: 50%;
    z-index: 3;
    translate: 0 -50%;
  }

  /* A lyric line is now a button, so it needs the pointer affordance and the glow the fullscreen
     view already gives one. */
  .line {
    cursor: pointer;
    width: 100%;
    text-align: left;
    /* `font-family` only, deliberately. This used to be the `font: inherit` shorthand, which also
       resets weight, line-height and letter-spacing — so it silently wiped the 800 weight and the
       tight tracking set above and the card rendered in the browser's default 400. */
    font-family: inherit;
    color: #fff;
  }

  .line:hover {
    opacity: 1 !important;
    filter: blur(0) !important;
    text-shadow: 0 0 16px rgba(255, 255, 255, 0.45);
  }
</style>
