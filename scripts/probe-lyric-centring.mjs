// Dev harness: after each real line change, where does the sung line settle relative to centre?
//
// Samples until at least three line changes have happened, then reports the offset measured once the
// reel has had time to arrive — measuring during the glide would just read the smoothing, not the
// hold band.
async function main() {
  const { player, ui } = window.__noctra;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (ui.view !== "lyrics") ui.set("lyrics");
  await wait(800);

  const reel = document.querySelector(".reel");
  const host = reel?.parentElement;
  if (!host) return { fail: "no reel host" };
  if (!player.isPlaying) player.play();
  if (!player.isPlaying) return { fail: "could not start playback" };

  const offset = () => {
    const a = document.querySelector(".line.active");
    if (!a) return null;
    const ar = a.getBoundingClientRect();
    const vr = host.getBoundingClientRect();
    return Math.round(ar.y + ar.height / 2 - (vr.y + vr.height / 2));
  };

  const settled = [];
  let last = document.querySelector(".line.active")?.textContent?.trim().slice(0, 18) ?? "";
  let guard = 0;
  while (settled.length < 4 && guard++ < 260) {
    await wait(150);
    const cur = document.querySelector(".line.active")?.textContent?.trim().slice(0, 18) ?? "";
    if (cur && cur !== last) {
      last = cur;
      await wait(1400); // let the follow arrive
      settled.push({ line: cur.slice(0, 18), off: offset() });
    }
  }
  player.pause();
  const abs = settled.map((s) => Math.abs(s.off));
  return {
    hostH: Math.round(host.getBoundingClientRect().height),
    bandPx: Math.round(host.getBoundingClientRect().height * 0.06),
    changes: settled.length,
    worstOffPx: abs.length ? Math.max(...abs) : null,
    detail: settled,
  };
}
main();
