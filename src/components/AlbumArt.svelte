<script lang="ts">
  /** Large centred cover with rounded corners and a soft accent-tinted shadow. */
  import { fade } from "svelte/transition";

  let {
    src,
    alt = "",
    size = 380,
  }: {
    src: string;
    alt?: string;
    /** A px number for fixed uses, or any CSS length — Now Playing passes `var(--art)` so the
        cover, and every control sized against it, scales with the window. */
    size?: number | string;
  } = $props();

  const len = $derived(typeof size === "number" ? `${size}px` : size);
</script>

<div class="wrap" style="--size: {len}">
  {#key src}
    <img
      class="art"
      {src}
      {alt}
      draggable="false"
      transition:fade={{ duration: 520 }}
    />
  {/key}
</div>

<style>
  .wrap {
    position: relative;
    /* `aspect-ratio` rather than an explicit height. With `height: var(--size)` plus
       `max-width: 100%`, a parent narrower than --size shrank the width but not the height, turning
       the box into a tall rectangle — and `object-fit: cover` then cropped the sides off a square
       cover. Locking the ratio makes that geometrically impossible. */
    width: var(--size);
    max-width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-art);
    /* Shadow is static, not animated — an animated blur radius is a repaint every frame. */
    box-shadow:
      0 26px 64px -18px rgba(0, 0, 0, 0.72),
      0 0 110px -34px rgb(var(--accent-rgb) / 0.62);
    overflow: hidden;
    background: var(--surface-1);
    transition: box-shadow 500ms var(--ease-out);
  }

  /* The specular edge. On an overlay rather than on the wrap itself because `overflow: hidden`
     makes the image paint over an inset shadow. */
  .wrap::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.34);
    pointer-events: none;
  }

  .art {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    /* The `{#key}` above remounts the image on every track change, which restarts this. */
    animation: art-in 620ms var(--ease-out);
    /* A picture is not a control. This matters because the entry animation applies a transform, and a
       transformed element is promoted into its own layer that paints ABOVE later-positioned siblings —
       so on the fullscreen and Now Playing surfaces the artwork was floating over the transport, the
       orb row and the volume rail and swallowing their clicks. Hit testing was the bug; the stacking
       was just what exposed it. */
    pointer-events: none;
  }

  @keyframes art-in {
    from {
      transform: scale(1.035);
    }
    to {
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .art {
      animation: none;
    }
  }
</style>
