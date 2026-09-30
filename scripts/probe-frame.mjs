/**
 * Dev tool: filmstrip a click-driven animation.
 *
 * Screenshots are the only arbiter for whether motion actually happens: computed styles have produced
 * false negatives here repeatedly (a detached node reporting a frozen transform, a single sub-path
 * measured instead of their union). So this clicks once, then captures back to back as fast as the
 * protocol allows, and records the page's own elapsed time for each frame rather than trusting the
 * wall clock on this side of the wire.
 *
 * Usage: node scripts/probe-frame.mjs <selector> <out-prefix> [frames]
 */
const [SEL, OUT, framesArg = "5"] = process.argv.slice(2);
if (!SEL || !OUT) {
  console.error("usage: node scripts/probe-frame.mjs <selector> <out-prefix> [frames]");
  process.exit(1);
}
const FRAMES = +framesArg;
const DEBUG_PORT = process.env.NOCTRA_CDP_PORT ?? "9223";

const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.includes("1420") && !t.url.includes("mini"));
if (!target) {
  console.error(`no main app target on ${DEBUG_PORT}. seen: ${list.map((t) => t.url).join(", ")}`);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    const timer = setTimeout(() => rej(new Error(`${method}: no reply inside 15s`)), 15000);
    pending.set(i, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
await send("Page.enable");

const { writeFile } = await import("node:fs/promises");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Page.captureScreenshot costs 100-600ms here, so a sub-second animation is over before the second
// frame lands. Slowing it via an injected override is the only way pixels can settle a fast-motion
// question; set SLOWMO=".class=6000" to apply it, and it is removed again at the end.
if (process.env.SLOWMO) {
  const [selector, ms] = process.env.SLOWMO.split("=");
  await evaluate(
    `(() => {
      const s = document.createElement("style");
      s.id = "__slowmo";
      s.textContent = ${JSON.stringify(`${selector} { animation-duration: ${ms}ms !important; }`)};
      document.head.appendChild(s);
      return true;
    })()`,
  );
}

// The click and the geometry read happen in the same expression so the element cannot move between
// them; elapsed time comes from the page's own clock.
const setup = await evaluate(
  `(() => {
    const btn = document.querySelector(${JSON.stringify(SEL)});
    if (!btn) return JSON.stringify({ error: "not mounted" });
    btn.__t0 = performance.now();
    btn.click();
    const r = btn.getBoundingClientRect();
    return JSON.stringify({
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      pressed: btn.getAttribute("aria-pressed"),
      title: btn.getAttribute("title"),
    });
  })()`,
);
const { rect, pressed, title } = JSON.parse(setup);
if (!rect) {
  console.error(setup);
  process.exit(1);
}

// Pad so the motion is not clipped at the edges of the hit box.
const pad = 14;
const clip = { x: rect.x - pad, y: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2, scale: 1 };

const log = [];
for (let i = 0; i < FRAMES; i++) {
  const shot = await send("Page.captureScreenshot", { format: "png", clip });
  const elapsed = await evaluate(
    `Math.round(performance.now() - document.querySelector(${JSON.stringify(SEL)}).__t0)`,
  );
  const file = `${OUT}-${String(i).padStart(2, "0")}.png`;
  await writeFile(path.resolve(root, file), Buffer.from(shot.data, "base64"));
  log.push(`${file}  t=${elapsed}ms`);
}

// Restore whatever the click changed, and verify the restore landed.
await evaluate(`
  (() => {
    const btn = document.querySelector(${JSON.stringify(SEL)});
    let guard = 0;
    const same = () => btn.getAttribute("aria-pressed") === ${JSON.stringify(pressed)} && btn.getAttribute("title") === ${JSON.stringify(title)};
    while (!same() && guard++ < 8) btn.click();
    return same();
  })()
`);
const restored = await evaluate(
  `(() => { const b = document.querySelector(${JSON.stringify(SEL)}); return JSON.stringify([b.getAttribute("aria-pressed") === ${JSON.stringify(pressed)}, b.getAttribute("title") === ${JSON.stringify(title)}]); })()`,
);

console.log(log.join("\n"));
console.log(`clip ${JSON.stringify(clip)}  restored=${restored}`);
await evaluate(`(() => { document.getElementById("__slowmo")?.remove(); return true; })()`);
ws.close();
process.exit(0);
