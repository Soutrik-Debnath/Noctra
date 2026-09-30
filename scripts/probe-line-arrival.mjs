// Watch one line change and record what the sung line's own box does across the arrival.
//
// The defect this checks for: an animation on `transform`/`opacity`/`filter` replaces the transition
// on those same properties for its whole length and then hands back to wherever the transition had
// got to, which is short — so the line visibly dropped back at the end of its arrival. The bloom now
// rides the independent `scale` property, which composes with the inline `transform: scale()` from
// depth() instead of competing with it. Both have to be sampled to see that.
//
// Installs a watcher, resolves once it has caught a change, and returns the trace.
(() => {
  const reel = () => document.querySelector(".reel");
  const linesOf = () => [...reel().querySelectorAll(".line")];
  const start = linesOf().findIndex((l) => l.classList.contains("active"));
  const t0 = performance.now();
  const out = [];

  return new Promise((resolve) => {
    let watching = null;
    function frame(now) {
      const ls = linesOf();
      const act = ls.findIndex((l) => l.classList.contains("active"));
      if (watching === null) {
        if (act !== start && act >= 0) watching = now;
        else if (now - t0 > 20000) return resolve("no line change in 20s");
      }
      if (watching !== null) {
        const el = ls[act];
        const cs = getComputedStyle(el);
        out.push([
          Math.round(now - watching),
          parseFloat(cs.fontSize).toFixed(1),
          cs.scale,
          cs.transform === "none" ? "none" : +new DOMMatrix(cs.transform).a.toFixed(3),
          +Number(cs.opacity).toFixed(3),
          cs.animationName.includes("line-arrive") ? 1 : 0,
          cs.filter.split("(").length - 1,
        ]);
        if (now - watching > 760) return resolve(JSON.stringify({ from: start, to: act, trace: out }));
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
})();
