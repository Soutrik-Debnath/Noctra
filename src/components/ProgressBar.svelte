<script lang="ts">
  /**
   * Seekable progress bar.
   *
   * The fill is sized with `width`. It used to be `transform: scaleX()` on the theory that a scale is
   * composited and a width costs a layout pass — but a scaled fill also scales its own border-radius,
   * which turned the pill into a sharp rectangle at low progress and flattened its glow. The fill is
   * absolutely positioned, so the width change reflows nothing around it. See the `.fill` rule.
   *
   * While dragging, a local `scrub` value drives the display and the seek is committed once on
   * release — seeking on every pointermove would spam the decoder with range requests.
   *
   * Also carries the track's bookmarks. The marks are painted, not clickable:
   * the bar underneath already seeks to whatever x you click, so a mark at 1:12 *is* a jump to 1:12.
   */
  import { formatTime } from "../utils/format";
  import { bookmarks } from "../stores/bookmarks.svelte";
  import { player } from "../stores/player.svelte";

  let {
    position,
    duration,
    showTimes = true,
  }: {
    position: number;
    duration: number;
    showTimes?: boolean;
  } = $props();

  let track = $state<HTMLDivElement | null>(null);
  let scrub = $state<number | null>(null);
  let dragging = $state(false);

  const shown = $derived(scrub ?? position);
  const ratio = $derived(duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0);
  const pct = (s: number) => (duration > 0 ? (s / duration) * 100 : 0);

  const marks = $derived(player.current.id ? bookmarks.for(player.current.id) : []);

  /** Pointer x as a 0..1 position along the rail. A PointerEvent is a MouseEvent, so drags and taps
      on the bar share it. */
  function ratioFromEvent(e: MouseEvent): number {
    if (!track) return 0;
    const r = track.getBoundingClientRect();
    if (r.width === 0) return 0;
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  }

  function onPointerDown(e: PointerEvent) {
    if (!track || duration <= 0) return;
    dragging = true;
    scrub = ratioFromEvent(e) * duration;
    // Throws if the pointer id is no longer valid (fast release, synthetic event). The drag
    // still works via the up/cancel handlers, so this must not break the interaction.
    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    scrub = ratioFromEvent(e) * duration;
  }

  function commit() {
    if (!dragging) return;
    dragging = false;
    if (scrub !== null) player.seek(scrub);
    scrub = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (duration <= 0) return;
    const step = e.key === "PageUp" || e.key === "PageDown" ? 30 : 5;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      player.seek(Math.min(duration, position + step));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      player.seek(Math.max(0, position - step));
    } else if (e.key === "Home") {
      e.preventDefault();
      player.seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      player.seek(duration - 1);
    }
  }
</script>

<div class="bar-row">
  {#if showTimes}
    <span class="time">{formatTime(shown)}</span>
  {/if}

  <div
    bind:this={track}
    class="track"
    class:dragging
    role="slider"
    tabindex="0"
    aria-label="Seek"
    aria-valuemin={0}
    aria-valuemax={Math.round(duration)}
    aria-valuenow={Math.round(shown)}
    aria-valuetext="{formatTime(shown)} of {formatTime(duration)}"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={commit}
    onpointercancel={commit}
    onlostpointercapture={commit}
    onkeydown={onKeyDown}
    oncontextmenu={(e) => e.preventDefault()}
  >
    <div class="fill" style="width: {ratio * 100}%"></div>
    {#each marks as mark (mark.at)}
      <div
        class="mark"
        style="left: {pct(mark.at)}%"
        title="{mark.label || 'Bookmark'} · {formatTime(mark.at)}"
      ></div>
    {/each}
    <div class="head" style="left: {ratio * 100}%"></div>
  </div>

  {#if showTimes}
    <span class="time muted">{formatTime(duration)}</span>
  {/if}
</div>

<style>
  /* Size hooks. Each default is the compact bar the component was built for, because that is where
     it is used most. Now Playing overrides them off its `--art` measure so the seek row scales with
     the cover instead of staying frozen at mini-player size. */
  .bar-row {
    display: flex;
    align-items: center;
    gap: var(--pb-gap, 12px);
    width: 100%;
  }

  .time {
    font-size: var(--pb-time, var(--fs-xs));
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    min-width: var(--pb-time-w, 34px);
    text-align: center;
  }

  .time.muted {
    color: var(--text-faint);
  }

  .track {
    position: relative;
    flex: 1;
    height: var(--pb-hit, 18px);
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none; /* keep a drag on the bar from scrolling the page */
  }

  .track::before {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    height: var(--pb-rail, 7px);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.16);
    box-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.35);
  }

  .fill {
    position: absolute;
    left: 0;
    height: var(--pb-rail, 7px);
    border-radius: var(--radius-pill);
    background: var(--accent);
    /* The glow is what makes the played portion read as lit rather than merely coloured. */
    box-shadow: 0 0 12px -1px rgb(var(--accent-rgb) / 0.8);
    /*
       Sized with `width`, not `transform: scaleX()`.

       A scaled fill squashes its own border-radius by the same factor, so at 5% played the corners
       were 5% of a pill and the bar read as a sharp rectangle — the exact complaint, and invisible at
       100%. Scale also flattened the glow into a sliver. `clip-path` would have kept the compositor
       path but clips the shadow too, and the glow is load-bearing.

       The layout cost is contained: the fill is absolutely positioned, so resizing it reflows nothing
       around it, and there is deliberately no width transition — that is what made the old bar lag.
    */
    transition: background-color 500ms var(--ease-out);
  }

  .track.dragging .fill {
    transition: none;
  }

  /* Centred with `translate` rather than a half-width negative margin so the whole dot can be sized
     from one custom property. */
  .head {
    position: absolute;
    top: 50%;
    width: var(--pb-head, 12px);
    height: var(--pb-head, 12px);
    border-radius: 50%;
    background: #fff;
    opacity: 0;
    translate: -50% -50%;
    transition: opacity 180ms var(--ease-out);
  }

  /* No `:hover` reveal. The fullscreen bar this is meant to match has no thumb at all — the edge of the
     played fill is the readout — so a circle popping up the moment the pointer crossed the bar was both
     a drift from that surface and the only place in the app where hovering drew a shape. It stays
     visible while dragging, where it is reporting the position being set, and on keyboard focus, where
     it is the focus ring. */
  .track.dragging .head,
  .track:focus-visible .head {
    opacity: 1;
  }

  /* The looped span is a band the height of the hit area, not of the 4px rail, so it stays visible
     over both the played and the unplayed half of the bar. */
  /* Bookmarks. Painted only, never clickable: the bar underneath already seeks to the x you press,
     so a second hit target on the same spot would only steal the drag. */
  .mark {
    position: absolute;
    top: 50%;
    width: 2px;
    height: 9px;
    margin-left: -1px;
    transform: translateY(-50%);
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.58);
    pointer-events: none;
  }
</style>
