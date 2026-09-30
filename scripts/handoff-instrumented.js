// Wrap the engine's handoff methods so one transition leaves a call log behind.
//
// The volume sampling kept showing a flip with no ramp, and every static reading of the code says
// that is impossible — so this stops guessing which of them is wrong.
//
//   node scripts/cdp-eval.mjs --file scripts/handoff-instrumented.js
(async () => {
  const { player, engine, settings } = window.__noctra;
  const proto = Object.getPrototypeOf(engine);
  const log = [];
  const t0 = performance.now();
  const stamp = () => +((performance.now() - t0) / 1000).toFixed(2);

  for (const name of ["beginHandoff", "tickRamp", "startRamp", "stopRamp", "abandonHandoff", "cancelHandoff"]) {
    const original = proto[name];
    if (typeof original !== "function") { log.push({ note: `no method ${name}` }); continue; }
    proto[name] = function (...args) {
      if (name === "tickRamp") {
        if (!log.length || log[log.length - 1].m !== "tick") log.push({ t: stamp(), m: "tick-start" });
        else log[log.length - 1].n = (log[log.length - 1].n || 1) + 1;
      } else {
        const entry = { t: stamp(), m: name, args: args.map(String) };
        // The cancels are the mystery, so record who is calling them.
        if (name === "cancelHandoff") entry.stack = new Error().stack.split("\n").slice(2, 6).join(" <- ");
        log.push(entry);
      }
      const r = original.apply(this, args);
      if (name === "beginHandoff" || name === "tickRamp") {
        log.push({ t: stamp(), m: `${name}:exit`, fadeSec: this.fadeSeconds,
          aRamp: this.active?.ramp, oRamp: this.decks.find(d => d.role === "fading-out")?.ramp,
          aVol: this.active?.media?.volume });
      }
      return r;
    };
  }

  settings.value.gapless = true;
  settings.value.crossfadeSec = 5;
  engine.setGapless(true);
  engine.crossfadeTo(5);

  const a = player.tracks.find((x) => (x.duration || 0) > 90);
  player.playFrom(a.id);
  // Wait on real metadata, not a fixed sleep: a deck that has not reported a duration yet makes the
  // seek throw, and a NaN duration is also exactly what would make the fade clamp to zero.
  let dur = NaN;
  for (let i = 0; i < 60; i++) {
    dur = engine.active.media.duration;
    if (Number.isFinite(dur) && dur > 20) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!Number.isFinite(dur)) return { fatal: "duration never became finite", log };
  engine.active.media.currentTime = dur - 8;

  const started = performance.now();
  const firstTitle = String(player.current?.title || "");
  while (performance.now() - started < 12000) {
    await new Promise((r) => setTimeout(r, 150));
    if (String(player.current?.title || "") !== firstTitle) break;
  }
  await new Promise((r) => setTimeout(r, 1200));

  return {
    track: firstTitle.slice(0, 24),
    flipAtSec: +((performance.now() - started) / 1000).toFixed(2),
    calls: log.filter((e) => e.m !== "tick" || true).slice(0, 26),
    isFadingNow: engine.isFading,
  };
})();
