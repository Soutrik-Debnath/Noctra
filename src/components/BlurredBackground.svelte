<script lang="ts">
  /**
   * Full-window album-art backdrop.
   *
   * Two stacked layers, newest on top. When the track changes a new layer is appended and fades
   * in over the previous one, giving a cross-fade without ever holding two live blurs — the
   * blur itself is computed once and cached by the artwork service.
   *
   * Motion is `transform` only. No `filter`, no animated `box-shadow`, nothing that repaints.
   */
  import { getBlurredArtwork } from "../services/artwork/blur";

  let { src }: { src: string } = $props();

  type Layer = { id: number; src: string; url: string };
  let layers = $state<Layer[]>([]);
  let veil = $state(0.36);
  let seq = 0;

  $effect(() => {
    const wanted = src;
    if (layers.some((l) => l.src === wanted)) return;

    const id = seq++;
    getBlurredArtwork(wanted)
      .then(({ url, luminance, raw }) => {
        // Resolve into the list only if this track is still the one we asked about.
        layers = [...layers, { id, src: wanted, url }].slice(-2);
        // A brighter backdrop needs a thicker veil or every label on top of it loses the fight.
        // The floor keeps dark covers from going muddy, which was BUG-004. The ceiling is high on
        // purpose: vibrancy comes from chroma in the blur pass, never from lifting this, so a bright
        // orange or white sleeve can be saturated *and* readable instead of forcing a choice.
        veil = Math.min(0.62, Math.max(0.3, 0.3 + luminance * 0.62));
        // The cover's own brightness, before any correction, decides whether controls sitting on top
        // of the artwork need light or dark ink. A white sleeve makes white glyphs vanish.
        document.documentElement.toggleAttribute("data-art-light", raw > 0.55);
      })
      .catch(() => {
        /* No artwork: the flat --bg underneath is the intended fallback. */
      });
  });
</script>

<div class="backdrop" aria-hidden="true">
  <div class="orbit">
    {#each layers as layer (layer.id)}
      <div class="layer" style="background-image: url({layer.url})"></div>
    {/each}
  </div>
  <div class="veil" style="--veil: {veil}"></div>
  <!-- Accent-tinted bloom. `screen` is additive — it *adds* light, which is exactly what made a
     bright cover unreadable. `soft-light` skews the existing pixels toward the accent hue without
     raising their luminance, so the window still reads as coloured rather than grey. Static
     gradient over an already-cached bitmap, so it costs nothing per frame. -->
  <div class="bloom"></div>
  <div class="dim"></div>
  <div class="scrim"></div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: -1;
    overflow: hidden;
    background: var(--bg);
  }

  /*
     The artwork turns slowly underneath every overlay.

     Two decisions worth the explanation. It rotates continuously rather than oscillating because an
     `alternate` direction has to stop, reverse and visibly turnaround, and on a heavily blurred
     image that stall reads as a stutter — a constant 360° has no seam. And the wrapper is a square
     of 150vmax because that is the smallest square guaranteed to still cover the window at any
     angle and any aspect ratio: the viewport diagonal is at most √2·max(vw,vh) ≈ 141vmax.

     The rotation lives on this wrapper rather than on each layer so that a cross-fade between two
     tracks turns them together — two layers animating from different start times would dissolve
     between two different angles — and because it costs one composited transform, not one per layer.
  */
  .orbit {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 150vmax;
    height: 150vmax;
    margin: -75vmax 0 0 -75vmax;
    animation: orbit 190s linear infinite;
    will-change: transform;
  }

  @keyframes orbit {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .layer {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    opacity: 0;
    animation:
      appear var(--fade-track) var(--ease-out) forwards,
      breathe 44s ease-in-out infinite alternate;
    will-change: transform, opacity;
  }

  @keyframes appear {
    to {
      opacity: 1;
    }
  }

  /* The second, slower axis. Rotation alone would look mechanical; a long push in and out and a
     lateral sway on a different period means the two never repeat in step, so the backdrop drifts
     like something lit rather than like a clock. */
  @keyframes breathe {
    from {
      transform: scale(1.02) translate3d(-1.4%, 1%, 0);
    }
    to {
      transform: scale(1.14) translate3d(1.4%, -1%, 0);
    }
  }

  /*
     The flat floor under everything. The scrim below is directional and deliberately leaves the
     centre clear, which is fine for Now Playing but not for a Library list whose rows run straight
     through the middle of the window. This is the part that guarantees a minimum contrast ratio
     everywhere, and it is the part that scales with how bright the cover turned out to be.
  */
  .veil {
    position: absolute;
    inset: 0;
    background-color: rgba(5, 5, 9, var(--veil));
    transition: background-color var(--fade-track) var(--ease-out);
  }

  /*
     Fullscreen lyrics puts text on the right half and nothing but artwork on the left, so a flat
     veil is the wrong shape: it has to be heavy where the words are and is only costing colour where
     it does not need to be. This skews the same total darkness to the right, which is what lets the
     sleeve stay vivid behind the cover while the lyric column keeps its contrast.
  */
  :global(html[data-lyrics-view]) .veil {
    background-color: transparent;
    background-image: linear-gradient(
      to right,
      rgba(5, 5, 9, calc(var(--veil) * 0.4)) 0%,
      rgba(5, 5, 9, calc(var(--veil) * 0.72)) 40%,
      rgba(5, 5, 9, var(--veil)) 66%,
      rgba(5, 5, 9, var(--veil)) 100%
    );
  }

  .bloom {
    position: absolute;
    inset: -12%;
    mix-blend-mode: soft-light;
    opacity: 0.55;
    background:
      radial-gradient(58% 52% at 22% 18%, rgb(var(--accent-rgb) / 0.9) 0%, transparent 68%),
      radial-gradient(64% 58% at 82% 78%, rgb(var(--accent-rgb) / 0.75) 0%, transparent 70%);
    transition: opacity var(--fade-track) var(--ease-out);
  }

  /*
     Fullscreen lyrics is a wall of large text over the one surface that is always the current
     sleeve, so the additive wash has to go — but so does the colour, which is the other thing the
     owner asks for. `color` is the blend mode that resolves that: it takes the hue *and* chroma of
     the layer and keeps the luminance of what is underneath, so it can saturate without brightening.
     Confined to the left half, where the artwork is and no text ever sits.
  */
  :global(html[data-lyrics-view]) .bloom {
    mix-blend-mode: color;
    opacity: 0.55;
    background: radial-gradient(58% 74% at 20% 50%, rgb(var(--accent-rgb) / 0.95) 0%, transparent 66%);
  }

  /* The user's own dial on top of the automatic veil, so a cover that still fights the text can be
     pushed down without anyone waiting on a release. */
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(5, 5, 9, var(--backdrop-dim));
  }

  /*
     Readability without washing out the art. On top of the veil, this darkens where text actually
     sits — the bottom band and the outer edges — and leaves the centre comparatively vivid so the
     cover still reads as the source of the colour.
  */
  .scrim {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(to top, rgba(5, 5, 9, 0.72) 0%, rgba(5, 5, 9, 0.3) 26%, transparent 52%),
      radial-gradient(125% 105% at 50% 42%, transparent 34%, rgba(5, 5, 9, 0.5) 100%),
      linear-gradient(to bottom, rgba(6, 6, 10, 0.34), transparent 34%);
  }

  @media (prefers-reduced-motion: reduce) {
    .orbit {
      animation: none;
    }
    .layer {
      animation: appear var(--fade-track) var(--ease-out) forwards;
    }
  }

  /* The orbit and the breathe are the only things in this app that animate continuously, so killing
     them is most of what Low Power is worth. `data-low-power` is set on <html> by the settings
     store. */
  :global(html[data-low-power]) :is(.orbit, .layer) {
    animation: none;
  }

  :global(html[data-low-power]) .layer {
    animation: appear var(--fade-track) var(--ease-out) forwards;
  }
</style>
