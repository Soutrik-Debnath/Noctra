<script lang="ts">
  /**
   * The reference's volume: a capsule of liquid glass that fills solid white, with the speaker glyph
   * sitting *inside* it at the near end rather than beside it, and that glyph is the mute button.
   *
   * Deliberately not the generic `Slider`. That component's whole vocabulary is track + fill + thumb,
   * and this control has no thumb — the edge of the white fill is the readout — and it puts a button
   * inside its own track. Bending `Slider` to that would mean a slot, a mute callback and a
   * hide-the-thumb flag on something the progress bar and the lyrics-offset slider also use.
   *
   * A transparent `<input type=range>` stays in the tree for focus, arrow keys and the accessible
   * value, but it is taken out of the pointer path: it is horizontal regardless of the box it is
   * stretched into, so `sliderPointer` resolves clicks and drags against this capsule's real axis.
   */
  import Icon from "./Icon.svelte";
  import { sliderPointer } from "../utils/sliderPointer";

  let {
    value,
    oninput,
    onmute,
    muted = false,
    label = "Volume",
    orientation = "vertical",
    width = 26,
    height = 120,
  }: {
    value: number;
    oninput: (v: number) => void;
    onmute: () => void;
    muted?: boolean;
    label?: string;
    /** The reference pill is vertical; the bottom bar runs the same capsule along its row. */
    orientation?: "vertical" | "horizontal";
    /** px or any CSS length — the fullscreen surface sizes this off its own `--art` scale. */
    width?: number | string;
    height?: number | string;
  } = $props();

  const len = (v: number | string) => (typeof v === "number" ? `${v}px` : v);
  const horizontal = $derived(orientation === "horizontal");
  const level = $derived(muted ? 0 : Math.max(0, Math.min(1, value)));
  /* The glyph is dark because it normally sits on the white fill. At the bottom of an empty capsule
     there is no fill under it, so the same ink would vanish into the glass. */
  const onGlass = $derived(level < 0.07);

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.01 : 0.04);
    oninput(Math.max(0, Math.min(1, value + delta)));
  }

  /**
   * Created once, reading the props through a getter, so the handlers keep their `dragging` state
   * across renders while still seeing the current orientation and callback.
   */
  const pointer = sliderPointer(() => ({ vertical: !horizontal, oninput }));
</script>

<div
  class="vpill"
  class:h={horizontal}
  style="width: {len(width)}; height: {len(height)}; --vpill-w: {len(width)}; --vpill-h: {len(height)}; --lvl: {level}"
  role="presentation"
  onwheel={onWheel}
  {...pointer}
>
  <span class="vfill"></span>

  <input
    type="range"
    class="vrange"
    min="0"
    max="1"
    step="0.01"
    {value}
    aria-label={label}
    oninput={(e) => oninput(Number(e.currentTarget.value))}
  />

  <button
    class="vspk"
    class:on-glass={onGlass}
    aria-label={muted ? "Unmute" : "Mute"}
    aria-pressed={muted}
    title={muted ? "Unmute" : "Mute"}
    onclick={(e) => {
      e.stopPropagation();
      onmute();
    }}
  >
    <Icon name={muted ? "volume-mute" : "volume"} size={16} />
  </button>
</div>

<style>
  .vpill {
    position: relative;
    border-radius: 999px;
    /* The glass pane. This capsule had been left behind by the liquid-glass work: it was running the
       shallow `--glass-filter-clear` (34px) while every other surface had moved to the deep one, and
       its edge was a single 1px border with two inset shadows — a hairline, which at 27px wide is
       invisible, so the pill read as a flat dark capsule pasted onto the artwork rather than as a
       lens in front of it. Now it takes the same blur and the same four-layer edge as `.glass`:
       rim (the surface line), lens (the refraction band), dispersion (the cool fringe), lip (the
       thickness at the bottom).
       The lens band is 4px, not the panels' 18px. At 20-27px wide a 7px band arriving from both
       sides leaves only a 6px clear core, and the pill started reading as a capsule inside a capsule.
       On an element this narrow the edge has to be a line plus a whisper, not a band. */
    background: var(--glass-fill);
    backdrop-filter: var(--glass-filter);
    -webkit-backdrop-filter: var(--glass-filter);
    border: none;
    /* No --glass-bloom here. That token is a 1px outer ring plus a 30px outer white halo, which is
       right on a full-height panel and wrong on a 22px capsule: the halo spreads further than the
       pill is tall, so it drew a second, larger oval around the control — the "outer oval layer".
       The edge is carried by the inset rim/lens/dispersion/lip instead, and the drop shadow below
       still lifts it off the artwork. */
    box-shadow:
      0 10px 28px -12px rgba(0, 0, 0, 0.62),
      inset 0 0 0 1px var(--glass-rim),
      inset 0 0 4px var(--glass-lens),
      inset 0 0 2px var(--glass-dispersion),
      inset 0 1.5px 0 var(--glass-specular),
      inset 0 -5px 8px -7px var(--glass-lip);
    overflow: hidden;
  }

  .vfill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: calc(var(--lvl) * 100%);
    background: linear-gradient(to top, #fff, #f4f6fa);
    transition: height 110ms linear;
  }

  /* Same capsule turned along the row: fills from the left, so the gradient and the sized axis swap. */
  .vpill.h .vfill {
    top: 0;
    bottom: 0;
    right: auto;
    width: calc(var(--lvl) * 100%);
    height: auto;
    background: linear-gradient(to right, #fff, #f4f6fa);
    transition: width 110ms linear;
  }

  .vrange {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: ns-resize;
    /* Out of the pointer path on purpose. This input is horizontal no matter what box it is stretched
       into, so letting it take the press would map the volume across the capsule's 26px width instead
       of its 132px height. `sliderPointer` resolves the press against the real axis; the element stays
       for focus, arrow keys and the accessible value. */
    pointer-events: none;
  }

  .vpill.h .vrange {
    cursor: ew-resize;
  }

  .vrange::-webkit-slider-thumb {
    appearance: none;
    width: 100%;
    height: 100%;
    background: transparent;
  }

  .vrange:focus-visible {
    outline: none;
  }

  /* Keyboard focus still has to be visible, and the ring goes on the capsule rather than the invisible
     thumb that carries it by default. */
  .vpill:has(.vrange:focus-visible) {
    outline: 2px solid var(--focus-ring, rgba(255, 255, 255, 0.85));
    outline-offset: 3px;
  }

  .vspk {
    position: absolute;
    left: 50%;
    bottom: 5px;
    translate: -50% 0;
    z-index: 2;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: none;
    color: #0c0c11;
    cursor: pointer;
    transition: color 140ms var(--ease-out);
  }

  .vpill.h .vspk {
    left: 6px;
    top: 50%;
    bottom: auto;
    translate: 0 -50%;
  }

  .vspk.on-glass {
    color: rgba(255, 255, 255, 0.92);
  }

  .vspk:hover {
    color: #000;
  }

  .vspk.on-glass:hover {
    color: #fff;
  }

  /* Sized off the capsule's short axis, so the glyph keeps its proportion on every surface. The axis
     swaps with the orientation. CSS beats the svg's width/height presentation attributes. */
  .vpill {
    --vpill-glyph: var(--vpill-w);
  }

  .vpill.h {
    --vpill-glyph: var(--vpill-h);
  }

  .vspk :global(svg) {
    width: calc(var(--vpill-glyph) * 0.56);
    height: calc(var(--vpill-glyph) * 0.56);
  }
</style>
