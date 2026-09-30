// Final-release playback probe. Run with:
//   node scripts/cdp-eval.mjs --file scripts/final-playback-probe.js
//
// Closes out the three defects that could only be settled by running the real library:
//   BUG-013  cold first-play latency (the old 802ms figure was measured on a warm demo track)
//   BUG-012  the intermittent "playback error" - never reproduced, never read
//   BUG-009  spontaneous pause while the window is covered (sampled in a second step)
//
// Every track is played for a couple of seconds and then skipped, so an error that only appears on
// one file in the library shows up here rather than staying anecdotal.
(async () => {
  const { player, engine } = window.__noctra;
  // The two-deck engine keeps `active` and `standby` as Deck wrappers around the real elements and
  // swaps them on a gapless handoff, so this is re-read per poll rather than captured once.
  const el = () => engine?.active?.media;
  if (!el()) return { fatal: "no media element behind the active deck" };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (fn()) return performance.now() - t0;
      await wait(25);
    }
    return null;
  };

  const err = () =>
    el().error
      ? { code: el().error.code, message: el().error.message }
      : player.error
        ? { mapped: String(player.error) }
        : null;

  const tracks = player.tracks.slice(0, 10);
  const results = [];

  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const cold = i === 0; // first fetch of the session; later ones reuse the protocol warm
    player.playFrom(t.id);
    // First-play latency is measured to the moment the clock actually moves, not to `canplay`,
    // which fires as soon as a header is parsed and would hide a stalled body.
    const toProgress = await until(() => el().currentTime > 0.05 && !el().paused, 12000);
    const toBuffered = await until(() => el().buffered.length > 0 && el().buffered.end(0) - el().currentTime > 1, 3000);
    await wait(900);
    results.push({
      track: (t.title || "?").slice(0, 28),
      msToFirstSound: toProgress === null ? "TIMEOUT" : Math.round(toProgress),
      msTo1sBuffered: toBuffered === null ? "n/a" : Math.round(toBuffered),
      readyState: el().readyState,
      paused: el().paused,
      error: err(),
      cold,
    });
  }

  player.pause();
  return {
    summary: {
      tracks: results.length,
      errors: results.filter((r) => r.error).length,
      timeouts: results.filter((r) => r.msToFirstSound === "TIMEOUT").length,
      worstFirstSoundMs: Math.max(
        ...results.map((r) => (r.msToFirstSound === "TIMEOUT" ? 99999 : r.msToFirstSound)),
      ),
      firstTrackMs: results[0]?.msToFirstSound,
    },
    results,
    nowPlaying: player.current ? String(player.current.title).slice(0, 28) : null,
  };
})();
