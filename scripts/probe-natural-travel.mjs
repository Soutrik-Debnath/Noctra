// Sample the reel across a *natural* line change — the song advancing on its own, not a click.
//
// probe-reel-travel.mjs clicks a line, which seeks; a seek arms the follow's jump path and can cover
// a long distance at once. The complaint this has to answer is about the ordinary case: one line
// ending and the next beginning while the audio plays. What has to be true is that the reel covers a
// short distance monotonically, with no frame that moves it backwards and no step so large it reads
// as a yank.
//
// Run through scripts/cdp-eval.mjs --file.
(() => {
  const vp = document.querySelector(".lyrics");
  const yOf = () => {
    // Re-queried every frame: a node captured once goes detached the moment Svelte rebuilds the
    // column for a new track, and getComputedStyle on a detached element returns an empty style,
    // which DOMMatrix turns into identity. That reads as a perfectly still reel.
    const r = document.querySelector(".reel");
    return r ? new DOMMatrix(getComputedStyle(r).transform).m42 || 0 : NaN;
  };
  const activeOf = () =>
    [...document.querySelectorAll(".reel .line")].findIndex((l) => l.classList.contains("active"));

  const start = activeOf();
  const samples = [];
  let t0 = 0;
  let changed = 0;

  return new Promise((resolve) => {
    function arm(now) {
      const a = activeOf();
      if (a === start || a < 0) {
        if (now - (t0 || now) > 25000) return resolve(JSON.stringify({ error: "no line change in 25s" }));
        if (!t0) t0 = now;
        return requestAnimationFrame(arm);
      }
      changed = a;
      t0 = performance.now();
      requestAnimationFrame(record);
    }
    function record(now) {
      samples.push([Math.round(now - t0), +yOf().toFixed(2)]);
      if (now - t0 < 1500) requestAnimationFrame(record);
      else {
        const ys = samples.map((s) => s[1]);
        const rest = ys[ys.length - 1];
        const from = ys[0];
        let backSteps = 0;
        for (let i = 2; i < ys.length; i++) {
          const a = ys[i - 1] - ys[i - 2];
          const b = ys[i] - ys[i - 1];
          if (a * b < 0 && Math.abs(b) > 0.4) backSteps++;
        }
        const biggest = Math.max(...ys.slice(1).map((v, i) => Math.abs(v - ys[i])));
        const overshoot = ys.some((v) => (rest < from ? v < rest - 0.5 : v > rest + 0.5));
        const settledAt = samples.find((s, i) => i > 4 && Math.abs(s[1] - rest) < 0.4)?.[0] ?? null;
        resolve(
          JSON.stringify({
            fromIndex: start,
            toIndex: changed,
            from,
            to: rest,
            distance: +Math.abs(rest - from).toFixed(2),
            frames: samples.length,
            backSteps,
            biggestStep: +biggest.toFixed(2),
            overshoot,
            settledAt,
            every6: samples.filter((_, i) => i % 6 === 0),
          }),
        );
      }
    }
    requestAnimationFrame(arm);
  });
})();
