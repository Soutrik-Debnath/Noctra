// Dev harness: does the standby deck reach "ready" BEFORE the boundary now?
//
// The lead window used to be `crossfadeSec + 6`, which with crossfade off gave 6s against a measured
// 9-12s cold load — arming could not finish in time. This parks the playcard 30s from the end and
// records when the standby armed, when it became ready, and whether the handoff had to wait.
async function main() {
  const { player, engine } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const dur = player.duration;
  if (!(dur > 60)) return { fail: "need a track longer than 60s", dur, title: player.current?.title };
  if (!player.isPlaying) player.play ? player.play() : engine.play(player.current.source);

  player.seek(dur - 30);
  const startIdx = player.index;
  const standby = () => engine.decks.find((d) => d !== engine.active);

  let armedAtRem = null;
  let readyAtRem = null;
  let flipBuffering = null;
  const log = [];

  for (let i = 0; i < 400; i++) {
    const rem = player.duration - player.position;
    const s = standby();
    const loaded = !!s?.loadedSource;
    const rs = s?.media?.readyState ?? 0;
    if (armedAtRem === null && loaded) armedAtRem = Math.round(rem * 10) / 10;
    if (readyAtRem === null && loaded && rs >= 3) readyAtRem = Math.round(rem * 10) / 10;
    if (player.index !== startIdx) {
      flipBuffering = { atRem: Math.round(rem * 10) / 10, buffering: player.isBuffering, rs };
      for (let k = 0; k < 8; k++) {
        await wait(250);
        log.push({ buf: player.isBuffering, pos: Math.round(player.position * 10) / 10 });
      }
      break;
    }
    await wait(250);
  }

  return {
    title: player.current?.title?.slice(0, 26),
    armedAtSecondsRemaining: armedAtRem,
    standbyReadyAtSecondsRemaining: readyAtRem,
    armedButNeverReady: armedAtRem !== null && readyAtRem === null,
    neverArmed: armedAtRem === null,
    atFlip: flipBuffering,
    postFlipBuffering: log.filter((l) => l.buf).length,
    postFlipSamples: log.length,
  };
}
main();
