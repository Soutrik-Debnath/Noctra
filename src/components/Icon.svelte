<script lang="ts">
  /**
   * One icon set for the whole app. The geometry lives in `icons.ts`.
   *
   * The transport is filled and everything else is stroked at 2.15. Both numbers are deliberate:
   * thin strokes at 18px read as underfed next to a solid play triangle, which is why the media
   * glyphs are drawn solid.
   *
   * `weight="fill"` asks for the solid form of a glyph, used to mark the active nav item. It resolves
   * in that order: the app's own tuned solid from `icons.ts`, then a generated Phosphor body from
   * `solid.ts`, then the outline as it stands. Own-solid first because the heart is traced from the
   * owner's own reference and must not be replaced by a generic one.
   */
  import { filled, paths, type IconName } from "./icons";
  import { solid, SOLID_VIEWBOX } from "./solid";

  /*
     Phosphor draws to the edges of its 256 grid; this set's hand-authored glyphs keep a margin. At
     the same box the Fill house measured 0.750 x 0.781 of its viewBox against the original outline's
     0.708 x 0.675, so the active nav item read ~16% taller than its neighbours — a size change where
     the whole point was a weight change. 0.9 brings the ink back in line (0.675 x 0.703).
  */
  const SOLID_OPTICAL_SCALE = 0.9;

  let {
    name,
    size = 22,
    weight = "line",
    class: klass = "",
  }: { name: IconName; size?: number; weight?: "line" | "fill"; class?: string } = $props();

  const ownSolid = $derived(
    weight === "fill" ? (filled as Record<string, string[]>)[`${name}-filled`] : undefined,
  );
  const rawSolid = $derived(!ownSolid && weight === "fill" ? solid[name] : undefined);
  const solidShape = $derived(!!ownSolid || !!rawSolid);

  const shapes = $derived(
    ownSolid ??
      (paths as Record<string, string[]>)[name] ??
      (filled as Record<string, string[]>)[name] ??
      [],
  );
  const isFilled = $derived(solidShape || name in filled);

  /*
     Line-based glyphs (the mixer, the playlist rows) have no solid form to step to, so their weight
     change is a heavier stroke. 2.7 on a 24 grid is the point where the difference is legible at the
     sidebar's 19px without the notches closing up — the same threshold that made a gear unusable here.
  */
  const ACTIVE_STROKE = 2.7;
  const strokeWidth = $derived(
    isFilled ? "none" : weight === "fill" ? ACTIVE_STROKE : 2.15,
  );

  // Widen the viewBox rather than shrinking the element: the box stays exactly `size` so the row
  // layout never shifts when an item becomes active, and only the ink gets smaller.
  const viewBox = $derived.by(() => {
    if (!rawSolid) return "0 0 24 24";
    const grid = Number(SOLID_VIEWBOX.split(" ")[2]);
    const side = grid / SOLID_OPTICAL_SCALE;
    const off = (side - grid) / 2;
    return `${-off} ${-off} ${side} ${side}`;
  });
</script>

<svg
  class={klass}
  width={size}
  height={size}
  viewBox={viewBox}
  fill={isFilled ? "currentColor" : "none"}
  stroke={isFilled ? "none" : "currentColor"}
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if rawSolid}
    {@html rawSolid}
  {:else}
    {#each shapes as d, i (d)}
      <!-- Indexed so a single sub-path can be animated on its own. Only the mixer uses this today:
           its knobs are individual closed paths, so `knob-slide` in app.css moves them without
           touching the tracks they ride on. -->
      <path {d} class={`p${i}`} />
    {/each}
  {/if}
</svg>
