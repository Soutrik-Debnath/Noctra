// Dev harness: how long does a cold track load actually take, start to audible?
//
// Answers "why is buffering taking so much". For each track: call playFrom, then poll until the media
// element both has data (readyState >= 3) and its clock has actually advanced, which is the point the
// user hears sound. `isBuffering` samples are kept separately so a stall mid-load is visible.
async function main() {
  const { player, engine } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // `source` is resolved onto the full Track, not the stored row, so this must read player.tracks.
  const tracks = (player.tracks || []).filter((t) => t.source).slice(0, 4);
  const ids = tracks.map((t) => t.id);
  if (!ids.length) return { fail: "no tracks with a source", n: (player.tracks || []).length };

  const runs = [];
  for (const id of ids) {
    const before = player.current?.id;
    const t0 = performance.now();
    let firstDataMs = null;
    let audibleMs = null;
    let bufSamples = 0;

    player.playFrom(id, tracks);
    const startMedia = () => engine.active?.media;

    for (let i = 0; i < 120; i++) {
      const el = performance.now() - t0;
      const m = startMedia();
      if (!m) { await wait(100); continue; }
      if (firstDataMs === null && m.readyState >= 3) firstDataMs = el;
      if (m.currentTime > 0.25 && audibleMs === null && firstDataMs !== null) audibleMs = el;
      if (player.isBuffering) bufSamples++;
      if (audibleMs !== null) break;
      await wait(100);
    }

    runs.push({
      title: player.current?.title?.slice(0, 26),
      switched: before !== player.current?.id,
      readyState3Ms: firstDataMs === null ? null : Math.round(firstDataMs),
      audibleMs: audibleMs === null ? null : Math.round(audibleMs),
      bufferingSamples: bufSamples,
    });
    player.pause();
    await wait(600);
  }
  player.pause();
  return { runs, crossfadeSec: engine.crossfadeSec, gapless: engine.gapless };
}
main();
