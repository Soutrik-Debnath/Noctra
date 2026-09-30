// Sample the reel's transform every frame while it travels to a clicked line.
//
// The old CSS transition measured its target once, while the column was still animating font size, so
// the reel glided to a stale position and was yanked on the next line. What has to be true now: the
// samples are monotonic, they never pass the target, the last sample equals the resting target, and
// there is no discontinuity at the hand-off where the arrival animation gives back to the transition.
(() => {
  const reel = document.querySelector(".reel");
  const lines = [...reel.querySelectorAll(".line")];
  const at = Number(globalThis.__probeTarget ?? 8);
  const el = lines[at];
  if (!el) return "no line " + at;

  const yOf = () => new DOMMatrix(getComputedStyle(reel).transform).m42 || 0;
  const samples = [];
  const t0 = performance.now();

  return new Promise((resolve) => {
    function frame(now) {
      samples.push([Math.round(now - t0), +yOf().toFixed(2)]);
      if (now - t0 < 1400) requestAnimationFrame(frame);
      else {
        const ys = samples.map((s) => s[1]);
        const rest = ys[ys.length - 1];
        let reversals = 0;
        let backSteps = 0;
        for (let i = 2; i < ys.length; i++) {
          const a = ys[i - 1] - ys[i - 2];
          const b = ys[i] - ys[i - 1];
          if (a * b < 0 && Math.abs(b) > 0.4) backSteps++;
          if (Math.abs(b) > 0.01) reversals++;
        }
        const biggest = Math.max(
          ...ys.slice(1).map((v, i) => Math.abs(v - ys[i])),
        );
        resolve(
          JSON.stringify({
            clicked: at,
            text: el.textContent.slice(0, 24),
            from: ys[0],
            to: rest,
            frames: samples.length,
            // Any frame that moves backwards by more than a rounding error.
            backSteps,
            // The largest single-frame step, in px: a yank shows up here, not in the endpoints.
            biggestStep: +biggest.toFixed(2),
            overshoot: ys.some((v) => (rest < ys[0] ? v < rest - 0.5 : v > rest + 0.5)),
            settledAt: samples.find((s, i) => i > 4 && Math.abs(s[1] - rest) < 0.4)?.[0] ?? null,
            every8: samples.filter((_, i) => i % 8 === 0),
          }),
        );
      }
    }
    requestAnimationFrame(frame);
    el.click();
  });
})();
