<script lang="ts">
  /**
   * A styled range input.
   *
   * The visible track, fill and thumb are three divs; the actual `<input type=range>` sits on top
   * fully transparent for keyboard control and screen-reader semantics, but out of the pointer path.
   * Presses are resolved by `sliderPointer` against the declared axis, because a native range input is
   * horizontal no matter what box it is stretched into and so cannot drive the vertical rails.
   *
   * The wheel is handled here rather than at each call site because "scroll over the volume to
   * change it" is something people try on every slider in the app, not just the volume one.
   */
  import { sliderPointer } from "../utils/sliderPointer";

  let {
    value,
    oninput,
    label,
    vertical = false,
    width = 120,
    height = 120,
    step = 0.01,
    glass = false,
  }: {
    value: number;
    oninput: (v: number) => void;
    label: string;
    vertical?: boolean;
    /** px numbers for fixed uses, or any CSS length so a parent can size the rail off its own
        scale variable (the fullscreen volume rail does). */
    width?: number | string;
    height?: number | string;
    step?: number;
    /** Frosted channel instead of a solid accent fill, for sliders sitting on artwork. */
    glass?: boolean;
  } = $props();

  const pointer = sliderPointer(() => ({ vertical, oninput }));

  const pct = () => Math.max(0, Math.min(1, value)) * 100;
  const len = (v: number | string) => (typeof v === "number" ? `${v}px` : v);

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const delta = (e.deltaY > 0 ? -1 : 1) * (e.shiftKey ? 0.01 : 0.04);
    // Always through `oninput`, never straight at the player store. The wheel used to write
    // `player.setVolume()` itself while dragging wrote through `oninput`, so the two paths
    // disagreed: in the desktop mini card — a separate webview with its own store and no audio
    // element — the wheel mutated a local copy and nothing happened to playback. Every volume call
    // site already routes `oninput` to the store, so the special case was pure duplication.
    oninput(Math.max(0, Math.min(1, value + delta)));
  }
</script>

<div
  class="slider"
  class:slider-v={vertical}
  class:slider-glass={glass}
  style={vertical ? `height: ${len(height)}` : `width: ${len(width)}`}
  onwheel={onWheel}
  {...pointer}
>
  <span class="slider-track"></span>
  {#if vertical}
    <span class="slider-fill" style="height: {pct()}%"></span>
    <span class="slider-thumb" style="bottom: calc({pct()}% - 6.5px); top: auto"></span>
  {:else}
    <span class="slider-fill" style="width: {pct()}%"></span>
    <span class="slider-thumb" style="left: {pct()}%"></span>
  {/if}
  <input
    type="range"
    min="0"
    max="1"
    {step}
    {value}
    aria-label={label}
    oninput={(e) => oninput(Number(e.currentTarget.value))}
  />
</div>
