// Does a natural track transition actually crossfade? Spec §4 asks for this to be observed rather
// than reasoned about, so it drives one real end-of-track handoff and samples both decks.
//
//   node scripts/cdp-eval.mjs --file scripts/crossfade-probe.js
(async () => {
  const { player, engine, settings } = window.__noctra;
  const el = (d) => d?.media || null;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  settings.value.gapless = true;
  settings.value.crossfadeSec = 5;
  player.setGapless?.(true);
  engine.setGapless(true);
  engine.crossfadeTo(5);

  const t = player.tracks.find((x) => x.duration > 60) || player.tracks[0];
  player.playFrom(t.id);
  await wait(2500);

  const dur = engine.active?.media?.duration || t.duration || 0;
  if (!Number.isFinite(dur) || dur < 20) return { fatal: "no usable duration", dur };
  engine.active.media.currentTime = Math.max(0, dur - 9);

  const trace = [];
  let swapAt = null;
  const started = performance.now();
  const firstTitle = String(player.current?.title || "");

  while (performance.now() - started < 15000) {
    const a = el(engine.active), b = el(engine.standby);
    const title = String(player.current?.title || "");
    if (!swapAt && title && title !== firstTitle) swapAt = +((performance.now() - started) / 1000).toFixed(2);
    trace.push({
      t: +((performance.now() - started) / 1000).toFixed(2),
      aVol: a ? +a.volume.toFixed(3) : null,
      aPos: a ? +a.currentTime.toFixed(2) : null,
      aPaused: a ? a.paused : null,
      bVol: b ? +b.volume.toFixed(3) : null,
      bPos: b ? +b.currentTime.toFixed(2) : null,
      bReady: !!b && b.readyState >= 3,
      fading: !!engine.isFading,
      title: title.slice(0, 18),
    });
    await wait(120);
  }

  const after = swapAt ? trace.filter((r) => r.t >= swapAt) : [];
  const bothAudible = trace.filter((r) => r.aVol > 0.02 && r.bVol > 0.02).length;
  const totalSilence = trace.filter((r) => (r.aVol ?? 0) <= 0.02 && (r.bVol ?? 0) <= 0.02).length;

  return {
    track: firstTitle.slice(0, 28),
    duration: +dur.toFixed(1),
    swapped: !!swapAt,
    swapAtSec: swapAt,
    samples: trace.length,
    overlappingSamples: bothAudible,
    silentSamples: totalSilence,
    everFading: trace.some((r) => r.fading),
    /** the ramp is only real if the new deck climbs from ~0 and the old one falls to ~0 */
    postSwap: after.length
      ? {
          count: after.length,
          incomingVols: after.map((r) => r.aVol),
          outgoingVols: after.map((r) => r.bVol),
          outgoingStillPlaying: after.filter((r) => r.bPaused === false).length,
        }
      : "no swap observed",
  };
})();
