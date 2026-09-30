<script lang="ts">
  /**
   * Now Playing, laid out to match the reference fullscreen:
   *   - the artwork alone, with nothing on it
   *   - hovering the artwork fades in a row of thin circular orbs across the top, the transport
     inside its bottom edge, and the favourite + vertical volume down the right
   *   - elapsed time, progress and total time directly under the artwork
   *   - title and artist centred beneath that
   *
   * The blurred backdrop is mounted at app level so it can cross-fade independently of this view.
   */
  import AlbumArt from "../components/AlbumArt.svelte";
  import Icon from "../components/Icon.svelte";
  import LosslessMark from "../components/LosslessMark.svelte";
  import PlayerControls from "../components/PlayerControls.svelte";
  import ProgressBar from "../components/ProgressBar.svelte";
  import VolumePill from "../components/VolumePill.svelte";
  import { player } from "../stores/player.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { ui } from "../stores/ui.svelte";
  import { isLossless, mediaLine } from "../data/track";
  import { albumTrackCount } from "../services/collections";

  const isFavorite = $derived(player.current ? favorites.has(player.current.id) : false);
  /** Drives the one-shot pop. Only ever set on the way into the favourites list. */
  let pop = $state(false);
  /** "Alternative · 2015 · 2 tracks · Lossless" — empty when the tags carry nothing to say. */
  const media = $derived(
    player.current ? mediaLine(player.current, albumTrackCount(player.tracks, player.current)) : "",
  );
  /** The seal beside the word, only for files that actually carry a lossless stream. */
  const lossless = $derived(player.current.id ? isLossless(player.current) : false);
</script>

<section class="now">
  <div class="art-zone">
    <AlbumArt src={player.current.artwork} alt={player.current.album} size="var(--art)" />

    <!--
      The favourite is the centrepiece of the sleeve, not a small control parked on the side rail.
      Held at roughly two fifths of the artwork because that is the proportion the reference uses,
      and at that size the outline has to be thinned — `stroke-width` scales with the viewBox, so the
      2.15 tuned for a 24px glyph becomes a heavy rope at 168px.
    -->
    <button
      class="love"
      class:lit={isFavorite}
      class:heart-pop-lg={pop}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorite}
      onclick={() => {
        const id = player.current?.id;
        if (!id) return;
        if (!isFavorite) {
          pop = true;
          setTimeout(() => (pop = false), 540);
        }
        favorites.toggle(id);
      }}
    >
      <Icon name={isFavorite ? "heart-filled" : "heart"} />
    </button>

    <!-- Everything below is hover-only, exactly as in the reference: no artwork clutter until the
         pointer asks for it. `visibility` rather than opacity alone so the hidden controls leave
         the tab order too (BUG-005). -->
    <div class="orbs cluster">
      <button
        class="orb"
        class:active={ui.view === "lyrics"}
        title="Lyrics"
        aria-label="Lyrics"
        onclick={() => ui.set("lyrics")}
      >
        <Icon name="lyrics" />
      </button>
      <button
        class="orb"
        title="Fullscreen lyrics"
        aria-label="Fullscreen lyrics"
        onclick={() => ui.set("lyrics")}
      >
        <Icon name="expand" />
      </button>
      <button class="orb" title="Library" aria-label="Library" onclick={() => ui.set("library")}>
        <Icon name="library" />
      </button>
      <button class="orb" title="Collapse" aria-label="Collapse" onclick={() => ui.set("home")}>
        <Icon name="close" />
      </button>
    </div>

    <div class="inart">
      <PlayerControls />
    </div>

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

  {#if player.error}
    <p class="error" role="alert">{player.error}</p>
  {:else if player.isBuffering}
    <p class="buffering">{player.hasStarted ? "Buffering…" : "Starting audio…"}</p>
  {/if}

  <div class="under">
    <ProgressBar position={player.position} duration={player.duration} />
    <header class="identity">
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
    </header>
  </div>
</section>

<style>
  /*
     ONE MEASURE, EVERYTHING ELSE A FRACTION OF IT.

     This view used to size the cover at a fixed 420px and every control at its own fixed px, which
     is why "make the controls bigger" kept coming back: growing the window grew nothing, and
     raising the cover left the buttons behind, so the icons got *relatively* smaller every time the
     art was enlarged. Now the artwork is the only length on this view that is not derived, and the
     factors below are measured off the reference against its own cover (590px in that capture):

       heart 50% · top ring 8.8% · its glyph 4.2% · play glyph 8.1% · skips 9.2% · shuffle/repeat
       5.4% · volume rail 32% tall · seek row 94% wide · title 8.8% · artist 5.1% · time 4.1%

     Change `--art` and the whole screen scales together, at any window size.
  */
  .now {
    /* 52vh, not 56: the seek row under the cover has to fit too, and at 56 the artwork was pushed up
       against the window's top edge on a 900px-tall screen. The line clamps below are what make this
       predictable — without them a long artist credit wraps to three lines and the whole column
       overflows by however much that particular album's players happen to be.

       The 700 cap is shared with the lyrics view on purpose. The two views are a pair the owner toggles
       between constantly, so any difference in this measure shows up as the sleeve resizing under them
       when nothing else moved. */
    --art: clamp(320px, min(52vh, 40vw), 700px);
    --art-heart: calc(var(--art) * 0.8);
    --art-ring: calc(var(--art) * 0.088);
    --art-ring-ico: calc(var(--art) * 0.042);
    --art-tap: calc(var(--art) * 0.15);
    --art-disc: calc(var(--art) * 0.158);
    /* Play is the largest glyph on the row by design, sitting about a fifth above the skips. It was
       previously below them (0.081 against 0.092), which made the primary control read as the
       weakest once its disc was removed. A filled triangle carries less weight than a stroked mark
       at equal size, so some of this is compensation rather than emphasis. */
    --art-play: calc(var(--art) * 0.102);
    --art-skip: calc(var(--art) * 0.073);
    --art-aux: calc(var(--art) * 0.048);
    --art-gap: calc(var(--art) * 0.017);
    /* Matched to Lyrics.svelte value for value. These two views are the same screen with the lyrics
       column swapped in, and every previous round of sizing was done to one of them separately, which
       is how they drifted a full third apart (0.088 here against 0.07 there). */
    --art-title: calc(var(--art) * 0.058);
    --art-artist: calc(var(--art) * 0.036);
    --art-media: calc(var(--art) * 0.028);
    --art-time: calc(var(--art) * 0.034);
    --art-rail: calc(var(--art) * 0.024);

    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--art) * 0.045);
    padding: 32px var(--gutter) 20px;
  }

  .art-zone {
    position: relative;
    flex: none;
  }

  /* ---------- the four hover-revealed groups ---------- */
  /*
     `z-index` here is a hit-test fix, not a paint order preference.

     The heart is deliberately sleeve-sized (`--art-heart`, 0.8 of the cover) but it is a real
     `<button>`, so its square box spans the orb row at the top, the transport at the bottom and the
     volume rail at the right. Left unlayered it sits above all three and every pointer over those
     controls landed on the heart instead — which is why each orb reported "Add to favorites" on
     hover and clicking one toggled the favourite. The controls take the higher layer; the heart keeps
     the whole remaining surface of the sleeve. `.love` declares its own lower value below.
  */
  .orbs,
  .inart,
  .side,
  .love {
    position: absolute;
    z-index: 3;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 240ms var(--ease-out),
      transform 240ms var(--ease-out),
      visibility 0s linear 240ms;
  }

  .art-zone:hover :is(.orbs, .inart, .side, .love),
  .art-zone :is(.orbs, .inart, .side, .love):focus-within {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transition:
      opacity 240ms var(--ease-out),
      transform 240ms var(--ease-out),
      visibility 0s;
  }

  /*
     Centred on the sleeve, and scaled — not translated — on the way in, so it grows out of the
     artwork rather than sliding down onto it. The centring lives in the `translate` property
     specifically so `transform` is free for the reveal scale and for `heart-pop-lg`; if centring and
     popping both wrote `transform`, the pop would throw the heart off-centre mid-animation.
  */
  /*
     The heart is not on the controls' clock.

     Frame-stepping the reference recording shows the orb row and the transport arriving almost
     immediately when the pointer enters the artwork, while the heart is still faint a second later and
     only reaches full white at about 1.5–2s. It blooms. Giving it the shared 240ms reveal — which is
     the right speed for something you are about to click — is what made ours read as a switch flipping
     rather than the reference's slow bloom.

     The asymmetry is deliberate: the slow duration is declared on the hovered state, so it governs the
     fade *in*, and the base state governs the fade *out* at a fast 380ms. A heart that lingers over the
     cover after the pointer has left is worse than one that arrives gradually.
  */
  .love {
    left: 50%;
    top: 47%;
    z-index: 2;
    translate: -50% -50%;
    display: grid;
    place-items: center;
    color: rgba(255, 255, 255, 0.92);
    transform: scale(0.84);
    filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.62));
    transition:
      opacity 380ms var(--ease-out),
      transform 240ms var(--ease-out),
      color 200ms var(--ease-out),
      filter 240ms var(--ease-out),
      visibility 0s linear 380ms;
  }

  .art-zone:hover .love,
  .love:focus-within {
    transform: scale(1);
    transition:
      opacity 1500ms var(--ease-out) 120ms,
      transform 240ms var(--ease-out),
      color 200ms var(--ease-out),
      filter 240ms var(--ease-out),
      visibility 0s;
  }

  .love:hover:not(:disabled) {
    transform: scale(1.06);
    color: #fff;
    filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.62)) drop-shadow(0 0 26px rgba(255, 255, 255, 0.4));
  }

  .love:active:not(:disabled) {
    transform: scale(0.95);
  }

  /* White with a white bloom, matching `.heart-lit` in app.css and the reference. This view kept
     its own copy of the liked colour, so when the sleeve heart went white this one would otherwise
     have stayed red and the two fullscreen surfaces would disagree. */
  .love.lit {
    color: #fff;
    filter: drop-shadow(0 4px 20px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 30px rgba(255, 255, 255, 0.45));
  }

  /* Sized off the art rather than a `size` prop, so the heart grows with the sleeve. */
  .love :global(svg) {
    width: var(--art-heart);
    height: var(--art-heart);
  }

  /*
     `vector-effect` is a graphics-element property. Declared on the `<svg>` container it is inert,
     which is what left this stroke scaling with the viewBox: at half the cover the 24-unit box is
     magnified about 9x, so a weight tuned for a 24px glyph rendered as a ~20px rope. It has to sit
     on the <path> for `stroke-width` to mean CSS pixels and stay a hairline at every sleeve size.
  */
  .love :global(svg path) {
    vector-effect: non-scaling-stroke;
    stroke-width: 4px;
  }

  .orbs {
    top: calc(var(--art) * 0.034);
    left: 50%;
    display: flex;
    gap: var(--art-gap);
    transform: translate(-50%, calc(var(--art) * -0.017));
  }

  .orbs :global(.orb) {
    --orb-size: var(--art-ring);
    border-width: max(1px, calc(var(--art) * 0.0026));
  }

  .orbs :global(svg) {
    width: var(--art-ring-ico);
    height: var(--art-ring-ico);
  }

  .art-zone:hover .orbs,
  .orbs:focus-within {
    transform: translate(-50%, 0);
  }

  .inart {
    left: 0;
    right: 0;
    bottom: calc(var(--art) * 0.045);
    display: flex;
    justify-content: center;
    transform: translateY(calc(var(--art) * 0.014));
    /* Hands the transport its sizes. `PlayerControls` owns the shapes; this view owns the scale,
       because the only sensible ruler for a control sitting on a cover is the cover. */
    --pc-tap: var(--art-tap);
    --pc-disc: var(--art-disc);
    --pc-aux: var(--art-aux);
    --pc-skip: var(--art-skip);
    --pc-play: var(--art-play);
    --pc-gap: calc(var(--art) * 0.022);
    /* Keeps the bare glyphs legible over a light stretch of cover without adding a plate behind
       each one. */
    filter: drop-shadow(0 2px 12px rgba(0, 0, 0, 0.6));
  }

  .art-zone:hover .inart,
  .inart:focus-within {
    transform: translateY(0);
  }

  /* The reference puts the volume rail *inside* the sleeve, at its vertical middle — not outside
     the right edge and anchored to the bottom, which is where it had drifted to. Centring rides on
     `translate` so `transform` stays free for the reveal slide, same as the heart. */
  .side {
    right: calc(var(--art) * 0.045);
    top: 50%;
    translate: 0 -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--art) * 0.024);
    transform: translateX(calc(var(--art) * 0.014));
  }

  .art-zone:hover .side,
  .side:focus-within {
    transform: translateX(0);
  }

  /* ---------- under the artwork ---------- */
  .under {
    width: min(calc(var(--art) * 0.94), 100%);
    display: flex;
    flex-direction: column;
    gap: calc(var(--art) * 0.024);
    /* The seek row is `ProgressBar`, shared with the mini-player bar, so it is handed its scale
       through the same kind of hook the transport uses. */
    --pb-gap: calc(var(--art) * 0.022);
    --pb-time: var(--art-time);
    --pb-time-w: calc(var(--art) * 0.075);
    --pb-hit: calc(var(--art) * 0.05);
    --pb-rail: var(--art-rail);
    --pb-head: calc(var(--art) * 0.026);
    --pb-chip: calc(var(--art) * 0.05);
    --pb-chip-fs: calc(var(--art) * 0.024);
  }

  .identity {
    text-align: center;
  }

  /* Clamped so the column under the cover has a fixed maximum height. Everything on this view is
     sized off `--art`, so an unbounded text wrap was the one thing that could still push the
     artwork into the window's top edge — and it did, on album-length artist credits. */
  .identity h1 {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--art-title);
    font-weight: 700;
    letter-spacing: -0.4px;
    line-height: 1.15;
  }

  .identity p {
    margin-top: calc(var(--art) * 0.01);
    font-size: var(--art-artist);
    font-weight: 500;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Provenance, not identity: one step quieter than the artist line and set in tabular figures so
     the year and the track count do not shuffle horizontally as tracks change. */
  .identity .media {
    margin-top: calc(var(--art) * 0.012);
    font-size: var(--art-media);
    font-weight: 600;
    letter-spacing: 0.2px;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }

  /* Same seal treatment as the fullscreen view: on the baseline beside the word, inheriting the
     line's colour so it reads as metadata rather than as a badge asking to be noticed. */
  /* No `color` here on purpose. The seal has to be exactly the colour of the word beside it, and the
     word is `.media`'s own `--text-faint` — this used to set `--text-dim`, which made the mark sit a
     step brighter than its own label. Inheriting is the only way that cannot drift. */
  .ll {
    display: inline-flex;
    /* `middle` rather than a hand-picked pixel offset: it centres the mark on the text's x-height, so
       it stays put when the size changes instead of needing the constant re-tuned alongside it. */
    vertical-align: middle;
    margin-left: 3px;
  }

  .error {
    max-width: 560px;
    padding: 10px 16px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-base);
    text-align: center;
    color: #ffb3b8;
    background: rgba(232, 121, 127, 0.14);
    border: 1px solid rgba(232, 121, 127, 0.34);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .buffering {
    font-size: var(--fs-xs);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--text-faint);
  }
</style>
