// What does the handoff decision actually see? The engine keeps its inputs on private fields that
// are all readable at runtime, so this samples them through one transition instead of inferring the
// branch from the audio.
//
//   node scripts/cdp-eval.mjs --file scripts/handoff-trace.js
(async () => {
  const { player, engine, settings } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  settings.value.gapless = true;
  settings.value.crossfadeSec = 5;
  engine.setGapless(true);
  engine.crossfadeTo(5);

  // Queue a following track explicitly: with nothing up next there is no second deck to arm, and a
  // probe that forgets that measures "no crossfade" for the wrong reason.
  const a = player.tracks.find((x) => (x.duration || 0) > 90);
  const b = player.tracks.find((x) => x.id !== a.id && (x.duration || 0) > 60);
  player.playFrom(a.id);
  await wait(2000);
  player.enqueue ? player.enqueue(b.id) : player.addToQueue?.(b.id);
  await wait(500);

  const dur = engine.active.media.duration;
  engine.active.media.currentTime = Math.max(0, dur - 9);

  const rows = [];
  const started = performance.now();
  const firstTitle = String(player.current?.title || "");
  while (performance.now() - started < 14000) {
    const title = String(player.current?.title || "");
    rows.push({
      rem: +(dur - engine.active.media.currentTime).toFixed(2),
      ps: engine.pendingSource ? "set" : "NULL",
      ls: engine.standby?.loadedSource ? "set" : "none",
      stReady: !!engine.standby?.ready,
      armed: engine.standby?.loadedSource !== null,
      fading: !!engine.isFading,
      ramp: !!engine.rampTimer,
      fadeSec: engine.fadeSeconds,
      aVol: +engine.active.media.volume.toFixed(2),
      bVol: engine.standby?.media ? +engine.standby.media.volume.toFixed(2) : null,
      swapped: title !== firstTitle,
    });
    await wait(150);
    if (rows.some((r) => r.swapped) && rows.filter((r) => r.swapped).length > 25) break;
  }

  const firstSwap = rows.findIndex((r) => r.swapped);
  return {
    queueHadNext: !!player.queue?.length,
    trackA: firstTitle.slice(0, 22),
    rows: rows.length,
    // the window just before the flip is where the branch is decided
    beforeFlip: rows.slice(Math.max(0, firstSwap - 6), firstSwap),
    atFlip: rows.slice(firstSwap, firstSwap + 4),
    everArmed: rows.some((r) => r.armed),
    everPending: rows.some((r) => r.ps === "set"),
    everFading: rows.some((r) => r.fading),
    minARemainingSeen: Math.min(...rows.map((r) => r.rem)),
  };
})();
