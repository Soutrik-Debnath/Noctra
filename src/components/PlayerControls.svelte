<script lang="ts">
  /**
   * Transport row.
   *
   * Bare glyphs, not rings — see the `.orb-bare` note in app.css. The only filled control is play,
   * which keeps it the single primary action on the screen.
   *
   * Shuffle and repeat are real: they drive the play order in the player store and persist.
   */
  import Icon from "./Icon.svelte";
  import { player } from "../stores/player.svelte";
  import { openRepeatMenu } from "../services/repeatMenu";
  import { replay } from "../utils/replay";

  let { compact = false }: { compact?: boolean } = $props();

  /** Durations must match the keyframes in app.css, plus the ~90ms the rAF re-arm costs before the
      first keyframe lands. Cutting the hold short strips the class mid-animation. */
  const CROSS_MS = 420;
  const TURN_MS = 500;
  let cross = $state(false);
  let turn = $state(false);

  function toggleShuffle() {
    player.shuffle = !player.shuffle;
    replay("shuffle", (on) => (cross = on), CROSS_MS);
  }

  function cycleRepeat() {
    player.cycleRepeat();
    replay("repeat", (on) => (turn = on), TURN_MS);
  }
</script>

<div class="transport cluster" class:compact>
  <button
    class="orb orb-bare"
    class:orb-on={player.shuffle}
    title={player.shuffle ? "Shuffle is on" : "Shuffle"}
    aria-label="Shuffle"
    aria-pressed={player.shuffle}
    onclick={toggleShuffle}
  >
    <Icon name="shuffle" class={cross ? "shuffle-cross" : ""} />
  </button>

  <button class="orb orb-bare" title="Previous" aria-label="Previous track" onclick={() => player.previous()}>
    <Icon name="skipBack" />
  </button>

  <button
    class="orb orb-primary"
    title={player.isPlaying ? "Pause" : "Play"}
    aria-label={player.isPlaying ? "Pause" : "Play"}
    aria-pressed={player.isPlaying}
    onclick={() => player.toggle()}
  >
    <Icon name={player.isPlaying ? "pause" : "play"} />
  </button>

  <button class="orb orb-bare" title="Next" aria-label="Next track" onclick={() => player.next()}>
    <Icon name="skipForward" />
  </button>

  <button
    class="orb orb-bare"
    class:orb-on={player.repeat !== "off"}
    class:one={player.repeat === "one"}
    class:orb-times={player.repeat === "times"}
    data-times={player.repeat === "times" ? `×${player.repeatTimes}` : undefined}
    title={
      player.repeat === "off"
        ? "Repeat off — right-click for options"
        : player.repeat === "all"
          ? "Repeating the queue — right-click for options"
          : player.repeat === "one"
            ? "Repeating this track — right-click for options"
            : `Playing each track ${player.repeatTimes} times — right-click for options`
    }
    aria-label="Repeat"
    aria-pressed={player.repeat !== "off"}
    onclick={cycleRepeat}
    oncontextmenu={openRepeatMenu}
  >
    <Icon
      name={player.repeat === "one" ? "repeat-one" : "repeat"}
      class={turn ? "repeat-turn" : ""}
    />
  </button>
</div>

<style>
  /* Named `transport`, not `row`. `controls.css` defines a global `.row:hover` for list rows, and
     because that sheet is unscoped it was painting a large rounded rectangle behind this whole
     cluster whenever the pointer came near the transport.

     Every size is a variable, and that is the fix for a complaint that kept coming back: the
     transport hardcoded its px per call site, so the fullscreen could not scale with the artwork
     even when everything around it did. Now Playing sets these on its `.inart` wrapper.

     The defaults are therefore written as `var(--x, default)` at each use site and NOT declared on
     `.transport` — a declaration here would shadow the inherited value from the parent and the
     parent could never win, which is exactly what the first attempt at this did. */
  .transport {
    display: flex;
    align-items: center;
    /* The row stretches to fill the bar's centre column, so without this the buttons pack against
       that column's left edge and the whole transport sits left of the window's middle. */
    justify-content: center;
    gap: var(--pc-gap, 10px);
  }

  .transport :global(.orb-bare) {
    --orb-size: var(--pc-tap, 52px);
  }

  .transport :global(.orb-primary) {
    --orb-size: var(--pc-disc, 58px);
  }

  /* The glyph inside each hit box. Ordered by position because the row is always exactly these
     five buttons, and the two pairs genuinely are the same control weight. */
  .transport > :nth-child(1) :global(svg),
  .transport > :nth-child(5) :global(svg) {
    width: var(--pc-aux, 20px);
    height: var(--pc-aux, 20px);
  }

  .transport > :nth-child(2) :global(svg),
  .transport > :nth-child(4) :global(svg) {
    width: var(--pc-skip, 24px);
    height: var(--pc-skip, 24px);
  }

  .transport > :nth-child(3) :global(svg) {
    width: var(--pc-play, 28px);
    height: var(--pc-play, 28px);
  }

  /* The mini-player bar. A leaf context, so declaring here is safe — nothing above it needs to
     override these.

     Play is deliberately the largest glyph on the row, not the largest hit box. It was previously
     the smallest of the three media glyphs (23 against the skips' 24, and 19 against 20 here),
     which read as the primary control being weaker than its neighbours once its disc was removed.
     A filled triangle also carries less visual weight than a stroked mark at the same size, so the
     bump is partly compensation rather than simply making it the biggest thing on the row. */
  .transport.compact {
    /*
       Glyphs raised to the same 20 / 24 / 28 scale the fullscreen view and Now Playing use, because the
       bar was the only surface still drawing 17 / 20 / 24 — it read as a shrunken screenshot of the real
       player rather than the same player in a shorter row. The hit boxes stay smaller than fullscreen's
       52 / 58, which is correct for a 90px bar: the marks grow, the disc does not have to.

       Boxes are set to glyph + 20 wherever the token allows, so each glyph carries the same 10px of
       padding and the optical gap between neighbours is `4 + 10 + 10` all the way down the row. With one
       shared `--pc-tap` the aux pair sits at 12px rather than 10, which is a 2px difference across a
       240px row and the limit of what two tokens can do.

       Play then went 28 → 34 and the disc 48 → 52 to copy the fullscreen's hierarchy rather than just
       its glyph sizes. Absolute px cannot match across surfaces a fifth and a half apart in scale, so
       what is matched is the RATIO: the sleeve draws play ÷ skip = 1.40, and 34 ÷ 24 is 1.42. At 28 ÷ 24
       the bar's primary control still read as only marginally stronger than its neighbours. The aux pair
       stays at 20 instead of dropping to the sleeve's 0.66 × skip, because it had already been raised off
       17 once and shrinking it back would undo that; the hierarchy is exact where the user asked for it
       and compressed only on the least important pair.
    */
    --pc-tap: 46px;
    --pc-disc: 52px;
    --pc-aux: 20px;
    --pc-skip: 24px;
    --pc-play: 34px;
    --pc-gap: 4px;
  }
</style>
