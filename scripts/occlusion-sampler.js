// BUG-009 sampler: does playback survive the window being covered?
//
// The original report was a spontaneous `pause` at roughly 7.6s while the window was fully occluded,
// with no error and no position reset. Three Chromium flags have landed since
// (CalculateNativeWinOcclusion disabled, backgrounding and timer throttling disabled), so this
// measures whether the defect is actually gone rather than assuming the flags fixed it.
//
// Run the sampler, and minimise the window from outside while it is polling.
(async () => {
  const { player, engine } = window.__noctra;
  const el = () => engine?.active?.media;
  if (!el()) return { fatal: "no media element" };

  player.playFrom(player.tracks[3].id);
  await new Promise((r) => setTimeout(r, 1500));

  const samples = [];
  let spontaneousPause = null;
  for (let i = 0; i < 24; i++) {
    const a = el();
    samples.push({
      t: i * 5,
      pos: +a.currentTime.toFixed(1),
      paused: a.paused,
      ready: a.readyState,
      vis: document.visibilityState,
      err: a.error ? a.error.code : null,
    });
    if (a.paused && spontaneousPause === null) {
      spontaneousPause = { atSample: i, position: +a.currentTime.toFixed(1) };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const last = samples[samples.length - 1];
  const first = samples[0];
  return {
    verdict: spontaneousPause
      ? `PAUSED at t=${spontaneousPause.atSample * 5}s`
      : "played through ~120s while covered",
    spontaneousPause,
    advancedSeconds: +(last.pos - first.pos).toFixed(1),
    wallSeconds: 115,
    error: last.err,
    samples,
  };
})();
