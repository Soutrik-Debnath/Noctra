<script lang="ts">
  /**
   * A media tile whose hover light comes from its own artwork.
   *
   * Exists because the same card is needed in four places — Home's album grid, the Albums page and
   * the Artists page — and the per-cover colour, the ink choice and the glow are three things that go
   * badly wrong when copied. The ink in particular is not a constant: the theme's `--on-accent` is a
   * fixed near-black that only works on a tuned accent, and a cover's own accent is untuned.
   */
  import Icon from "./Icon.svelte";
  import { getAccent, inkFor } from "../services/artwork/palette";

  let {
    art,
    title,
    subtitle = "",
    chip = "",
    round = false,
    showPlay = true,
    onclick,
  }: {
    art: string;
    title: string;
    subtitle?: string;
    /** A pill under the label instead of plain text — Home's artist row shows a play count. */
    chip?: string;
    /** Circular art and a centred label, for artists. */
    round?: boolean;
    /** The play mark is decorative — the card itself is the control. */
    showPlay?: boolean;
    onclick: () => void;
  } = $props();

  let accent = $state("");
  let seen = $state(false);

  /*
     Resolved when the tile comes near the viewport, not when the page mounts.

     The Albums page is every album in the library — well over a hundred covers — and each one needs a
     canvas scan to find its colour. Doing that up front decodes the whole library to tint tiles that
     are off screen. `getAccent` caches by URL, so scrolling back is free.
  */
  function watch(node: HTMLElement) {
    const io = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          seen = true;
          obs.disconnect();
          break;
        }
      },
      { rootMargin: "240px" },
    );
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }

  $effect(() => {
    if (!seen || !art) return;
    let live = true;
    void getAccent(art).then((c) => {
      if (live) accent = c;
    });
    return () => {
      live = false;
    };
  });
</script>

<button
  class="mcard"
  class:round
  use:watch
  style={`--card-accent-rgb: ${accent || "184 148 108"}; --card-ink: ${inkFor(accent || undefined)}`}
  {onclick}
  aria-label={title}
>
  <span class="art" style={`background-image: url(${art})`}>
    {#if showPlay && !round}
      <span class="play"><Icon name="play" size={16} /></span>
    {/if}
  </span>
  <span class="title">{title}</span>
  {#if chip}<span class="chip">{chip}</span>{/if}
  {#if subtitle}<span class="sub">{subtitle}</span>{/if}
</button>

<style>
  .mcard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
    padding: 2px;
    border-radius: 12px;
    /* The `:active` scale below had no transition to ride, so every album, artist and playlist tile
       snapped to 0.97 and snapped straight back. `--tap` is the same 140ms every other press in the
       app uses (`.btn`, `.row`); a tile is not a different gesture from a button. */
    transition: transform var(--tap) var(--ease-out);
    /* Always defined, even before the palette resolves. `box-shadow` is a shorthand, so a single
       unresolved `var()` inside it invalidates the whole declaration at computed-value time and the
       tile would lose its ordinary drop shadow too, not just the glow. */
    --card-accent-rgb: 184 148 108;
    /*
       Do not add `content-visibility` here to make the 267-tile Albums facet cheaper. It implies paint
       containment, which clips this element's subtree to its own box — and the art's glow is a
       descendant's ink that reaches ~60px past that box. The result on Artists tiles was a circular
       halo drawn inside a rectangle, with the top severed outright because the card's top edge sits
       two pixels above the art. The lazy palette resolution in the script is what keeps the facet
       affordable; this is not.
    */
  }

  .mcard:active {
    transform: scale(0.97);
  }

  /* The halo reaches about 60px past the art, which is well into the 18px gap and the neighbouring
     tile. Without this the later tile in DOM order paints over the light and the glow looks cut on
     one side. */
  .mcard:hover,
  .mcard:focus-within {
    z-index: 2;
  }

  .art {
    position: relative;
    display: block;
    aspect-ratio: 1;
    border-radius: var(--radius-card);
    background-size: cover;
    background-position: center;
    box-shadow:
      0 10px 26px -10px rgba(0, 0, 0, 0.6),
      inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    transition:
      transform 220ms var(--ease-out),
      box-shadow 200ms ease;
  }

  /*
     The cover's own colour, lit from behind.

     Three layers, escalating in reach and dropping in alpha: a 2px full-strength ring so the tile has
     an unmistakable lit edge, a tight bright halo that carries the hue right where the eye is, and a
     wider wash that stops short of the next tile. The previous version reached 64px at low alpha, which
     on the square tiles was almost entirely swallowed by the 18px gap between covers — a glow you cannot
     see is not subtle, it is absent. Shorter and stronger reads as light.
  */
  .mcard:hover .art,
  .mcard:focus-visible .art {
    transform: translateY(-4px);
    box-shadow:
      0 18px 36px -10px rgba(0, 0, 0, 0.7),
      0 0 0 2px rgb(var(--card-accent-rgb) / 1),
      0 0 18px 2px rgb(var(--card-accent-rgb) / 0.85),
      0 0 42px 8px rgb(var(--card-accent-rgb) / 0.42);
  }

  .play {
    position: absolute;
    left: 9px;
    bottom: 9px;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: rgb(var(--card-accent-rgb));
    color: var(--card-ink);
    box-shadow:
      0 8px 20px -6px rgba(0, 0, 0, 0.7),
      0 0 0 1.5px rgb(255, 255, 255 / 0.14),
      0 0 20px 1px rgb(var(--card-accent-rgb) / 0.75);
    opacity: 0;
    transform: translateY(8px) scale(0.9);
    transition:
      opacity 200ms var(--ease-out),
      transform 220ms var(--ease-spring);
  }

  .mcard:hover .play,
  .mcard:focus-visible .play {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .title {
    font-size: var(--fs-base);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin-top: -4px;
    font-size: var(--fs-sm);
    font-weight: 500;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Artists are circular and centred, and carry no play mark. */
  .mcard.round {
    align-items: center;
    text-align: center;
    width: 128px;
  }

  .mcard.round .art {
    width: 108px;
    height: 108px;
    aspect-ratio: auto;
    border-radius: 50%;
  }

  /*
     `align-items: center` makes the label's cross-size shrink-to-fit, so a long artist name sized the
     box to the text and the ellipsis above had nothing to clip against — "Charlie Puth; Selena Gomez;
     Atif Aslam" ran straight over its neighbour. The percentage resolves against the card's content
     box (128px less the 2px padding), which is the width the glow is already scoped to.
  */
  .mcard.round :is(.title, .sub) {
    max-width: 100%;
  }

  /* Home's artist row had this at --fs-base and it is the tuned one; the Library artists facet picked
     it up a size larger, which is the same label weight as the album titles. */
  .mcard.round .title {
    font-size: var(--fs-base);
  }

  /* Reduced motion drops the lift and keeps the light: the glow is what carries the hover, and it is
     not movement. */
  @media (prefers-reduced-motion: reduce) {
    .mcard:hover .art,
    .mcard:focus-visible .art,
    .play,
    .mcard:hover .play,
    .mcard:focus-visible .play {
      transform: none;
    }
  }
</style>
