/**
 * Dev tool: evaluate an expression inside the running Tauri webview over the Chrome DevTools
 * Protocol, so the app's real state can be inspected without a human clicking it.
 *
 * Requires the app to have been started with:
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223
 *
 * Usage:
 *   node scripts/cdp-eval.mjs "<expression>"
 *   node scripts/cdp-eval.mjs --file script.js        evaluate the contents of a file
 *   node scripts/cdp-eval.mjs --inject script.js      register a script to run on every new
 *                                                     document, so it is installed before the app
 *                                                     creates any elements
 *   NOCTRA_CDP_MATCH=mini node scripts/cdp-eval.mjs … target the desktop card instead
 *
 * The expression may be async; the promise is awaited before printing.
 */
const DEBUG_PORT = process.env.NOCTRA_CDP_PORT ?? "9223";

async function findTarget() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  if (!res.ok) throw new Error(`CDP endpoint not reachable on ${DEBUG_PORT}: HTTP ${res.status}`);
  const targets = (await res.json()).filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl,
  );
  // The desktop mini card is a second webview on the same port, and it can be listed first.
  // `window.__noctra` only exists in the main app, so default to it and let NOCTRA_CDP_MATCH pick
  // out the other one (`NOCTRA_CDP_MATCH=mini` targets the card).
  const match = process.env.NOCTRA_CDP_MATCH;
  // The 1420 test only holds in dev. An installed build serves from `tauri.localhost`, so a probe
  // against the shipped app fell through to `targets[0]`, which is the mini card — and then reported
  // "no bar found" for a bar that was on screen the whole time. Exclude the card by name first and
  // only fall back to it when it is genuinely the only page.
  const nonMini = targets.filter((t) => !t.url.includes("mini"));
  const app =
    (match ? targets.find((t) => t.url.includes(match)) : undefined) ??
    nonMini.find((t) => t.url.includes("1420")) ??
    nonMini[0] ??
    targets[0];
  if (!app) throw new Error("No inspectable webview target found");
  if (!match && app.url.includes("mini")) {
    console.error("warning: only the mini card was available; pass NOCTRA_CDP_MATCH to choose");
  }
  return app;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`WebSocket error: ${e.message ?? "unknown"}`));
  });
}

let id = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const msgId = ++id;
    const onMessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== msgId) return;
      ws.removeEventListener("message", onMessage);
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

const args = process.argv.slice(2);
const fs = await import("node:fs");

const target = await findTarget();
const ws = await connect(target.webSocketDebuggerUrl);

if (args[0] === "--inject") {
  // Runs before any app code, so prototype patches land on elements the app has not built yet.
  const source = fs.readFileSync(args[1], "utf8");
  await send(ws, "Page.enable");
  await send(ws, "Page.addScriptToEvaluateOnNewDocument", { source });
  await send(ws, "Page.reload", { ignoreCache: true });
  console.log("injected + reloaded");
  ws.close();
  process.exit(0);
}

if (args[0] === "--click") {
  // Input.dispatchMouseEvent produces a *trusted* event, so it grants user activation.
  // element.click() from Runtime.evaluate does not, and Chromium's autoplay policy rejects
  // media playback started that way — which looks identical to a real bug if you test with it.
  const x = Number(args[1]);
  const y = Number(args[2]);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send(ws, "Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      clickCount: 1,
      buttons: type === "mousePressed" ? 1 : 0,
    });
  }
  console.log(`trusted click at ${x},${y}`);
  ws.close();
  process.exit(0);
}

let expression;
if (args[0] === "--file") {
  expression = fs.readFileSync(args[1], "utf8");
} else {
  expression = args.join(" ");
}
if (!expression) {
  console.error('usage: node scripts/cdp-eval.mjs "<expression>" | --file <path> | --inject <path>');
  process.exit(2);
}

const result = await send(ws, "Runtime.evaluate", {
  expression,
  awaitPromise: true,
  returnByValue: true,
});

if (result.exceptionDetails) {
  console.error("THREW:", JSON.stringify(result.exceptionDetails, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result.result?.value ?? null, null, 2));
}

ws.close();
process.exit(process.exitCode ?? 0);
