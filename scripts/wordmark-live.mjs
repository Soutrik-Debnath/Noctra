/**
 * Preview wordmark candidates inside the running app rather than in a throwaway browser page.
 *
 * A standalone comparison page is the wrong instrument for this: it cannot reproduce the sidebar's
 * real glass, its blur, its exact 18.88px size or the app's own font-smoothing, and headless Chrome
 * silently fell back to a generic serif for every face — which produced a sheet where all six
 * candidates looked identical and would have read as a real result. The running WebView2 already
 * loads webfonts correctly, so the swap happens there and is photographed there.
 *
 * Each font is injected as a data: URL and applied to the live `.word` element, then the sidebar
 * corner is captured. Nothing is written to disk in the project: this mutates only the running
 * document, and reloading the page discards it.
 *
 * Usage: node scripts/wordmark-live.mjs <fontDir> <outDir>
 */
import fs from "node:fs";
import path from "node:path";

const PORT = "9223";
const [fontDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((k) => k.type === "page" && k.url.includes("1420") && !k.url.includes("mini"));
if (!target) {
  console.error("no main webview on 9223 — is Noctra running?");
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};

await send("Runtime.enable");
await send("Page.enable");

const files = fs.readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/i.test(f)).sort();
const report = [];

for (const file of files) {
  const label = file.replace(/\.(ttf|otf)$/i, "");
  const b64 = fs.readFileSync(path.join(fontDir, file)).toString("base64");
  const mime = file.toLowerCase().endsWith(".otf") ? "font/otf" : "font/ttf";

  const result = await evaluate(`(async () => {
    const fam = "WMCandidate";
    document.getElementById("wm-probe-face")?.remove();
    const face = new FontFace(fam, "url(data:${mime};base64,${b64})");
    // add() takes the FontFace; load() returns a promise. Passing load()'s result to add() throws
    // "parameter 1 is not of type 'FontFace'".
    document.fonts.add(face);
    await face.load();
    const w = document.querySelector(".word");
    if (!w) return JSON.stringify({ error: "no .word element in the sidebar" });
    w.style.fontFamily = "'" + fam + "'";
    w.style.fontWeight = "400";
    await document.fonts.ready;
    const r = w.getBoundingClientRect();
    return JSON.stringify({ loaded: document.fonts.check("19px " + fam), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  })()`);

  const info = JSON.parse(result);
  if (info.error) {
    report.push(`${label}: ${info.error}`);
    break;
  }
  // Clip to the sidebar header strip so the crop shows the wordmark against the real panel.
  const [bx, by] = info.box;
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, bx - 18), y: Math.max(0, by - 16), width: 250, height: 56, scale: 1 },
    captureBeyondViewport: false,
  });
  const out = path.join(outDir, `${label}.png`);
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  report.push(`${label}: fonts.check=${info.loaded} -> ${path.basename(out)}`);
}

// Leave the document as it was found.
await evaluate(`(() => { const w=document.querySelector('.word'); if(w){w.style.fontFamily='';w.style.fontWeight='';} document.getElementById('wm-probe-face')?.remove(); return 1; })()`);

console.log(report.join("\n"));
ws.close();
