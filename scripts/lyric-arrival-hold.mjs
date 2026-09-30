// Dev harness: hold a lyric line at its arrival peak, with playback paused too, so the same line can
// be photographed at peak and at rest. Without pausing the transport the reel advances during the
// screenshot and the two frames no longer show the same words.
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
  if (!L.length) return { fail: "no lines" };

  const target = L.find((l) => l.t > player.position + 1.6);
  if (!target) return { fail: "no upcoming line" };
  const want = target.txt.slice(0, 18);

  player.seek(target.t - 0.8);
  await wait(300);

  for (let i = 0; i < 400; i++) {
    ensure();
    const el = document.querySelector(".line.active");
    if (el && el.textContent.trim().slice(0, 18) === want) {
      player.pause();
      el.getAnimations().filter((a) => a.animationName).forEach((a) => {
        a.pause();
        a.currentTime = 176;
      });
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        mode: "peak",
        txt: want,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        opacity: cs.opacity,
        transform: cs.transform,
        glow: (cs.filter.match(/rgba\(255, 255, 255, [\d.]+\) 0px 0px \d+px/) ?? ["none"])[0],
      };
    }
    await wait(16);
  }
  return { fail: "never flipped", want };
}
main();
