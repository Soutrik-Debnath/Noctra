/**
 * Probe: does a `filter` transition interpolate when the two lists have different shapes?
 *
 * The lyric reel's active line carries `blur(0) drop-shadow() drop-shadow() drop-shadow()` and every
 * other line carries a bare `blur(Npx)`. If mismatched function lists are discrete — which is what
 * the filter-effects spec calls for — then the glow does not fade in, it flips at the halfway point
 * of the transition. That would be the "sloppy and cheap" highlight, and the fix is to keep the same
 * number of functions at every depth. Measured rather than assumed, in the live webview.
 *
 * Run: node scripts/cdp-eval.mjs --file scripts/probe-filter-interp.mjs
 */
(async () => {
const SAMPLES = [30, 90, 150, 190, 210, 250, 330, 430];

async function run(name, from, to) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-9999px;top:0";
  const el = document.createElement("span");
  el.textContent = "probe";
  el.style.cssText = `font:800 40px system-ui;color:#fff;transition:filter 400ms linear;filter:${from}`;
  host.appendChild(el);
  document.body.appendChild(host);

  // Force the start value to be committed before the end value is written, or there is no transition.
  void getComputedStyle(el).filter;
  const t0 = performance.now();
  el.style.filter = to;

  const out = [];
  let i = 0;
  while (i < SAMPLES.length) {
    const at = performance.now() - t0;
    if (at >= SAMPLES[i]) {
      out.push({ at: Math.round(at), filter: getComputedStyle(el).filter });
      i++;
    } else {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }
  host.remove();
  const distinct = new Set(out.map((o) => o.filter)).size;
  return { name, distinctValues: distinct, out };
}

const BARE = "blur(1.67px)";
const FULL =
  "blur(0px) drop-shadow(0 1px 2px rgba(0,0,0,0.8)) drop-shadow(0 0 12px rgba(255,255,255,0.22)) drop-shadow(0 5px 20px rgba(0,0,0,0.55))";
const ZERO =
  "blur(1.67px) drop-shadow(0 1px 2px rgba(0,0,0,0)) drop-shadow(0 0 12px rgba(255,255,255,0)) drop-shadow(0 5px 20px rgba(0,0,0,0))";
const TWO_A = "blur(1.67px) drop-shadow(0 0 12px rgba(255,255,255,0))";
const TWO_B = "blur(0px) drop-shadow(0 0 12px rgba(255,255,255,0.22))";

return {
  mismatched_1_vs_4: await run("bare blur -> blur + 3 drop-shadows (today)", BARE, FULL),
  matched_4_vs_4: await run("4 functions -> same 4 functions", ZERO, FULL),
  matched_2_vs_2: await run("2 functions -> same 2 functions", TWO_A, TWO_B),
};
})();
