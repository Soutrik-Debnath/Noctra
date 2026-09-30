// Dev harness: catch a real lyric line change and record whether the arrival animation runs.
//
// Two hazards this is written around:
//  - The tree is shared with other live agent sessions, and one of them navigated `ui.view` to
//    Settings in the middle of a run, which unmounted the reel. So the view is re-asserted before
//    every sample and theft is counted rather than assumed away.
//  - Sampling uses setTimeout, not requestAnimationFrame: an unfocused webview stops producing
//    frames on time, which made an rAF loop stall for seconds.
async function main() {
  const { player, ui, lyricsStore } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ensure = () => {
    if (ui.view !== "lyrics") ui.view = "lyrics";
  };

  ensure();
  for (let i = 0; i < 60 && !document.querySelector(".line.active"); i++) {
    ensure();
    await wait(50);
  }

  const L = (lyricsStore.lyrics?.lines ?? [])
    .map((l) => ({ t: (l.time ?? 0) / 1000, txt: (l.text ?? "").trim() }))
    .filter((l) => Number.isFinite(l.t) && l.txt);
  if (!L.length) return { fail: "no lyric lines loaded", status: lyricsStore.status };

  const pos = player.position;
  const target = L.find((l) => l.t > pos + 1.6);
  if (!target) return { fail: "no upcoming line", pos };

  const want = target.txt.slice(0, 18);
  let steals = 0;
  const snap = () => {
    if (ui.view !== "lyrics") steals++;
    ensure();
    const el = document.querySelector(".line.active");
    if (!el) return { txt: null };
    const cs = getComputedStyle(el);
    return {
      txt: el.textContent.trim().slice(0, 18),
      op: Math.round(Number(cs.opacity) * 100) / 100,
      scale: (cs.transform.match(/matrix\(([\d.]+)/) ?? [])[1] ?? cs.transform,
      glow: (cs.filter.match(/rgba\(255, 255, 255, [\d.]+\)/g) ?? []).join("|"),
      anims: el.getAnimations().map((a) => ({
        n: a.animationName ?? "transition",
        ct: Math.round(a.currentTime ?? -1),
        ps: a.playState,
      })),
    };
  };

  player.seek(target.t - 0.8);
  await wait(300);
  const from = snap().txt;

  const samples = [];
  for (let i = 0; i < 400; i++) {
    const s = snap();
    s.d = Math.round((player.position - (target.t - 0.8)) * 1000);
    samples.push(s);
    if (s.txt === want) {
      for (let k = 0; k < 24; k++) {
        await wait(16);
        const t = snap();
        t.d = Math.round((player.position - (target.t - 0.8)) * 1000);
        samples.push(t);
      }
      break;
    }
    await wait(16);
  }

  const hit = samples.findIndex((s) => s.txt === want);
  return {
    crossed: want,
    from,
    targetT: Math.round(target.t * 10) / 10,
    framesToFlip: hit,
    flipAtMs: hit >= 0 ? samples[hit].d : null,
    viewThefts: steals,
    framesSampled: samples.length,
    arrival: hit >= 0 ? samples.slice(hit, hit + 12) : samples.slice(-3),
  };
}
main();
