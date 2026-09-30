// Where does every lyric line end up on screen once the follow has settled on it?
//
// Reads the real laid-out column rather than restating the clamp's arithmetic, so a wrong padding
// figure, a wrong mask band or a wrong viewport height all show up as a wrong screen position.
// Run through scripts/cdp-eval.mjs --file.
(() => {
  const vp = document.querySelector(".lyrics");
  const reel = document.querySelector(".reel");
  if (!vp || !reel) return "no reel on screen";

  const lines = [...reel.querySelectorAll(".line")];
  const vb = vp.getBoundingClientRect();
  const H = vp.clientHeight;
  const curY = new DOMMatrix(getComputedStyle(reel).transform).m42 || 0;
  // The reel's top relative to the viewport with the animated transform removed, so a target can be
  // projected onto screen space from any y rather than only from the one currently applied.
  const reelBase = reel.getBoundingClientRect().top - vb.top - curY;
  // A transform does not contribute to scrollHeight, so the column's real length is its own box.
  const travel = Math.max(0, reel.offsetHeight - H);

  const rows = lines.map((el, i) => {
    const b = el.getBoundingClientRect();
    return { i, top: b.top - reel.getBoundingClientRect().top, h: b.height };
  });

  const out = rows.map(({ i, top, h }) => {
    const want = H / 2 - top - h / 2;
    const y = Math.max(-travel, Math.min(0, want));
    const centre = reelBase + top + h / 2 + y;
    return { i, frac: centre / H, at: y === -travel ? "end" : y === 0 ? "start" : "free" };
  });

  const n = out.length;
  const pick = (i) => (out[i] ? { i, pct: Math.round(out[i].frac * 100), at: out[i].at } : null);
  const bands = { start: 0, free: 0, end: 0 };
  for (const o of out) bands[o.at]++;

  return JSON.stringify(
    {
      H,
      travel: Math.round(travel),
      scrollTravel: Math.round(Math.max(0, vp.scrollHeight - H)),
      reelH: reel.offsetHeight,
      lines: n,
      bands,
      head: [0, 1, 2, 3, 5, 8, 11].map(pick),
      mid: [Math.round(n / 2) - 1, Math.round(n / 2), Math.round(n / 2) + 1].map(pick),
      tail: [n - 12, n - 8, n - 5, n - 3, n - 2, n - 1].map(pick),
      minPct: Math.round(Math.min(...out.map((o) => o.frac)) * 100),
      maxPct: Math.round(Math.max(...out.map((o) => o.frac)) * 100),
    },
    null,
    1,
  );
})();
