// One-off: talk to an exact CDP target by URL, because the app's main window and the mini card
// share a host and the shared harness matches by substring.
const WS = process.argv[2];
const EXPR = process.argv[3];

const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const t = list.find((x) => x.type === "page" && x.url === WS);
if (!t) {
  console.error("no target with url " + WS + "; saw: " + list.map((x) => x.url).join(", "));
  process.exit(1);
}

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("ws error"));
});
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: EXPR, awaitPromise: true, returnByValue: true },
  }),
);
const out = await new Promise((res) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) res(m);
  };
});
ws.close();
if (out.error) throw new Error(JSON.stringify(out.error));
console.log(out.result?.result?.value ?? JSON.stringify(out.result));
