// Dev harness probe for the A-B loop and bookmark batch.
//   node scripts/cdp-eval.mjs --file scripts/probe-loop.js
(() => {
  const { player, bookmarks } = window.__noctra;
  const out = {};
  const track = player.current.id ? player.current : player.tracks[0];
  out.track = track.title;

  // --- A-B tap flow ---
  player.clearLoop();
  player.position = 12;
  player.tapLoopPoint();
  out.afterFirstTap = { a: player.loopA, b: player.loopB, armed: player.loopArmed };
  player.position = 4; // behind A: must be ignored rather than arm a backwards span
  player.tapLoopPoint();
  out.afterBackwardsTap = { a: player.loopA, b: player.loopB, armed: player.loopArmed };
  player.position = 30;
  player.tapLoopPoint();
  out.afterValidSecondTap = { a: player.loopA, b: player.loopB, armed: player.loopArmed };
  player.position = 50;
  player.tapLoopPoint(); // third tap clears and starts a new A
  out.afterThirdTap = { a: player.loopA, b: player.loopB, armed: player.loopArmed };

  // --- wrap enforcement ---
  // `enforceLoop` reaches the real audio element through `player.seek`. Nothing is loaded yet in
  // this session, so the element assignment may throw; `player.position` is written before it, so
  // the wrap decision itself is still observable either way.
  const attempt = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return String(e);
    }
  };
  player.clearLoop();
  player.markLoopA(10);
  player.markLoopB(20);
  out.markedSpan = { a: player.loopA, b: player.loopB };
  out.wrapBeforeEnd = attempt(() => player.enforceLoop(15));
  out.positionUnchangedAt15 = player.position;
  out.wrapAtEnd = attempt(() => player.enforceLoop(20.4));
  out.wrappedToStart = player.position;
  // A far end behind the new start invalidates it.
  player.markLoopA(25);
  out.aMovedPastB = { a: player.loopA, b: player.loopB, armed: player.loopArmed };
  player.markLoopB(3);
  out.bBeforeA = { a: player.loopA, b: player.loopB, armed: player.loopArmed };
  // B without a prior A starts the loop from the top of the track.
  player.clearLoop();
  player.markLoopB(8);
  out.bWithoutA = { a: player.loopA, b: player.loopB };
  player.clearLoop();
  out.cleared = { a: player.loopA, b: player.loopB };

  // --- bookmarks ---
  const id = track.id;
  bookmarks.clear(id);
  out.startEmpty = bookmarks.count(id) === 0;
  out.added = bookmarks.add(id, 61.26, "chorus");
  out.rounded = bookmarks.for(id)[0];
  out.duplicateRejected = bookmarks.add(id, 61.3, "same moment");
  out.secondAdd = bookmarks.add(id, 120, "");
  out.sorted = bookmarks.for(id).map((b) => b.at);
  out.count = bookmarks.count(id);
  bookmarks.remove(id, 61.3);
  out.afterRemove = bookmarks.for(id).map((b) => b.at);
  const stored = JSON.parse(localStorage.getItem("noctra.bookmarks") ?? "{}");
  out.persistedForThisTrack = (stored[id] ?? []).length;
  bookmarks.clear(id);
  out.cleanedUp = bookmarks.count(id) === 0;

  return out;
})();
