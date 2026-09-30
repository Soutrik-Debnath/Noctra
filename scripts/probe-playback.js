// Dev harness probe for the playback-correctness batch. Run with:
//   node scripts/cdp-eval.mjs --file scripts/probe-playback.js
(() => {
  const { player, history, blocked, settings } = window.__noctra;
  const out = {};

  // --- repeat-N ---
  out.hasRepeatTimes = typeof player.repeatTimes === "number";
  player.setRepeatTimes(5);
  out.afterSet5 = { repeat: player.repeat, times: player.repeatTimes };
  player.cycleRepeat();
  out.cycleFromTimesGoesTo = player.repeat;
  player.repeat = "times";
  player.setRepeatTimes(99);
  out.clampedHigh = player.repeatTimes;
  player.setRepeatTimes(1);
  out.clampedLow = player.repeatTimes;
  player.repeat = "off";

  // --- queue: three "Play next" in a row must keep click order ---
  // `enqueue` refuses the track that is already playing, so the sample has to exclude it or the
  // first assertion measures a no-op rather than an ordering.
  const ids = player.tracks.filter((t) => t.id !== player.current.id).slice(0, 6).map((t) => t.id);
  const idx = () => player.queue.map((q) => ids.indexOf(q));
  player.clearQueue();
  for (const id of ids.slice(0, 3)) player.enqueue(id, true);
  out.playNextOrder = idx();
  player.clearQueue();
  player.enqueue(ids[0]);
  player.enqueue(ids[1]);
  out.addToEndOrder = idx();
  player.clearQueue();
  for (const id of ids.slice(0, 3)) player.enqueue(id, true);
  player.removeAt(0);
  player.enqueue(ids[3], true);
  out.afterManualEditResets = idx();
  player.clearQueue();

  // --- shuffle is still a complete permutation, just an unbiased one ---
  const wasShuffle = player.shuffle;
  player.shuffle = false;
  player.ensureOrder();
  const identity = [...player.order];
  player.shuffle = true;
  player.ensureOrder();
  const shuffled = [...player.order];
  out.permutationComplete =
    shuffled.length === identity.length &&
    new Set(shuffled).size === shuffled.length &&
    shuffled.every((i) => i >= 0 && i < identity.length);
  out.positionsChanged = shuffled.filter((v, i) => v !== identity[i]).length;
  player.shuffle = wasShuffle;

  // --- history adjacency ---
  out.historyHasTogether = typeof history.together === "function";
  const recent = history.recent ?? [];
  out.recentLength = recent.length;
  if (recent.length >= 2) {
    const a = recent[recent.length - 1];
    const b = recent[recent.length - 2];
    out.symmetry = history.together(a, b) === history.together(b, a);
    out.lastPairCount = history.together(a, b);
  }

  // --- block list keeps tracks out of the play order ---
  player.shuffle = false;
  const victim = player.tracks[3];
  const sizeBefore = blocked.trackIds.size;
  blocked.toggleTrack(victim.id);
  player.ensureOrder();
  out.victimRemovedFromOrder = !player.order.includes(3);
  out.orderShrankBy = identity.length - player.order.length;
  blocked.toggleTrack(victim.id);
  player.ensureOrder();
  out.victimRestored = player.order.includes(3);
  out.blockSizeRoundTripped = blocked.trackIds.size === sizeBefore;

  // --- persistence shape ---
  const raw = JSON.parse(localStorage.getItem("noctra.settings") ?? "{}");
  out.persistedRepeatTimes = raw.repeatTimes;
  const pairs = JSON.parse(localStorage.getItem("noctra.history") ?? "{}").pairs;
  out.storedPairCount = pairs ? Object.keys(pairs).length : 0;

  player.repeat = "off";
  player.clearQueue();
  return out;
})();
