/**
 * Failing-then-passing check for the re-entrant context menu.
 *
 * `menu.run()` hides the menu unless a handler returns exactly `false`. "Add to playlist…" opens the
 * playlist picker by calling `menu.show()` from inside its own handler, so the picker was shown and
 * then hidden in the same tick and the row looked dead. This drives the store directly rather than
 * clicking through the UI so it cannot touch a real playlist.
 *
 * Needs the dev app running with the debug port. Usage: node scripts/repro-menu-reentry.mjs
 */
const DEBUG_PORT = process.env.NOCTRA_CDP_PORT ?? "9223";

const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
const target = list.find(
  (t) => t.type === "page" && t.webSocketDebuggerUrl && t.url.includes("1420") && !t.url.includes("mini"),
);
if (!target) {
  console.error(`no main app target on ${DEBUG_PORT}`);
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
const evaluate = () =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, (m) => {
      if (m.error) return rej(new Error(m.error.message));
      if (m.result?.exceptionDetails) return rej(new Error(m.result.exceptionDetails.text));
      res(m.result?.result?.value);
    });
    ws.send(
      JSON.stringify({
        id: i,
        method: "Runtime.evaluate",
        params: {
          expression: `
(async () => {
  const [{ menu }, { trackMenu }] = await Promise.all([
    import("/src/stores/menu.svelte.ts"),
    import("/src/services/trackMenu.ts"),
  ]);
  const ev = (x, y) => ({ clientX: x, clientY: y });
  // A throwaway id that cannot match anything real: the menu is built and one item is run, and every
  // branch touched here only reads. Nothing is added to a playlist.
  const probe = { id: "__probe_track__", title: "probe", artist: "", album: "", source: "" };
  const item = trackMenu(probe).find((i) => i.label === "Add to playlist…");
  if (!item) return JSON.stringify({ error: "no Add to playlist item in the track menu" });

  menu.show(ev(100, 100), [item]);
  menu.run(menu.items[0]);
  const pickerSurvives = menu.open === true;
  const pickerHasRows = menu.items.length > 0;

  menu.hide();
  return JSON.stringify({ pickerSurvives, pickerHasRows });
})()`,
          returnByValue: true,
          awaitPromise: true,
        },
      }),
    );
  });

const result = JSON.parse(await evaluate());
ws.close();

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
console.log(`picker stays open after the click ........ ${result.pickerSurvives ? "PASS" : "FAIL"}`);
console.log(`picker has rows to choose from ........... ${result.pickerHasRows ? "PASS" : "FAIL"}`);
process.exit(result.pickerSurvives && result.pickerHasRows ? 0 : 1);
