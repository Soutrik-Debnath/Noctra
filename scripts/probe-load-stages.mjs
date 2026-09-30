// Dev harness: split the ~13s cold-load into stages, so the delay can be attributed.
//
// Records when the media element is given a src, when the network state moves, when each readyState
// threshold is crossed, and when the clock starts. A delay before `src` is set is app code; a delay
// after it is the protocol, the demuxer or the network.
async function main() {
  const { player, engine } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = (list) => player.tracks.filter((x) => x.source).slice(0, 2).map((x) => x.id);
  const ids = t();
  if (!ids.length) return { fail: "no sources" };

  const runs = [];
  for (const id of ids) {
    const t0 = performance.now();
    const mark = {};
    const note = (k) => { if (mark[k] === undefined) mark[k] = Math.round(performance.now() - t0); };

    player.playFrom(id, player.tracks);
    let m = null;
    for (let i = 0; i < 200; i++) {
      m = engine.active?.media ?? null;
      if (m) {
        note("deckExists");
        if (m.currentSrc) note("srcSet");
        if (m.networkState === 2) note("netLoading");
        if (m.readyState >= 1) note("rs1_metadata");
        if (m.readyState >= 2) note("rs2_currentData");
        if (m.readyState >= 3) note("rs3_enough");
        if (m.readyState >= 4) note("rs4_complete");
        if (m.buffered.length && m.buffered.end(0) - m.buffered.start(0) > 5) note("buffered5s");
        if (m.currentTime > 0.25) note("clockRunning");
      }
      if (mark.clockRunning !== undefined) break;
      await wait(50);
    }
    runs.push({
      title: player.current?.title?.slice(0, 24),
      src: (m?.currentSrc || "").slice(-34),
      dur: m?.duration ?? null,
      ...mark,
    });
    player.pause();
    await wait(500);
  }
  return { runs, note: "times are ms from playFrom()" };
}
main();
