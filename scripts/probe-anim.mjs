/**
 * Dev tool: prove a click-driven animation actually runs, by driving it and sampling what is painted.
 *
 * Reading the CSS rule proves the declaration exists, not that the element animates — that gap has
 * produced confident wrong answers here before. So this clicks the control, samples computed transform
 * and class at a fixed interval across the animation, then clicks again to put user state back and
 * verifies the restore.
 *
 * Usage: node scripts/probe-anim.mjs <css-selector-for-button> [sample-ms] [samples]
 *   node scripts/probe-anim.mjs 'button[aria-label=Shuffle]' 55 8
 */
const SELECTOR = process.argv[2];
const STEP = +(process.argv[3] ?? 55);
const N = +(process.argv[4] ?? 8);
if (!SELECTOR) {
  console.error("usage: node scripts/probe-anim.mjs <selector> [sample-ms] [samples]");
  process.exit(1);
}

const DEBUG_PORT = process.env.NOCTRA_CDP_PORT ?? "9223";
const targets = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).filter(
  (t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.includes("1420") && !t.url.includes("mini"),
);
if (!targets.length) {
  console.error(`no main app target on ${DEBUG_PORT}. seen: ${(await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).map((t) => t.url).join(", ")}`);
  process.exit(1);
}

const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
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

// Written as a file so shell quoting cannot silently corrupt the JS and make the app look broken.
const probe = `
(async () => {
  const SEL = ${JSON.stringify(SELECTOR)};
  const STEP = ${STEP};
  const N = ${N};
  const btn = document.querySelector(SEL);
  if (!btn) return JSON.stringify({ error: "selector not mounted", SEL });
  // Re-queried every sample on purpose: the key-restart pattern re-creates the glyph, and a node
  // captured before the click goes detached and reports a frozen style, which looks like a dead
  // animation.
  const svg = () => btn.querySelector("svg") ?? btn;
  // A cycle control (repeat: off -> all -> one) is not restored by clicking it twice, so identity is
  // tracked as a fingerprint and the restore clicks until that fingerprint comes back.
  const print = () => (btn.getAttribute("aria-pressed") ?? "-") + "|" + (btn.getAttribute("title") ?? "");
  const before = print();
  const cls = () => svg().getAttribute("class") ?? "";
  const samples = [];
  btn.click();
  for (let i = 0; i < N; i++) {
    await new Promise((r) => setTimeout(r, STEP));
    samples.push(getComputedStyle(svg()).transform + "  " + cls());
  }
  const mid = print();
  let clicks = 1;
  while (print() !== before && clicks < 8) {
    btn.click();
    clicks++;
    await new Promise((r) => setTimeout(r, 40));
  }
  await new Promise((r) => setTimeout(r, N * STEP + 250));
  const after = document.querySelector(SEL) ? print() : "gone";
  return JSON.stringify({
    before,
    mid,
    after,
    clicksToRestore: clicks,
    restored: before === after,
    settled: samples[samples.length - 1],
    distinct: [...new Set(samples.map((s) => s.split("  ")[0]))].length,
    samples,
  }, null, 1);
})()
`;

console.log(await evaluate(probe));
ws.close();
process.exit(0);
