// Dev harness: does the gapless preload get enough warning?
//
// Arming is gated on `duration - position > crossfadeSec + 6` in the player store, so with crossfade at
// zero the standby deck only starts loading in the last six seconds. This watches one real transition and
// records when the standby was armed, when it reached HAVE_ENOUGH_DATA, and whether the handoff was clean.
async function main() {
  const { player, engine } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const dur = player.duration;
  if (!(dur > 20)) return { fail: "track too short to test", dur };

  player.seek(Math.max(0, dur - 12));
  const t0 = performance.now();
  const trail = [];
  let armedAt = null;
  let readyAt = null;
  let flipAt = null;
  let bufferStallMs = 0;

  for (let i = 0; i < 200; i++) {
    const el = Math.round(performance.now() - t0);
    const standby = engine.decks.find((d) => d.role !== "active");
    const rs = standby?.media?.readyState ?? 0;
    if (armedAt === null && standby?.loadedSource) armedAt = el;
    if (readyAt === null && armedAt !== null && rs >= 3) readyAt = el;
    if (player.isBuffering) bufferStallMs += 100;
    if (flipAt === null && Math.abs(player.position - 0) < 1.5 && el > 3000) flipAt = el;
    trail.push({
      el,
      rem: Math.round((player.duration - player.position) * 10) / 10,
      armed: !!standby?.loadedSource,
      rs,
      buf: player.isBuffering,
      idx: player.index,
      playing: player.isPlaying,
    });
    if (flipAt !== null && el > (flipAt ?? 0) + 4000) break;
    await wait(100);
  }

  const compact = trail.filter((_, i) => i % 5 === 0);
  return {
    crossfadeSec: engine.crossfadeSec,
    gapless: engine.gapless,
    armedAfterMs: armedAt,
    standbyReadyAfterMs: readyAt,
    preloadToReadyMs: armedAt !== null && readyAt !== null ? readyAt - armedAt : null,
    bufferingSamples: trail.filter((t) => t.buf).length,
    totalSamples: trail.length,
    trackChanged: trail[0].idx !== trail[trail.length - 1].idx,
    tail: compact.slice(-14),
  };
}
main();
