<script lang="ts">
  /**
   * The Lossless seal, in the owner's own mark.
   *
   * One component because the provenance line exists in two surfaces — the fullscreen now-playing
   * header and the fullscreen lyrics column — and those are separate implementations where shared
   * changes have repeatedly failed to propagate.
   *
   * It is painted through a mask rather than as an `<img>` for one reason: the mark has to be exactly
   * the colour of the word beside it. A mask takes `currentColor`, so it follows the line's colour
   * wherever that goes, and there is no second colour to keep in step.
   *
   * Sized in `em`, not pixels, because the line's size comes from `--art-media`, which scales with the
   * artwork. A fixed height would track the text at one window size and drift at every other.
   */
  import mark from "../assets/lossless-mark.png";

  /**
   * Height as a multiple of the line's font size.
   *
   * Held just under 1em rather than above it: the mark's hairline strokes are ~4-6px wide in the 400px
   * source, so they are already sub-pixel at this size and go from faint to absent as it shrinks. The
   * measured floor is around 0.9em — below that the wave stops reading as a wave.
   */
  let { scale = 0.94 }: { scale?: number } = $props();

  // Source ink box is 400 x 253, trimmed to the artwork so no phantom margin shrinks the glyph.
  const ASPECT = 400 / 253;
</script>

<span
  class="ll-mark"
  aria-hidden="true"
  style="height: {scale}em; width: {(scale * ASPECT).toFixed(3)}em; --mark: url({mark});"
></span>

<style>
  .ll-mark {
    display: inline-block;
    /* `vertical-align: middle` on the wrapper centres the mark on the text's x-height, which is close
       but not exact — measured 1.0px low against the words' own centre. The correction is in `em` so it
       scales with the line rather than going wrong at another artwork size. */
    position: relative;
    top: -0.07em;
    background: currentColor;
    -webkit-mask-image: var(--mark);
    mask-image: var(--mark);
    -webkit-mask-size: contain;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
    -webkit-mask-position: center;
    mask-position: center;
  }
</style>
