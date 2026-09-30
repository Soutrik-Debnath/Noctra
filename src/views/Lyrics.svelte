<script lang="ts">
  /**
   * Fullscreen lyrics — a direct copy of docs/references/01 and 02 (Spotify + Spicetify's
   * spicy-lyrics view), which the owner asked for verbatim.
   *
   * What that layout actually is, as opposed to what this file used to do:
   *   - the artwork is sharp and still, not blurred and not rotating
   *   - the artist sits over the artwork's top-left corner, the album over its top-right, both tiny
   *     and uppercase
   *   - every hover control lives *inside* the artwork: orb row across the top, transport inside its
   *     bottom edge, favourite and vertical volume down the inside of the right edge
   *   - a thick white progress bar with the times flanking it, directly under the art
   *   - title large and centred beneath, artist below that, and nothing else — no source credit
   *   - lyrics on the right, all left-aligned, where the current line is huge and white and every
   *     other line dims *and blurs* more the further it is from the line being sung
   */
  import AlbumArt from "../components/AlbumArt.svelte";
  import Icon from "../components/Icon.svelte";
  import LosslessMark from "../components/LosslessMark.svelte";
  import PlayerControls from "../components/PlayerControls.svelte";
  import VolumePill from "../components/VolumePill.svelte";
  import { paths } from "../components/icons";
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { lyricsStore } from "../stores/lyrics.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { settings } from "../stores/settings.svelte";
  import { activeLine, activeWord, isInstrumental, lineDistance, lineProgress } from "../services/lyrics/lrc";
  import { createReelFollow } from "../services/lyrics/reelFollow";
  import { lyricsDebugEnabled, lyricsQuery } from "../services/lyrics/lyrics";
  import { needsRomanisation, romanise } from "../services/lyrics/romanize";
  import { formatTime } from "../utils/format";
  import { mediaLine, isLossless } from "../data/track";
  import { albumTrackCount } from "../services/collections";
  import { toggleMiniWindow } from "../services/windowBridge";
  import LyricsSettings from "../components/LyricsSettings.svelte";

  const isFavorite = $derived(player.current ? favorites.has(player.current.id) : false);
  let pop = $state(false);
  /** True for the length of the break animation, so the halves can fly apart after the state flips. */
  let breaking = $state(false);
  /** Matches the 1250ms fracture in app.css. The class has to outlast the animation or the halves
      snap back to full opacity mid-fade. */
  const BREAK_MS = 1250;
  /**
   * The glyph actually drawn.
   *
   * Held filled for the length of the break. `favorites.toggle()` flips `isFavorite` on the same
   * tick, so reading it directly means the heart becomes a thin outline at the instant you un-like
   * it — and what then cracks apart is a hairline, not the opaque heart the break is meant to show.
   */
  const glyph = $derived(breaking || isFavorite ? "heart-filled" : "heart");
  /** The hit clip reads the glyph's own path, so the clickable heart can never drift from the drawn one. */
  const heartPath = $derived(paths.heart[0]);
  /** The lyrics panel overlays this view rather than navigating away, so every change is visible live. */
  let panel = $state(false);

  function toggleFavorite() {
    const id = player.current?.id;
    if (!id) return;
    if (isFavorite) {
      // Leaving the favourite: play the break on the filled heart, and let it fall back to the
      // outline only when the animation is over.
      breaking = true;
      favorites.toggle(id);
      setTimeout(() => (breaking = false), BREAK_MS);
    } else {
      favorites.toggle(id);
      pop = true;
      setTimeout(() => (pop = false), 460);
    }
  }

  /** "Alternative · 2015 · 2 tracks · Lossless" under the artist. Empty when the tags say nothing. */
  const media = $derived(
    player.current ? mediaLine(player.current, albumTrackCount(player.tracks, player.current)) : "",
  );
  /** The seal shown beside the word, for the files that actually carry a lossless stream. */
  const lossless = $derived(player.current.id ? isLossless(player.current) : false);

  const lines = $derived(lyricsStore.lyrics?.lines ?? []);
  /**
   * What the source actually supplied. `"plain"` means the words have no timestamps at all, so this view
   * renders them as a static column instead of inventing a schedule to scroll them on.
   */
  const level = $derived(lyricsStore.lyrics?.level ?? "plain");
  const timed = $derived(level === "word" || level === "line");
  const nowMs = $derived(player.position * 1000 + settings.value.lyricsOffset);
  const index = $derived(timed && lines.length ? activeLine(lines, nowMs) : -1);

  /**
   * Whether to show the waiting dots.
   *
   * `playing` and `!buffering` are load-bearing, not decoration: this is a CSS animation, so it does
   * not stop when the audio does. Left ungated it danced through a pause and through the stall after a
   * seek or a track change, on a clock that was frozen — which is the opposite of what the row means.
   */
  const waiting = $derived(
    timed && lines.length > 0 && index < 0 && player.isPlaying && !player.isBuffering,
  );

  /**
   * `player.position` only ticks a few times a second, which is fine for a seek bar and visibly
   * steppy for a fill that travels across a line. This mirrors it at frame rate while playing.
   */
  let precise = $state(0);
  const wordClock = $derived(precise || nowMs);

  const words = $derived(lines[index]?.words ?? []);

  /**
   * How far through the line being sung we are, 0–1.
   *
   * Drives the sweep across the active line's own text. This replaces the estimated word-by-word
   * highlight: the endpoints come from the file — the line's own stated end, or the next line's start —
   * so the fill moves at the true rate of the singing and cannot drift. Guessing where each word sits
   * inside that interval is what produced BUG-019, BUG-028 and BUG-034.
   */
  const progress = $derived(lineProgress(lines, index, wordClock));

  /** Which word is being sung right now — only ever non-empty when the file really carries word tags. */
  const currentWord = $derived(activeWord(words, wordClock));

  /**
   * Per-line dimming and blur, as a function of distance from the line being sung. Both the depth
   * and the fade are user-tunable from the in-place lyrics panel, because how soft neighbouring
   * lines should be is the one thing about this view that genuinely differs between people.
   *
   * The active line's shadow is part of this string rather than a CSS rule because the inline
   * `filter` below would otherwise override it, and the sweep needs a `drop-shadow` (its text is
   * transparent, so a `text-shadow` paints a black copy of the line over the gradient).
   */
  function depth(i: number) {
    // Before the first timestamp nothing is being sung, and the column holds a *rest* state: sharp and
    // readable, but uniform, at the inactive brightness, and with none of the sung line's glow.
    //
    // This used to collapse onto line 0 (`index < 0 ? 0 : index`), which put line 0 at distance zero
    // and handed it the full sung treatment — opacity 1, no blur, the 12px white bloom — for the whole
    // intro. On a track with a long one that is most of the first half-minute of a line that has not
    // started, reading as the line being sung. Anchoring on -1 literally was worse the other way (the
    // whole column opened behind the blur ramp and the view read blank), which is why `lineDistance`
    // returns null for "nothing is singing" rather than a position on the ramp.
    const d = lineDistance(index, i);
    if (d === null) {
      return { filter: "blur(0px)", alpha: 0.85, scale: 0.95 };
    }
    if (d === 0) {
      return {
        filter:
          "blur(0px) drop-shadow(0 1px 2px rgba(0,0,0,0.8)) " +
          "drop-shadow(0 0 12px rgba(255,255,255,0.22)) drop-shadow(0 5px 20px rgba(0,0,0,0.55))",
        alpha: 1,
        scale: 1,
      };
    }
    const maxBlur = settings.value.lyricsBlur;
    const dimFloor = 1 - settings.value.lyricsDim / 100;
    return {
      filter: `blur(${(maxBlur * blurBand(d)).toFixed(2)}px)`,
      // Steeper than it was: at 0.07 per step the neighbours sat at 0.83 against the active line's
      // 1.0, so nothing on screen read as the line being sung.
      alpha: Math.max(dimFloor, 0.9 - d * 0.13),
      scale: Math.max(0.88, 0.96 - d * 0.025),
    };
  }

  /**
   * Blur in three bands rather than a continuous ramp.
   *
   * `blur()` is the expensive half of the depth of field: a line whose blur changes has to be
   * re-rastered, and a per-step ramp meant ten lines changed on every advance of the song — five
   * above the active line and five below. Everything past the second neighbour now sits at the cap,
   * so an advancing line re-rasters six layers instead of ten and the far field is left alone. The
   * bands land within 0.05px of the old ramp at d=1 and d=2, and the only lines that move further
   * are the third and fourth neighbours, which are already at 0.51 and 0.38 alpha.
   */
  function blurBand(d: number) {
    return d === 1 ? 0.37 : d === 2 ? 0.55 : 1;
  }

  let raf = 0;
  $effect(() => {
    const wanted = lyricsStore.status === "ready" && timed && player.isPlaying;
    cancelAnimationFrame(raf);
    raf = 0;
    if (!wanted) return;
    const tick = () => {
      precise = player.position * 1000 + settings.value.lyricsOffset;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  // Diagnostics for the timing work, off unless `localStorage.noctra.lyrics.debug = "1"`. It reports
  // what the audio clock says and which word the timestamps put there, which is how a bad source is
  // told apart from a bad renderer.
  $effect(() => {
    if (!lyricsDebugEnabled() || !timed) return;
    const w = words[currentWord];
    console.log("[lyrics] render", {
      audioSeconds: player.position.toFixed(3),
      level,
      lineIndex: index,
      word: w?.text ?? "",
      wordStartMs: w?.start ?? null,
      wordEndMs: w?.end ?? null,
      lineEndMs: lines[index]?.end ?? null,
    });
  });

  const romaniseLine = $derived.by(() => {
    const on = settings.value.romanise;
    return (text: string) => (on && needsRomanisation(text) ? romanise(text) : "");
  });

  let viewport = $state<HTMLDivElement | null>(null);
  let offset = $state(0);

  /**
   * Clearance above and below the column, as a fraction of the viewport height.
   *
   * This is the whole centring rule, and it is asymmetric on purpose. The reel can never be
   * translated past either end of the column, so where a sung line comes to rest is decided entirely
   * by where that clamp starts to bind:
   *
   *   - TOP 0.20 — the first lines sit near the top of the half and *stay there*. The reel does not
   *     move at all until the sung line's own centre would pass the viewport's centre, which is
   *     several lines in. Half a viewport here, which is what it used to be, dragged line one to
   *     dead centre the moment the song started — the "first line in the middle" the owner
   *     screenshotted.
   *   - BOTTOM 0.22 — the last lines come to rest around 78% down, between the middle and the bottom
   *     edge. Zero would pin them flush to the edge, inside the mask's fade; a half viewport would
   *     hold them at dead centre through the outro.
   *
   * Both figures keep every sung line clear of the mask's 14%/86% fade bands.
   */
  const REEL_TOP = 0.2;
  const REEL_BOTTOM = 0.22;
  let padHeight = -1;

  // The line is looked up from the rendered DOM rather than a parallel refs array. A `bind:this`
  // array drifts out of sync with the keyed each block across track changes — it then measures an
  // element that is no longer the active one, which pushed the reel to its clamp limit with the real
  // active line still far outside the viewport.
  function measure(): number | null {
    const el = index >= 0 ? viewport?.querySelectorAll<HTMLElement>(".line")[index] : undefined;
    const box = viewport?.querySelector<HTMLElement>(".reel");
    if (!viewport || !el || !box) return null;
    const H = viewport.clientHeight;
    /*
       Written from the measured height rather than in vh: this box is a grid row inside a padded
       stage, so it is shorter than the window and a vh figure would be wrong by the difference. Only
       rewritten when the height changes — a style write every frame would dirty the whole reel.

       Set on the *viewport*, not on the reel, and that is load-bearing. The reel's own style
       attribute is written by the template every frame (`transform: translateY(…)`), and Svelte
       replaces the whole attribute rather than the one declaration — so a custom property set on the
       reel is wiped by the very next frame of the follow that needed it. Measured, not theorised:
       both webviews were caught with `--reel-top` gone and `padding-block` computing to 0px, which
       silently removed the clamp and yanked the first line of every song to dead centre. Custom
       properties inherit, so the reel reads them from its parent just the same.
    */
    if (H !== padHeight) {
      padHeight = H;
      viewport.style.setProperty("--reel-top", `${Math.round(H * REEL_TOP)}px`);
      viewport.style.setProperty("--reel-bottom", `${Math.round(H * REEL_BOTTOM)}px`);
    }
    // Measured against the reel's own box rather than `offsetTop`, whose origin is the nearest
    // *positioned* ancestor — here that is a container above the viewport, so every offsetTop was
    // out by roughly one viewport height and the active line landed far above the centre. Both rects
    // carry the same translateY, so subtracting them also cancels the reel's own transform.
    const topInReel = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const target = H / 2 - topInReel - el.offsetHeight / 2;
    const travel = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    return Math.max(-travel, Math.min(0, target));
  }

  const follow = createReelFollow(measure, (y) => (offset = y), () => ({
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
  // scrolling rather than as the song starting. Identity is the signal, not the line count — the same
  // song fetched twice has the same lines and should not snap.
  let seenLyrics: unknown;
  $effect(() => {
    void index;
    void settings.value.lyricsScale;
    const src = lyricsStore.lyrics;
    if (src !== seenLyrics) {
      seenLyrics = src;
      follow.jump();
    } else {
      follow.poke();
    }
  });

  // Covers a track change whose lyrics are already in hand, where the store above sees no new object.
  // `jump()` only arms, so calling it redundantly costs nothing.
  $effect(() => {
    void player.current?.id;
    follow.jump();
  });

  /*
     A ResizeObserver on the viewport, not a window `resize` listener. This box is a grid row, so its
     height also changes when something else in the layout does — the player bar growing, the column
     swapping between the reel and the plain list — and none of those fire a window resize. Measured,
     not hypothetical: the reel was found carrying padding written for a 1007px viewport while the
     viewport was 927px, so the clamp was working from a height that no longer existed.
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

  function jumpTo(line: { time: number }) {
    player.seek(line.time / 1000);
    if (!player.isPlaying) void player.play();
  }

  // No wheel handler on the lyric column. There used to be one that mapped the wheel to volume in
  // 0.04 steps and called `preventDefault()` — which meant scrolling over the right half of the
  // screen turned the knob, while also blocking the scroll the gesture was actually asking for. The
  // column cannot scroll anyway (`.lyrics` is `overflow: hidden` and the reel is driven by the
  // follow's transform), so all it ever did was steal the gesture. `VolumePill` has its own wheel
  // handler and sits on this same screen, which is where wheel-volume belongs: under the pointer that
  // is aiming at the volume.

  // The lyrics request itself is driven from App.svelte on every track change, so this view only
  // reads the store — mounting it must never be what triggers the fetch, or the mini-player card
  // would sit empty whenever this page was not open.

  /**
   * Tells the shared backdrop that the most demanding surface in the app is on screen: a full
   * column of large white text sitting directly on the current sleeve. BlurredBackground reads this
   * to drop the accent bloom, which is colour the blur pass already carries here.
   */
  $effect(() => {
    document.documentElement.toggleAttribute("data-lyrics-view", true);
    return () => document.documentElement.removeAttribute("data-lyrics-view");
  });

  /*
     The seek row is hand-styled rather than the shared `ProgressBar`, because it is deliberately the
     loudest progress indicator in the app — but it had no pointer handling whatsoever, so it was a
     picture of a slider that answered nothing. It now follows the same contract as `ProgressBar`:
     a local value drives the display while dragging and the seek is committed once on release,
     because seeking on every pointermove spams the decoder with range requests.
  */
  let seekEl = $state<HTMLSpanElement | null>(null);
  let scrubTo = $state<number | null>(null);
  let seeking = $state(false);
  const shownPos = $derived(scrubTo ?? player.position);

  function seekRatio(e: MouseEvent) {
    const r = seekEl?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  function onSeekDown(e: PointerEvent) {
    if (player.duration <= 0) return;
    seeking = true;
    scrubTo = seekRatio(e) * player.duration;
    // Throws on a synthetic event or an already-released pointer; the up/cancel handlers still land
    // the seek, so a failure to capture must not swallow the interaction.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onSeekMove(e: PointerEvent) {
    if (seeking) scrubTo = seekRatio(e) * player.duration;
  }

  function onSeekCommit() {
    if (!seeking) return;
    seeking = false;
    if (scrubTo !== null) player.seek(scrubTo);
    scrubTo = null;
  }

  function onSeekKey(e: KeyboardEvent) {
    if (player.duration <= 0) return;
    const step = e.key === "PageUp" || e.key === "PageDown" ? 30 : 5;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      player.seek(Math.min(player.duration, player.position + step));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.seek(Math.max(0, player.position - step));
    } else if (e.key === "Home") {
      e.preventDefault();
      player.seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      player.seek(player.duration - 1);
    }
  }
</script>

<section class="stage">
  <div class="column">
    <div class="art-zone">
      <AlbumArt src={player.current.artwork} alt={player.current.album} size="var(--art)" />

      <!-- No credit line across the top of the sleeve. The reference carries one, but on this library
           it is the single noisiest element on the screen: soundtrack billing is long
           ("A.R. Rahman, Badshah, Tanishk Bagchi, …"), so both ends ellipsised into mush and the same
           information was already printed under the title. The owner asked for it twice. -->
      <div class="orbs">
        <button
          class="orb orb-sm"
          class:orb-on={ui.miniOpen}
          title="Desktop mini-player"
          aria-label="Desktop mini-player"
          aria-pressed={ui.miniOpen}
          onclick={() => void toggleMiniWindow()}
        >
          <Icon name="pip" />
        </button>
        <!-- The reference lights this one while fullscreen is the current view, which is always true
             from here, so it reads as "you are here" rather than as a button waiting to be pressed.
             It leaves fullscreen for the artwork view, which is the other half of the pair. -->
        <button
          class="orb orb-sm orb-on"
          aria-current="true"
          title="Album view"
          aria-label="Album view"
          onclick={() => ui.set("nowplaying")}
        >
          <Icon name="expand" />
        </button>
        <button class="orb orb-sm" title="Library" aria-label="Library" onclick={() => ui.set("library")}>
          <Icon name="library" />
        </button>
        <button
          class="orb orb-sm"
          class:orb-on={panel}
          title="Lyrics settings"
          aria-label="Lyrics settings"
          aria-pressed={panel}
          onclick={() => (panel = !panel)}
        >
          <Icon name="settings" />
        </button>
        <button class="orb orb-sm" title="Close lyrics" aria-label="Close lyrics" onclick={() => ui.closeFullscreen()}>
          <Icon name="close" />
        </button>
      </div>

      <div class="inart">
        <PlayerControls />
      </div>

      <!-- The favourite sits dead centre on the cover, large, and only appears with the pointer.
           Un-favouriting plays the shared break: the heart cracks along a jagged fracture, the two
           halves hang apart later enough to be seen, then fade. Fracture and glow live in app.css so
           the desktop card and this view cannot drift apart.

           The hit area is the heart silhouette, not the button's square box. The button is ~42% of the
           sleeve, so a plain box would favourite the track whenever the middle of the artwork was
           clicked — the owner asked for the heart alone to do that. `.hit` is clipped to the same path
           the glyph draws, so clicking the cover anywhere outside the heart does nothing. Keyboard
           activation is unaffected: `pointer-events` only governs hit testing. -->
      <svg class="clip-src" aria-hidden="true" focusable="false">
        <defs>
          <!-- objectBoundingBox units, and the glyph occupies the middle 88% of the box, hence the
               0.06 offset and the 0.88/24 scale. -->
          <clipPath id="heart-hit" clipPathUnits="objectBoundingBox">
            <path transform="translate(0.06 0.06) scale(0.0366667)" d={heartPath} />
          </clipPath>
        </defs>
      </svg>
      <button
        class="bigheart"
        class:heart-lit={isFavorite}
        class:heart-breaking={breaking}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={isFavorite}
        onclick={toggleFavorite}
      >
        <span class="hit" aria-hidden="true"></span>
        <span class="heart-half left"><Icon name={glyph} /></span>
        <span class="heart-half right"><Icon name={glyph} /></span>
      </button>

      <div class="side">
        <VolumePill
          width="calc(var(--art) * 0.072)"
          height="calc(var(--art) * 0.36)"
          value={player.volume}
          muted={player.muted}
          oninput={(v) => player.setVolume(v)}
          onmute={() => player.setMuted(!player.muted)}
        />
      </div>
    </div>

    <div class="meta">
      <div class="timing">
        <span class="t">{formatTime(shownPos)}</span>
        <span
          class="bar"
          bind:this={seekEl}
          role="slider"
          tabindex="0"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(player.duration)}
          aria-valuenow={Math.round(shownPos)}
          onpointerdown={onSeekDown}
          onpointermove={onSeekMove}
          onpointerup={onSeekCommit}
          onpointercancel={onSeekCommit}
          onlostpointercapture={onSeekCommit}
          onkeydown={onSeekKey}
        >
          <span class="bar-rest"></span>
          <span class="bar-played" style="width: {player.duration > 0 ? (shownPos / player.duration) * 100 : 0}%"></span>
        </span>
        <span class="t dim">{formatTime(player.duration)}</span>
      </div>
      <h1>{player.current.title}</h1>
      <p>{player.current.artist}</p>
      {#if media || lossless}
        <p class="media">
          {media}
          {#if lossless}
            <span class="ll" title="Lossless audio" aria-label="Lossless audio">
              <LosslessMark />
            </span>
          {/if}
        </p>
      {/if}
    </div>
  </div>

  <div
    class="lyrics"
    class:hollow={lyricsStore.status !== "ready" || lines.length === 0}
    bind:this={viewport}
    aria-live="polite"
    onwheel={follow.onWheel}
  >
    {#if lyricsStore.status === "loading"}
      <p class="notice">Looking for lyrics…</p>
    {:else if lyricsStore.status === "none" || lyricsStore.status === "error"}
      <p class="notice">{lyricsStore.message || "No lyrics found for this track."}</p>
      <button
        class="find"
        onclick={() => void lyricsStore.load(lyricsQuery(player.current), true)}
      >
        <Icon name="search" size={15} />
        Find lyrics
      </button>
    {:else if lines.length === 0}
      <p class="notice">These lyrics have no timing.</p>
    {:else if level === "plain"}
      <!-- Untimed words, shown as words. No active line, no fill, no jump target: there is no timestamp
           in the source to hang any of that on, and scrolling them on an invented schedule is what made
           static lyrics look synced when they were not. -->
      <div class="static">
        {#each lines as line, i (i)}
          {@const roman = romaniseLine(line.text)}
          <p class="static-line">{roman || line.text}</p>
        {/each}
      </div>
    {:else}
      <div class="reel" style="transform: translateY({offset}px)">
        <!--
          Three dots for the stretch where the song is playing but no line has started.

          The reference draws them above the first line, takes them one at a time from the left, and
          removes them the instant a line is being sung — which is precisely the gap BUG-085 left open.
          A rest state with nothing in it read as a screen that had not loaded yet.

          Absolutely positioned so it can never move the reel: the follow measures real line rects every
          frame, and a row entering or leaving the flow would shift every one of them.
        -->
        <div class="waiting" class:shown={waiting} aria-hidden="true">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
        {#each lines as line, i (i)}
          {@const isActive = i === index}
          {@const d = depth(i)}
          {@const inst = isInstrumental(line.text)}
          {@const roman = romaniseLine(line.text)}
          <button
            class="line"
            class:active={isActive}
            class:inst={inst}
            style="opacity: {d.alpha}; filter: {d.filter}; transform: scale({d.scale});"
            title={inst ? "Play from this break" : "Jump to this line"}
            aria-label={inst ? "Instrumental break" : undefined}
            onclick={() => jumpTo(line)}
          >
            <!--
              Romanisation REPLACES the original line rather than sitting under it.

              The consequence worth stating: a romanised line cannot carry word-level highlighting,
              because the timed word list belongs to the original script and there is no reliable map
              from "hamma" back onto the third word of "हम्मा". So when romanisation is on for a line,
              that line falls back to line-level sync — the sweep gradient is suppressed too, since it
              is driven by the same word clock. Turning the setting off brings the karaoke back.
            -->
            <span
              class="text"
              class:sweep={isActive && !inst && !roman && words.length === 0}
              style={isActive && !inst && !roman && words.length === 0 ? `--p: ${progress.toFixed(4)}` : undefined}
            >
              <!--
                An instrumental break is the source's `♪`, not a lyric. Rendered as text that lone
                glyph sat inside the line button's fit-content padding and came out looking like an
                unlabelled rounded box — a broken control, not eight bars of guitar. The same three
                dots the intro uses go here instead, and they dance only while that break is the line
                being played, which is the same rule the waiting row follows.
              -->
              {#if inst}
                <span class="dots" aria-hidden="true">
                  <span class="dot"></span>
                  <span class="dot"></span>
                  <span class="dot"></span>
                </span>
              {:else if roman}
                {roman}
              {:else if isActive && words.length > 0}
                {#each words as w, wi (wi)}
                  <span class="word" class:lit={wi <= currentWord} class:now={wi === currentWord}>{w.text}</span>
                {/each}
              {:else}
                {line.text}
              {/if}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if panel}
    <LyricsSettings onclose={() => (panel = false)} />
  {/if}
</section>

<style>
  .stage {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: minmax(360px, 40%) 1fr;
    align-items: center;
    gap: clamp(24px, 5vw, 72px);
    padding: 40px clamp(36px, 5vw, 80px) 40px clamp(28px, 4vw, 64px);
    animation: open 420ms var(--ease-out);
  }

  @keyframes open {
    from {
      opacity: 0;
      transform: scale(0.985);
    }
  }

  /* ---------------- left column ---------------- */
  /* ONE MEASURE, EVERYTHING ELSE A FRACTION OF IT — the same rule Now Playing runs on.
     This view used to author the cover at 560 and everything on and under it in its own absolute px,
     so raising the cover left the orb row, the transport, the volume rail and the whole text block
     behind, and the icons got *relatively* smaller on bigger screens. That is why "make everything
     bigger" kept coming back: each pass raised a number and the next pass found them out of step.

     The tokens live on `.column`, not `.art-zone`, because the seek row and the title sit *below* the
     sleeve and still have to scale with it.

     Factors are measured off the reference against its own cover (590px there). */
  .column {
    --art: clamp(300px, min(53vh, 32vw), 700px);
    --art-ring: calc(var(--art) * 0.088);
    --art-ring-ico: calc(var(--art) * 0.042);
    --art-tap: calc(var(--art) * 0.15);
    --art-disc: calc(var(--art) * 0.158);
    /* Matches Now Playing: play is the largest glyph on the row, about a fifth above the skips.
       It was previously below them (0.081 against 0.092), which read as the primary control being
       the weakest once its disc was removed. */
    --art-play: calc(var(--art) * 0.102);
    --art-skip: calc(var(--art) * 0.073);
    --art-aux: calc(var(--art) * 0.048);
    --art-rail: calc(var(--art) * 0.22);
    /* under the sleeve */
    --art-meta-w: calc(var(--art) * 0.94);
    --art-bar-h: calc(var(--art) * 0.024);
    --art-time: calc(var(--art) * 0.034);
    /* Cut back hard from 0.07. The reference's title is ~7.8% of its sleeve, but its titles are two
       words ("One More Hour"); ours carry full soundtrack billing, so at the reference ratio the title
       filled two thirds of the column and ellipsised anyway. Size is set for the longest string the
       library actually contains, not for the shortest one the reference happens to show. */
    --art-title: calc(var(--art) * 0.058);
    --art-artist: calc(var(--art) * 0.036);
    --art-media: calc(var(--art) * 0.028);

    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--art) * 0.038);
  }

  .art-zone {
    position: relative;
    flex: none;
    /* `--art` and every fraction live on `.column` — see the note there. */
    width: var(--art);
  }

  /*
     Everything that sits on the sleeve — the orb row, the transport, the favourite — is
     white, and a sleeve can be cream. `data-art-light` cannot solve this because it is driven by one
     mean for the whole cover, while the failure is local: this cover is dark where the transport is
     and blown out exactly where the labels are.

     So the guarantee is made geometrically instead. The top and bottom bands get a directional
     scrim, which is where every control actually lives, and the middle is left completely untouched
     so the artwork still reads as the artwork rather than as a dimmed thumbnail.
  */
  .art-zone::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: var(--radius-art);
    pointer-events: none;
    opacity: 0;
    transition: opacity 240ms var(--ease-out);
    background:
      linear-gradient(to bottom, rgba(5, 5, 9, 0.74) 0%, rgba(5, 5, 9, 0.4) 14%, transparent 30%),
      linear-gradient(to top, rgba(5, 5, 9, 0.7) 0%, rgba(5, 5, 9, 0.3) 16%, transparent 34%);
  }

  .art-zone:hover::before,
  .art-zone:focus-within::before {
    opacity: 1;
  }

  .orbs,
  .inart,
  .side,
  .bigheart {
    z-index: 3;
  }




  .orbs,
  .inart,
  .side,
  .bigheart {
    position: absolute;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 240ms var(--ease-out),
      transform 240ms var(--ease-out),
      visibility 0s linear 240ms;
  }

  .art-zone:hover :is(.orbs, .inart, .side, .bigheart),
  .art-zone :is(.orbs, .inart, .side, .bigheart):focus-visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity 240ms var(--ease-out),
      transform 240ms var(--ease-out),
      visibility 0s;
  }

  .orbs {
    /* Below the credit line, which is always on screen.
       Six rings at 8.8% with 1.4% gaps = a 10.2% pitch, which is the reference's ~60px on a 590px
       sleeve and puts the whole row at 60% of the cover's width. Wider gaps pushed the row out to
       ~65% and made it read as a toolbar rather than a tight cluster. */
    top: calc(var(--art) * 0.068);
    left: 50%;
    display: flex;
    gap: calc(var(--art) * 0.014);
    transform: translate(-50%, calc(var(--art) * -0.018));
  }

  /* The reference draws this row noticeably larger than a utility icon strip, and it sizes it
     against the sleeve rather than in px — see the `--art` note on `.art-zone`. Scoped to the
     artwork so the small close button on Stats keeps its own scale. */
  .art-zone .orb-sm {
    --orb-size: var(--art-ring);
    border-width: max(1px, calc(var(--art) * 0.0026));
  }

  .art-zone .orb-sm :global(svg) {
    width: var(--art-ring-ico);
    height: var(--art-ring-ico);
  }

  /* The reference's row reads as six evenly-weighted circles. The layout orb is genuinely inert
     until that feature lands, and D-015 says an unwired control must not pretend to work — so it
     stays dimmer than its neighbours rather than being hidden or deleted. The global disabled
     opacity of 0.4 was too faint to read as a circle at all, which broke the row's rhythm; this
     keeps it visibly the odd one out while still counting as one of six. */
  .orbs .orb-sm:disabled {
    opacity: 0.62;
  }

  /* An active orb in the reference is a soft neutral lift — a lighter pane of glass, not a coloured
     ring. The shared `.orb-on` paints the track's accent, which is right for shuffle and repeat on
     the bar but makes this row's third circle glow red/gold/blue depending on whatever is playing,
     so it is overridden here rather than changed globally. */
  .orbs .orb-sm.orb-on {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.5);
    background-color: rgba(255, 255, 255, 0.16);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.34),
      inset 0 -6px 12px -9px rgba(0, 0, 0, 0.5);
  }

  .art-zone:hover .orbs,
  .orbs:focus-visible {
    transform: translate(-50%, 0);
  }

  .inart {
    left: 0;
    right: 0;
    bottom: calc(var(--art) * 0.036);
    display: flex;
    justify-content: center;
    transform: translateY(calc(var(--art) * 0.014));
    /* Hands the transport its scale. `PlayerControls` owns the shapes and defaults; the only sane
       ruler for a control sitting on a cover is the cover. */
    --pc-tap: var(--art-tap);
    --pc-disc: var(--art-disc);
    --pc-aux: var(--art-aux);
    --pc-skip: var(--art-skip);
    --pc-play: var(--art-play);
    --pc-gap: calc(var(--art) * 0.022);
    filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.6));
  }

  .art-zone:hover .inart,
  .inart:focus-visible {
    transform: translateY(0);
  }

  /* Vertically centred on the artwork's right edge — the previous `bottom: 84px` sat it low, which
     read as an afterthought rather than a control that belongs to the cover. */
  .side {
    right: calc(var(--art) * 0.03);
    top: 50%;
    transform: translate(calc(var(--art) * 0.014), -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--art) * 0.021);
    /* Positioning ONLY — the glass belongs to `VolumePill` now.
       This wrapper used to *be* the rail, so it kept a full set of chrome: background, its own
       `backdrop-filter`, border, padding and radius. `VolumePill` grew the same chrome, so the
       fullscreen was drawing a glass capsule inside a glass capsule, and the inner pill's
       `backdrop-filter` was sampling the outer wrapper's already-blurred 20px box instead of the
       cover — which is why the rail looked like flat grey plastic rather than a lens.
       Now Playing's `.side` had already been reduced to this; the two surfaces were running
       different implementations of the same control. */
  }

  .art-zone:hover .side,
  .side:focus-visible {
    transform: translate(0, -50%);
  }

  /* ---------------- the big centre favourite ---------------- */
  .bigheart {
    left: 50%;
    top: 50%;
    /* Sized against the sleeve rather than in absolute px: the cover is itself clamped, so a fixed size
       was a modest mark on a big monitor and swallowed the artwork on a laptop.
       91% of the cover, up from 57% — the glyph is 88% of this box, so the heart lands at ~80% of the
       sleeve, which is where the artwork view (`--art-heart: 0.8`) and the desktop card already sit.
       This surface had been left behind at the old proportion while the other two were scaled up twice. */
    width: clamp(240px, 91%, 528px);
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    translate: -50% -50%;
    padding: 0;
    border-radius: 50%;
    background: transparent;
    transform: scale(0.86);
    cursor: pointer;
    /* Hit testing is delegated to `.hit` below, which is clipped to the heart silhouette. */
    pointer-events: none;
  }

  /* The zero-size host for the clip path. It has to be in the document for `url(#heart-hit)` to
     resolve, but it must not take part in layout. */
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

  /* The reveal rule earlier in this sheet grants `pointer-events: auto` to the whole button on hover,
     which is what made the entire 42%-of-the-sleeve square a favourite target. Taking it back here —
     after that rule, so equal specificity resolves in favour of this one — leaves the button
     non-interactive and `.hit`, clipped to the heart silhouette, as the only thing that can be
     clicked. The artwork beside the heart therefore stops favouring the track, and the heart itself
     still does. Keyboard activation is unaffected: Enter and Space fire the button regardless. */
  .art-zone:hover .bigheart,
  .art-zone .bigheart:focus-visible {
    pointer-events: none;
  }

  /* Unliked carries the ink and the depth; liked hands both to `.heart-lit` in app.css. Written as a
     `:not()` so the two never compete on order — component CSS is injected after the global sheet, so
     a plain `.bigheart { color }` would have quietly overridden the red glow on every large heart. */
  .bigheart:not(.heart-lit) {
    color: rgba(255, 255, 255, 0.96);
    filter: drop-shadow(0 3px 16px rgba(0, 0, 0, 0.62));
  }

  .heart-half :global(svg) {
    width: 88%;
    height: 88%;
  }

  /*
     The unliked heart is a hairline, not a stroke-weight outline.

     This was `stroke-width: 1.5` on the `<svg>` with no `vector-effect`, which is the worst of both:
     `stroke-width` *does* inherit into the paths, so it applied — but in viewBox units on a 24-unit box
     blown up to ~250px, which renders it as a ~15px rope. The comment claimed a hairline while drawing
     the thickest outline in the app. Declared on the <path> with the stroke pinned to CSS pixels, at the
     same 3px the artwork view and the desktop card use — measured off the reference, where the heart
     ink is a 3px run at every scanline that crosses it perpendicular.
  */
  .bigheart:not(.heart-lit) :global(svg path) {
    vector-effect: non-scaling-stroke;
    stroke-width: 3px;
  }

  .art-zone:hover .bigheart,
  .bigheart:focus-visible {
    transform: scale(1);
  }

  /* The fracture, the fade and the glow all live in app.css under `.heart-breaking` / `.heart-lit`,
     shared with the desktop mini card so the two surfaces cannot drift. */

  /* ---------------- timing + identity ---------------- */
  .meta {
    /* Was `min(420px, 100%)` — narrower than the sleeve it sits under, so the seek row read as a
       separate object instead of the base of the same panel. */
    width: var(--art-meta-w);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--art) * 0.03);
  }

  .timing {
    display: flex;
    align-items: center;
    gap: calc(var(--art) * 0.02);
    width: 100%;
  }

  .t {
    font-size: var(--art-time);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    min-width: calc(var(--art) * 0.075);
  }

  .t.dim {
    color: var(--text-dim);
  }

  /* Thick and white on an accent track, which is the reference's bar. Not the thin accent fill the
     rest of the app uses — this one is deliberately the loudest progress indicator in the app.
     Scaled off the sleeve: a fixed 8px under a 590px cover read as a hairline next to the
     reference's chunky pill. */
  .bar {
    position: relative;
    flex: 1;
    height: var(--art-bar-h);
    border-radius: var(--radius-pill);
    overflow: hidden;
    cursor: pointer;
  }

  .bar:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 3px;
  }

  .bar-rest {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--accent);
    opacity: 0.55;
    transition: background-color 500ms var(--ease-out);
  }

  .bar-played {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: #fff;
  }

  .meta h1 {
    /* 30px against the reference's ~46px on a 590px cover. The negative margins below were tuned to
       the old sizes, so they are now fractions too — otherwise the gap between title, artist and
       provenance stops tracking as the type grows. */
    font-size: var(--art-title);
    font-weight: 800;
    letter-spacing: calc(var(--art) * -0.0014);
    text-align: center;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .meta p {
    margin-top: calc(var(--art) * -0.014);
    font-size: var(--art-artist);
    font-weight: 600;
    color: var(--text-dim);
    text-align: center;
  }

  /* One step below the artist, and centred like everything else in this column. */
  .meta .media {
    margin-top: calc(var(--art) * 0.007);
    font-size: var(--art-media);
    font-weight: 600;
    letter-spacing: 0.2px;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }

  /* The seal sits on the text baseline beside the word rather than replacing it.

     No `color` here, though the comment used to claim it inherited the line's own faint colour while
     the code set `--text-dim` — one step brighter than its own label. The mark has to be exactly the
     colour of the word, and inheriting from `.media` is the only way that cannot drift. */
  .ll {
    display: inline-flex;
    /* `middle` rather than a hand-picked pixel offset: it centres the mark on the text's x-height, so
       it stays put when the size changes instead of needing the constant re-tuned alongside it. */
    vertical-align: middle;
    margin-left: 3px;
  }

  /* ---------------- lyric column ---------------- */
  .lyrics {
    position: relative;
    height: 100%;
    overflow: hidden;
    /* Top-anchored, not centred: the reel is positioned with translateY measured from the reel's own
       top edge, so centring the content first puts an unstated offset under every calculation and
       the active line settles off-centre. */
    padding: 0 8px;
    /* A local pool of shadow under the text column, so the lines do not have to win against the
       brightest patch of the sleeve. Deliberately not a flat rectangle: it is centred where the
       words sit and falls away at both ends, so the cover stays visible at the edges of the half
       instead of being boxed in.
       The geometry has to actually deliver that. A radial gradient here is clipped by this box, so
       any alpha still present at the edge paints as a hard vertical seam against the untinted half
       — at `62% ... at 36%` the edge sat at 58% of the radius, still ~0.20 alpha, and because the
       stops are percentages that step is the same at every window size; only the brightness of the
       cover behind it changes how obvious it is. The transparent stop now falls inside the box at
       both edges, so the pool ends before the box does. */
    background:
      radial-gradient(58% 54% at 50% 50%, rgba(5, 5, 9, 0.5) 0%, rgba(5, 5, 9, 0.22) 56%, transparent 84%);
    mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 14%, #000 86%, transparent);
  }

  .reel {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    /* Clearance at each end, written in px by measure() from the real height of this box — the rule
       it implements is documented on REEL_TOP / REEL_BOTTOM above. The vh fallbacks only cover the
       frame before that runs. */
    padding: var(--reel-top, 20vh) 0 var(--reel-bottom, 22vh);
    /* No transition on transform, on purpose. The reel is positioned every frame by the follow in
       services/lyrics/reelFollow.ts. A transition here would ease toward each frame's value in turn,
       which is how the reel came to trail the words by most of a second. */
    will-change: transform;
  }

  /*
     The waiting indicator: three dots, sized off the reference recording and timed off the standard
     loading-wave pattern.

     Geometry measured with scripts/measure-dots.mjs over the recording at 1918x1078 — 26px dots on a
     38px pitch, rising 16px — scaled here by the sung line's own size (54px against the reference's
     ~57), so 24px on a 36px pitch travelling 15px. The pitch minus the diameter is the 12px gap. The
     reference sits them flush left with its column; ours is centred by an earlier decision, so they are
     centred here too.

     Timing is NOT from the recording. Its dots move one at a time, ~8s per arc, which needs 24s to
     cross all three — longer than most intros last, so it read as a stalled screen rather than a
     waiting one. This is the conventional travelling wave instead: 1.2s at `ease-in-out`, staggered by
     a sixth of it, with the arc at 30% of the cycle and the dot back on the baseline from 60% onward,
     so all three are always in motion and the crest visibly runs left to right.

     The mild `scale` at the crest is the one part of the recording's behaviour worth keeping — its
     dots measured larger at the top of their arc than at the bottom — and it composes with the
     translateY rather than fighting it.
  */
  .waiting {
    position: absolute;
    left: 50%;
    top: calc(var(--reel-top, 20vh) - 38px);
    display: flex;
    gap: 12px;
    transform: translateX(-50%);
    opacity: 0;
    transition: opacity var(--dur-lyric) var(--ease-lyric);
    pointer-events: none;
  }

  .waiting.shown {
    opacity: 1;
  }

  .waiting .dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #fff;
    --wait-rise: -15px;
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

  /*
     The same wave inside an instrumental line. Smaller, because it sits in the column as one row of
     text rather than filling the gap before the first one, and it inherits the line's own colour so the
     depth ramp's opacity and blur reach it the same way they reach words.

     The amplitude is a custom property rather than a second keyframe: `var()` in a keyframe resolves
     against the element being animated, so one set of percentages can serve both sizes.
  */
  .dots {
    display: inline-flex;
    gap: 10px;
    align-items: center;
    vertical-align: middle;
  }

  .line.inst .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: currentColor;
    --wait-rise: -9px;
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
      transform: translateY(var(--wait-rise, -15px)) scale(1.1);
      opacity: 1;
    }
  }

  /* The travel is the whole of it, so without the motion there is nothing left to show — the dots hold
     their positions and stay lit, which still reads as "playing, nothing sung yet". */
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

  .line {
    display: block;
    width: 100%;
    text-align: center;
    /* Scaled by the user's Size setting so the panel's slider resizes the words live. */
    font-size: calc(clamp(26px, 3.2vw, 46px) * var(--lyrics-scale, 1));
    font-weight: 800;
    line-height: 1.22;
    letter-spacing: -0.9px;
    color: #fff;
    cursor: pointer;
    /* Every line carries its own shadow rather than trusting the backdrop to be dark enough. On a
       white or neon sleeve no veil short of black makes bare white text safe, and the shadow is what
       keeps the edge of each letterform readable wherever the cover happens to be bright. */
    text-shadow:
      0 1px 3px rgba(0, 0, 0, 0.72),
      0 3px 22px rgba(0, 0, 0, 0.5);
    /* opacity / blur / scale are set inline from depth(), which is what produces the reference's
       depth of field. Only the size and weight change with state.
       All four on one duration and one curve: they are one event — this line is now the sung one —
       and when the size arrived on a different schedule from the glow the change read as two things
       happening to the text rather than one. */
    transition:
      font-size var(--dur-lyric) var(--ease-lyric),
      opacity var(--dur-lyric) var(--ease-lyric),
      filter var(--dur-lyric) var(--ease-lyric),
      transform var(--dur-lyric) var(--ease-lyric),
      background-color var(--dur-hover) var(--ease-out);
  }

  /*
     The hover pill, from the reference recording.

     A line is a click target — it seeks — and brightening alone never said so. The reference draws a
     soft rounded plate that hugs the words. `fit-content` is what makes it hug the text instead of
     becoming a full-width bar. The column is centred, so the padding is symmetric and needs no
     compensation; it used to carry `margin-left: -14px`, which only made sense while the block was
     flush left and would now slide every plate 14px off its own centre.
  */
  .line {
    width: fit-content;
    max-width: 100%;
    padding: 2px 14px;
    border-radius: 12px;
  }

  .line:hover {
    opacity: 1 !important;
    filter: blur(0) !important;
    background-color: rgba(255, 255, 255, 0.12);
  }

  .line.active {
    /* Multiplied by the Size setting like every other line in the column. This was the one size in
       the file that ignored `--lyrics-scale`, so past ~115% the sung line ended up *smaller* than
       its neighbours and the whole depth ramp inverted. */
    font-size: calc(clamp(32px, 4vw, 54px) * var(--lyrics-scale, 1));
    /* The arrival rides the independent `scale` property rather than `transform`, `opacity` and
       `filter`. Those three are already being transitioned by the rule above for the depth of field,
       and an animation on the same properties does not blend with a transition — it replaces it for
       its whole length and then hands back to whatever the transition had reached. At 320ms against
       a 420ms cross-fade that handback landed a quarter of the way short, so every line visibly
       dropped back at the end of its arrival. `scale` composes with the inline `transform: scale()`
       instead of competing with it. */
    animation: line-arrive var(--dur-lyric) var(--ease-lyric);
    will-change: transform;
  }

  /* Only `scale` moves, so there is nothing here to fall out of step with the resting state that
     `depth(0)` writes inline. The line starts a touch under its size and settles onto it over
     exactly the window the font-size transition is growing through, which makes the two read as one
     motion instead of a size change with a wobble on top. */
  @keyframes line-arrive {
    0% {
      scale: 0.965;
    }
    70% {
      scale: 1.008;
    }
    100% {
      scale: 1;
    }
  }

  /* Reduced motion and Low Power both drop the movement and keep the bloom, because the glow is the
     part that carries meaning — it says "this line, now" — while the scale is the part that can make
     someone ill. A fade-only arrival still marks the change without anyone moving across the screen. */
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
     component CSS, because the `<html>` element carries no scope attribute. Without it Svelte
     reports the rule as an unused selector and Low Power kept the full arrival animation. */
  :global(html[data-low-power]) .line.active {
    animation: line-arrive-reduced 200ms ease-out;
  }

  /*
     Plain lyrics: the same type treatment as the reel, without the depth of field or the fill. Nothing
     in the source says where a line sits in time, so the column just scrolls and every line reads at the
     same weight — which is the honest rendering of level C.
  */
  .static {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 8px 40vh;
    scrollbar-width: thin;
  }

  .static-line {
    text-align: center;
    font-size: calc(clamp(22px, 2.6vw, 34px) * var(--lyrics-scale, 1));
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: -0.7px;
    color: #fff;
    text-shadow:
      0 1px 3px rgba(0, 0, 0, 0.72),
      0 3px 22px rgba(0, 0, 0, 0.5);
  }

  /*
     The line-level replacement for word-by-word highlighting. The gradient is clipped to the
     letterforms and its stop rides `--p`, which is the true fraction of the interval between this
     line's timestamp and the next one's — so it reads like word sync without claiming to know where
     any word starts. The accent band at the leading edge is what makes it a designed effect rather
     than a bar that happens to be half filled.

     Both sides of the band stay readable, but not equal: the unsung remainder sits at 0.5, which is
     still ~9:1 against the darkened backdrop and so never becomes the unreadable line, while being
     clearly behind the sung part. An earlier pass had it at 0.34 (dimmer than the inactive lines
     below it) and the pass before that had both sides near-white, which made the fill invisible.
  */
  .text.sweep {
    /*
       Top-to-bottom, translucent to opaque, white only. Two earlier passes failed here in opposite
       directions: an accent-coloured leading band with a 50%-white tail read as dirty grey metal,
       and before that a flat dim tail made the sung line the least legible text on screen. The tail
       now sits at 0.8 rather than 0.4: still behind the filled part, but never so far back that a
       line spends the first second of being sung looking like grey metal. Progression is carried by
       the white bloom below, not by dimming the words.
    */
    background-image: linear-gradient(
      180deg,
      #fff 0%,
      #fff calc(var(--p) * 100% - 9%),
      rgba(255, 255, 255, 0.92) calc(var(--p) * 100% + 9%),
      rgba(255, 255, 255, 0.92) 100%
    );
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    /* The inherited `.line` shadow must go: `color: transparent` stops the fill painting but not the
       shadow, so it drew a solid black copy of the whole line directly behind the clipped gradient
       and ate it. The shadow for this line is a `drop-shadow` filter, set in depth(). */
    text-shadow: none;
  }

  .word {
    display: inline-block;
    /* A trailing space is trimmed at the edge of an inline-block box, so the gap has to be a
       margin. See BUG-019. */
    margin-right: 0.24em;
    opacity: 0.34;
    transition:
      opacity 200ms linear,
      text-shadow 260ms var(--ease-out);
  }

  .word:last-child {
    margin-right: 0;
  }

  .word.lit {
    opacity: 1;
  }

  /* The word actually being sung carries the glow — that bloom travelling along the line is the
     most recognisable part of the reference. */
  .word.now {
    text-shadow: 0 0 22px rgba(255, 255, 255, 0.85), 0 0 44px rgba(255, 255, 255, 0.4);
  }

  .notice {
    font-size: var(--fs-xl);
    font-weight: 700;
    color: var(--text-dim);
    max-width: 30ch;
  }

  /* With nothing to show, the message and the Find lyrics button were top-anchored and half cut
     off by the edge mask, which made them look like they were fading away. Centre them instead —
     there is no reel to keep clear in this state. */
  .lyrics.hollow {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 4px;
  }

  .lyrics.hollow .notice {
    max-width: 34ch;
  }

  .find {
    margin-top: 18px;
    display: inline-flex;
    align-items: center;
    gap: 9px;
    align-self: center;
    height: 42px;
    padding: 0 20px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.09);
    color: var(--text);
    font-size: var(--fs-md);
    font-weight: 700;
    cursor: pointer;
    transition:
      background-color var(--tap) var(--ease-out),
      border-color var(--tap) var(--ease-out);
  }

  .find:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.4);
  }

  @media (prefers-reduced-motion: reduce) {
    .stage,
    .reel,
    .word {
      animation: none;
      transition: none;
    }
  }
</style>
