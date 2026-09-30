/**
 * Contrast audit, end to end.
 *
 * Collects every visible text element from the running app over CDP, captures the same frame as a
 * PNG, and hands both to contrast-audit.cjs, which measures real rendered pixels.
 *
 * The DOM-only version of this check is worthless here: the backdrop is a bitmap, so walking up the
 * ancestor chain never finds an opaque `background-color` and every element ends up measured against
 * an assumed near-black. That passes unconditionally, which is exactly the failure mode that made the
 * last vibrancy pass look fine when it was not.
 *
 * Rects are multiplied by devicePixelRatio before being written, so the audit script can treat the
 * capture as a 1:1 pixel map with no frame offset.
 *
 * Usage: node scripts/audit-run.mjs <urlSubstring> <outPng>
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const sub = process.argv[2] || "1420/";
const outPng = process.argv[3] || "scripts/audit.png";

const COLLECTOR = `(() => {
  const d = document, dpr = window.devicePixelRatio || 1;
  /**
   * Resolve any CSS colour the browser can express — rgb(), oklab(), color-mix(), color() — to the
   * sRGB triple it actually paints.
   *
   * getComputedStyle hands back the colour in its SPECIFIED space, so a naive digit-scan reads
   * oklab(0.745584 0.101051 0.0521787) as rgb(0.75, 0.10, 0.05) — near-black. That made the audit
   * score the floored accent token at 1.53:1 on a background where it really renders at 5.8:1, i.e.
   * the tool would have reported a severe regression for the fix that removed the regression.
   *
   * Method: fill a 1x1 canvas with the colour over two known grounds. obs = a*ink + (1-a)*ground,
   * so the two observations solve both the alpha and the ink, and the canvas does the gamut mapping
   * the renderer itself performs.
   */
  const cv = d.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const resolve = (spec) => {
    if (!spec || spec === "none") return spec;
    if (cache.has(spec)) return cache.get(spec);
    const over = (ground) => {
      cx.globalCompositeOperation = "copy";
      cx.fillStyle = ground;
      cx.fillRect(0, 0, 1, 1);
      cx.globalCompositeOperation = "source-over";
      cx.fillStyle = spec;
      cx.fillRect(0, 0, 1, 1);
      return cx.getImageData(0, 0, 1, 1).data;
    };
    const o0 = over("#000");
    const o1 = over("#fff");
    let a = 0;
    for (let i = 0; i < 3; i++) a += 1 - (o1[i] - o0[i]) / 255;
    a /= 3;
    const out =
      a < 0.004
        ? "rgba(0, 0, 0, 0)"
        : "rgba(" +
          [0, 1, 2].map((i) => Math.round(Math.min(255, Math.max(0, o0[i] / a)))).join(", ") +
          ", " +
          +a.toFixed(3) +
          ")";
    cache.set(spec, out);
    return out;
  };
  const els = [];
  const seen = new Set();
  for (const el of [...d.querySelectorAll("body *")]) {
    const txt = (el.textContent || "").trim();
    if (!txt || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const key = txt.slice(0, 28) + "@" + Math.round(r.top) + "," + Math.round(r.left);
    if (seen.has(key)) continue;
    seen.add(key);
    let sel = el.tagName.toLowerCase();
    if (typeof el.className === "string" && el.className.trim()) sel += "." + el.className.trim().split(/\\s+/)[0];
    /**
     * Which of the six backdrop sample points are actually looking at this element's background.
     *
     * The floating bar is glass and pages scroll beneath it on purpose, so a Settings hint can sit at
     * the same y as the bar's own white title. The ring sample then reads that title and the audit
     * reports white text on white at 1.43:1 — a fourth distinct flavour of the same failure: an
     * adjacent or overlapping piece of chrome being mistaken for a background. Blocking images and
     * slider thumbs patched over two instances; this is the general test. A point is only evidence
     * about this element's backdrop if the topmost thing there is this element, one of its ancestors,
     * or one of its own descendants.
     */
    const gapD = Math.max(3, Math.round(4 * dpr));
    const gap = gapD / dpr;
    /**
     * The element's VISIBLE box, not its layout box.
     *
     * A marquee is the case that forces this: the travelling inner span is wider than the clip window
     * it scrolls through, so its layout rect runs off past the edge of the card. Sampling "just outside
     * the box" then puts the sample inside the run of visible glyphs — in a gap between letters, where
     * elementFromPoint correctly answers "the clip container", so the occlusion test cannot catch it.
     * The audit scored the mini card's title at 1.77:1 against an antialiased edge of its own text.
     */
    let v = { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
    for (let p = el.parentElement; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === "visible" && pcs.overflowY === "visible") continue;
      const pr = p.getBoundingClientRect();
      v.x = Math.max(v.x, pr.x);
      v.y = Math.max(v.y, pr.y);
      v.right = Math.min(v.right, pr.right);
      v.bottom = Math.min(v.bottom, pr.bottom);
    }
    v.width = Math.max(0, v.right - v.x);
    v.height = Math.max(0, v.bottom - v.y);
    if (v.width < 3 || v.height < 3) continue;
    const mid = v.y + v.height / 2;
    const pts = [
      [v.x - gap, mid],
      [v.x + v.width + gap, mid],
      [v.x - gap, v.y + v.height * 0.2],
      [v.x - gap, v.y + v.height * 0.8],
      [v.x + v.width + gap, v.y + v.height * 0.2],
      [v.x + v.width + gap, v.y + v.height * 0.8],
    ];
    const ring = pts.map(([px, py]) => {
      const hit = d.elementFromPoint(px, py);
      if (!hit) return true;
      return hit === el || el.contains(hit) || hit.contains(el);
    });
    els.push({
      sel,
      sample: txt.slice(0, 28),
      color: resolve(cs.color),
      ownBg: resolve(cs.backgroundColor),
      ring,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      bold: (parseInt(cs.fontWeight, 10) || 400) >= 700,
      rect: { x: v.x * dpr, y: v.y * dpr, width: v.width * dpr, height: v.height * dpr },
      gap: Math.max(3, Math.round(4 * dpr)),
    });
  }
  /**
   * Rects of every image and background-image surface, in device pixels.
   *
   * Without this the audit reports a list row as failing: the sample taken just to the left of a
   * row title lands on that row's own album thumbnail, which is bright artwork, and the text gets
   * scored against a photograph rather than against the dark backdrop it actually sits on. Rejecting
   * sample points inside an image is the general fix — the alternative, sampling only to the right,
   * would quietly stop working for any right-aligned or centred text.
   */
  const blockers = [];
  const view = innerWidth * innerHeight * dpr * dpr;
  for (const el of [...d.querySelectorAll("img, canvas, video")]) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    /* The same area exception as the url() pass below, and for the same reason: an image that covers
       the viewport is the backdrop itself, not adjacent chrome. Without it the mini card measured
       nothing at all — its blurred cover is a full-bleed <img>, so it blocked every one of the six
       sample points of all 16 text elements, and the audit reported "16 fully covered by chrome"
       instead of the contrast numbers it was asked for. */
    if (r.width * r.height * dpr * dpr > view * 0.25) continue;
    blockers.push([r.x * dpr, r.y * dpr, (r.x + r.width) * dpr, (r.y + r.height) * dpr]);
  }
  for (const el of [...d.querySelectorAll("*")]) {
    const bi = getComputedStyle(el).backgroundImage;
    // Only real images. Every decorative layer in this app is a gradient, and counting those would
    // block every sample in the page.
    if (!bi || !bi.includes("url(")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // And only local ones — the full-window artwork backdrop is a url() too, and excluding it by
    // area keeps it as the legitimate background it is.
    if (r.width * r.height * dpr * dpr > view * 0.25) continue;
    blockers.push([r.x * dpr, r.y * dpr, (r.x + r.width) * dpr, (r.y + r.height) * dpr]);
  }
  /**
   * Slider tracks, fills and thumbs.
   *
   * The thumb is a positioned span whose left:100% plus a centring transform puts it partly outside
   * the input element it belongs to. The "100%" label sits a few pixels to its right, so the ring
   * sample lands on solid white and the audit reports perfectly legible white text at 1.99:1 — in
   * every single view, because the bar is always on screen. Blocking the input's box is not enough;
   * the thumb's own rect has to be blocked.
   */
  for (const el of [...d.querySelectorAll("input[type=range], [class*=slider]")]) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    blockers.push([r.x * dpr, r.y * dpr, (r.x + r.width) * dpr, (r.y + r.height) * dpr]);
  }

  return { dpr, innerW: innerWidth, innerH: innerHeight, blockers, elements: els };
})()`;

(async () => {
  const list = await (await fetch("http://127.0.0.1:9223/json")).json();
  const t = list.find(
    (k) =>
      k.type === "page" &&
      k.url.includes(sub) &&
      (sub.includes("mini") || !k.url.includes("mini")) &&
      k.webSocketDebuggerUrl,
  );
  if (!t) {
    console.error(`no target matching "${sub}". seen: ${list.map((k) => k.url).join(", ")}`);
    process.exit(2);
  }

  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Runtime.enable");
  await send("Page.enable");

  const got = await send("Runtime.evaluate", { expression: COLLECTOR, returnByValue: true });
  const data = got.result?.result?.value;
  if (!data) {
    console.error("collector failed:", JSON.stringify(got).slice(0, 400));
    process.exit(1);
  }

  // An explicit clip matching the layout viewport. Without it Chrome returns a surface larger than
  // what it has painted, and the unpainted remainder comes back pure black — 58% of one capture was.
  // Against a black field every white label measures as high contrast, so the audit passes things
  // that are unreadable, which is the exact failure mode this tool exists to catch.
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: data.innerW, height: data.innerH, scale: data.dpr },
    captureBeyondViewport: false,
  });
  fs.writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));

  // Written next to the PNG, not to one shared path. A fixed filename meant a multi-view sweep
  // scored every screenshot against whichever view ran last — Home's pixels audited against
  // Settings' element rects, which produced confident, meaningless failure lists.
  const json = outPng.replace(/\.[^.]+$/, "") + "-elements.json";
  fs.writeFileSync(json, JSON.stringify({ frame: { x: 0, y: 0 }, dpr: data.dpr, blockers: data.blockers, elements: data.elements }));

  console.log(`dpr ${data.dpr} · viewport ${data.innerW}x${data.innerH} · ${data.elements.length} text elements`);
  console.log(`--- ${outPng} ---\n`);
  try {
    console.log(execFileSync(process.execPath, [path.join("scripts", "contrast-audit.cjs"), outPng, json], { encoding: "utf8" }));
  } catch (e) {
    console.log(e.stdout || String(e));
  }
  ws.close();
})();
