/**
 * Click-and-drag value control for a slider.
 *
 * A native `<input type=range>` cannot do this job in this app, for two independent reasons. It is
 * laid out horizontally whatever box you stretch it into, so the vertical rails — the fullscreen
 * volume and the mini card's pill — map the pointer across their ~26px *width* instead of their ~130px
 * height, which makes clicking high or low meaningless. And both components size the thumb to fill the
 * control, so Chromium classifies every press as "grabbed the thumb" and suppresses its own
 * click-to-position behaviour. The visible symptom is a rail that answers the wheel but not a click.
 *
 * So the pointer is resolved here, against the element's own bounding box and the axis the component
 * declared. The input stays in the tree with `pointer-events: none`, still carrying focus, arrow keys
 * and the screen-reader value, but no longer competing with this maths.
 */
export function sliderPointer(get: () => { vertical: boolean; oninput: (v: number) => void }) {
  let dragging = false;

  const frac = (e: PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 0;
    const { vertical } = get();
    // Vertical rails fill from the bottom, so distance from the top has to invert.
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.min(1, Math.max(0, f));
  };

  return {
    onpointerdown(e: PointerEvent) {
      // A control may carry its own button inside its bounds — the volume pill's speaker is its mute
      // toggle — and pressing that must not also rewrite the level.
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const el = e.currentTarget as HTMLElement;
      dragging = true;
      // Capture can throw if the pointer has already gone away — a press and release inside the same
      // frame — and a throw here would abandon the value change that was just applied.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* fall back to the element's own listeners */
      }
      get().oninput(frac(e, el));
      // The mini card starts an OS window drag on its own pointerdown. Without stopping the bubble,
      // grabbing the rail would drag the widget across the desktop instead of setting the volume.
      e.preventDefault();
      e.stopPropagation();
    },

    onpointermove(e: PointerEvent) {
      if (!dragging) return;
      get().oninput(frac(e, e.currentTarget as HTMLElement));
    },

    onpointerup(e: PointerEvent) {
      dragging = false;
      const el = e.currentTarget as HTMLElement;
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    },

    onpointercancel() {
      dragging = false;
    },
  };
}
