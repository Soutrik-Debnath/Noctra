// Verifies the transport hover states by driving a real mouse move through CDP and reading what
// actually paints. Cascade reasoning is not evidence: the plate this checks for came from a rule
// that only applied on :hover, so nothing short of a genuine hover proves it away.
//   node scripts/probe-hover.mjs
const PORT = process.env.NOCTRA_CDP_PORT ?? "9223";

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  // Dev serves from :1420, an installed build from tauri.localhost — excluding the mini card is the
  // part that identifies the main window in both.
  const pages = list.filter((t) => t.type === "page" && !t.url.includes("mini"));
  const target = pages.find((t) => t.url.includes("1420")) || pages[0];
  if (!target) throw new Error("main window not found");

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
    new Promise((res) => {
      const n = ++id;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evalJs = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  // Put the app somewhere the transport is on screen.
  await evalJs(`window.__noctra.ui.set('home'), new Promise(r=>setTimeout(r,350))`);

  const box = await evalJs(`(()=>{const b=document.querySelector('.orb-primary');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  const sib = await evalJs(`(()=>{const b=document.querySelector('.orb-bare');const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);

  const read = () =>
    evalJs(`(()=>{
      const pick=(el)=>{const c=getComputedStyle(el);const s=el.querySelector('svg');
        return {bg:c.backgroundColor,border:c.borderTopColor,shadow:c.boxShadow==='none'?'none':c.boxShadow.slice(0,60),
                opacity:c.opacity,scale:c.transform};};
      return {play:pick(document.querySelector('.orb-primary')),
              sibling:pick(document.querySelector('.orb-bare')),
              lit:pick(document.querySelector('.art-zone .bigheart')||document.querySelector('.orb-primary'))};
    })()`);

  const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });

  const away = { x: 8, y: 8 };
  await move(away.x, away.y);
  await new Promise((r) => setTimeout(r, 320));
  const idle = await read();

  await move(box.x, box.y);
  await new Promise((r) => setTimeout(r, 320));
  const onPlay = await read();

  await move(sib.x, sib.y);
  await new Promise((r) => setTimeout(r, 320));
  const onSibling = await read();

  await move(away.x, away.y);

  const fmt = (l, s) =>
    `${l.padEnd(12)} play: bg=${s.play.bg} shadow=${s.play.shadow} op=${s.play.opacity}\n` +
    `${''.padEnd(12)} sibling: bg=${s.sibling.bg} shadow=${s.sibling.shadow} op=${s.sibling.opacity}`;

  console.log(fmt("IDLE", idle));
  console.log(fmt("HOVER PLAY", onPlay));
  console.log(fmt("HOVER SKIP", onSibling));

  const plate = onPlay.play.shadow !== "none" || !/rgba\(0, 0, 0, 0\)|transparent/.test(onPlay.play.bg);
  console.log("\nplate on hovered play button:", plate ? "STILL THERE" : "gone");
  console.log(
    "peers dim while play hovered:",
    Number(onPlay.sibling.opacity) < 0.6 ? `yes (${onPlay.sibling.opacity})` : `NO (${onPlay.sibling.opacity})`,
  );
  console.log(
    "play fully opaque when hovered:",
    Number(onPlay.play.opacity) === 1 ? "yes" : `NO (${onPlay.play.opacity})`,
  );
  ws.close();
}

main().catch((e) => {
  console.error("probe failed:", e.message ?? e);
  process.exit(1);
});
