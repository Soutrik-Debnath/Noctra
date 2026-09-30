/**
 * Probe: does the entrance cascade pin `transform` forever?
 *
 * `.stagger > *` in controls.css runs `animation: rise ... both`. `rise` declares only a `from`
 * keyframe, so the 100% keyframe is implicit and taken from the element's underlying value
 * (`transform: none`). With forward fill still applied after the entrance finishes, that implicit
 * keyframe keeps winning the cascade: animation declarations outrank normal author declarations, so
 * `.mcard:active { transform: scale(0.97) }` and `.artist:hover { transform: translateY(-3px) }`
 * would both be inert on every staggered card — no transition could fix it.
 *
 * The test is to write an inline `transform` (an author declaration, same origin as the hover rules)
 * and read back what the element actually computes to. If the inline value survives, the animation is
 * not pinning anything and the hover/active transforms are live. If it comes back `none`, they are dead.
 *
 * Run: node scripts/cdp-eval.mjs --file scripts/probe-stagger-fill.mjs
 */
(async () => {
  const out = [];

  function test(el, label) {
    if (!el) return out.push({ label, present: false });
    const cs = getComputedStyle(el);
    const before = {
      animationName: cs.animationName,
      animationFillMode: cs.animationFillMode,
      transform: cs.transform,
      opacity: cs.opacity,
    };
    // Animations that are still filled show up here even after they have finished playing.
    const anims = el.getAnimations().map((a) => ({
      name: a.animationName || "(anon)",
      state: a.playState,
      fill: getComputedStyle(a.effect.target).animationFillMode,
      currentTime: a.currentTime,
    }));

    const prevTransform = el.style.transform;
    const prevOpacity = el.style.opacity;
    el.style.transform = "scale(0.97)";
    el.style.opacity = "0.5";
    const during = {
      transform: getComputedStyle(el).transform,
      opacity: getComputedStyle(el).opacity,
    };
    el.style.transform = prevTransform;
    el.style.opacity = prevOpacity;

    const m = new DOMMatrix(during.transform === "none" ? "" : during.transform);
    out.push({
      label,
      present: true,
      ...before,
      filledAnimations: anims,
      inlineTransformHonoured: Math.abs(m.a - 0.97) < 0.001,
      inlineOpacityHonoured: Math.abs(parseFloat(during.opacity) - 0.5) < 0.001,
      during,
    });
  }

  test(document.querySelector(".stagger > .mcard"), "stagger > .mcard");
  test(document.querySelector(".stagger > .artist"), "stagger > .artist");
  // A card outside any stagger, as the control case.
  const all = [...document.querySelectorAll(".mcard")];
  test(
    all.find((el) => !el.closest(".stagger")) || null,
    ".mcard outside .stagger (control)"
  );
  test(document.querySelector(".btn-primary"), ".btn-primary");

  /*
   * `backwards` still has to do the one job `both` was carrying: hold an item at the `from` keyframe
   * during its animation-delay so it does not flash in early. HMR does not re-run the entrance, so
   * this builds a fresh stagger and samples it across the delay window and past the end.
   */
  const host = document.createElement("div");
  host.className = "stagger";
  host.style.cssText = "position:fixed;left:-9999px;top:0";
  const kids = [0, 1, 2].map(() => {
    const d = document.createElement("div");
    d.textContent = "x";
    host.appendChild(d);
    return d;
  });
  document.body.appendChild(host);
  const t0 = performance.now();
  const entrance = [];
  const want = [0, 40, 120, 400, 700, 900];
  let i = 0;
  while (i < want.length) {
    const at = performance.now() - t0;
    if (at >= want[i]) {
      entrance.push({
        at: Math.round(at),
        // nth-child(1) has no delay, (2) 34ms, (3) 68ms.
        opacities: kids.map((k) => +getComputedStyle(k).opacity),
        transforms: kids.map((k) => getComputedStyle(k).transform),
      });
      i++;
    } else {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  host.remove();

  return { view: location.pathname, out, entrance };
})();
