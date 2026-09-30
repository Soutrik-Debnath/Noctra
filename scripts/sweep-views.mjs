/**
 * Dev tool: run probe-snap-hover.mjs across every surface of the main window in one pass.
 *
 * The probe can only judge elements that are actually mounted, and Svelte mounts one view at a time —
 * so a single run reporting `findings: 0` means "this view is clean", not "the app is clean". Sweeping
 * by hand meant two process spawns and a coordinate lookup per view, and twice produced a clean
 * reading on an empty view because nothing was mounted to measure.
 *
 * So this drives the navigation itself and probes after each hop. The probe is inlined rather than
 * imported: it runs *in the page*, and the page cannot read files, so the source is wrapped in a
 * closure at generation time and the whole thing goes over as one expression.
 *
 * One CDP call per step, not one call for the whole sweep. The single-expression version held one
 * `Runtime.evaluate` open for 20-30s across nine hops, and any Vite HMR full reload during that window
 * — which happens, because other sessions edit this tree live — destroyed the execution context and
 * took the entire run with it. Split per step and a reload costs one hop, which is then retried.
 *
 * Each step reports what it mounted as well as what it found, because an empty view and a clean view
 * return the same number.
 *
 *   node scripts/sweep-views.mjs            main window, every step below
 *   node scripts/sweep-views.mjs --only now,lyricsettings
 *   NOCTRA_CDP_MATCH=mini node scripts/sweep-views.mjs   desktop card (one step, see CARD_STEPS)
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// The probe is written as an IIFE so it can be handed straight to --file, which means it ends in
// `})();`. Parenthesising it to defer the call would put that semicolon inside the parens, so it has
// to come off first.
const probe = readFileSync(join(here, "probe-snap-hover.mjs"), "utf8").replace(/;\s*$/, "");

// `act` runs in the page and may be async; `expect` is matched against the visible surface roots so a
// failed hop is reported instead of silently re-probing whatever was already on screen. The first
// version of this had no assertion and printed nine identical "clean" rows: the fullscreen player was
// open, the nav rail has no client rects behind it, and every click was a no-op.
// `rail: false` skips the pre-hop closeOverlays, for the two steps that deliberately start from inside
// the fullscreen player — unwinding it first would leave them nothing to click.
// `check` is an extra in-page predicate, for steps whose `expect` root string is shared with another
// step and would otherwise pass while sitting on the wrong surface: Library, its Albums facet and an
// opened album are all ".page" under an active "Library" nav.
const STEPS = [
  { name: "home", expect: "Home / home", act: `byName('.nav','Home')?.click()` },
  { name: "library", expect: "Library / page", act: `byName('.nav','Library')?.click()` },
  { name: "albums", expect: "Library / page", check: `vis('.mcard') > 100`,
    act: `byName('.nav','Library')?.click(); await sleep(700); facet('Albums')?.click()` },
  // AlbumPage leaves no nav item active — it is a sub-page, not a rail destination — so the view
  // string reads "(no nav) / page" and only `check` can tell it from the Albums facet behind it.
  { name: "album", expect: "/ page", check: `!!byName('button','Back') && vis('.row') > 0`,
    act: `byName('.nav','Library')?.click(); await sleep(700); facet('Albums')?.click(); await sleep(1200); document.querySelector('.mcard')?.click()` },
  // The other TrackList surface, and a better one: the first album in the grid is a Single, so `album`
  // mounts a single row, while the largest artist has twenty.
  { name: "artist", expect: "/ page", check: `!!byName('button','Back') && vis('.row') > 0`,
    act: `byName('.nav','Library')?.click(); await sleep(700); facet('Artists')?.click(); await sleep(1200); document.querySelector('.mcard')?.click()` },
  { name: "playlists", expect: "Playlists / page", act: `byName('.nav','Playlists')?.click()` },
  { name: "favorites", expect: "Favorites / page", act: `byName('.nav','Favorites')?.click()` },
  { name: "statistics", expect: "Statistics / page", act: `byName('.nav','Statistics')?.click()` },
  { name: "settings", expect: "Settings / page", act: `byName('.nav','Settings')?.click()` },
  { name: "now", expect: "/ stage", rail: false, act: `byLabel('Open fullscreen player')?.click()` },
  // The lyric reel is always mounted inside the player, so `now` already covers it. What this adds is
  // the offset/close/search panel behind "Lyrics settings" — 12 more elements judged, measured. Named
  // for what it actually opens: byLabel(/lyric/i) was matching this same orb anyway, because "Lyrics
  // settings" precedes "Close lyrics" in document order, so the step was never toggling the reel.
  { name: "lyricsettings", expect: "/ stage", rail: false, act: `byExactLabel('Lyrics settings')?.click()` },
  // The Queue orb is a toggle, so clicking it blindly measures whichever state it happens to land in
  // — one run read 172 elements and the next 168 on the same step, purely because the previous run had
  // left the panel open. Open it only if it is shut, and assert on "Close queue", which exists only
  // while the panel is up.
  { name: "queue", expect: "Home / home", check: `!!byExactLabel('Close queue')`,
    act: `byName('.nav','Home')?.click(); await sleep(600); if (!byExactLabel('Close queue')) byExactLabel('Queue')?.click()` },
];

// The desktop card is a separate webview with one surface and no rail, so every step above is
// unreachable from it: each one clicks a nav item that does not exist, the hop is a silent no-op, and
// the run prints twelve identical NAV FAILED rows. Running STEPS against it was worse than not
// documenting the invocation at all. One step instead, with nothing to navigate — and the `check`
// asserts card-ness, because cdp-eval falls back to the main window when the card is not up, and a
// silent fallback there would report the main window's clean reading as the card's.
const CARD_STEPS = [
  { name: "card", expect: "", check: `location.pathname.includes('mini')`, act: `true` },
];

const argv = process.argv.slice(2);
const isCardTarget = (process.env.NOCTRA_CDP_MATCH || "").includes("mini");
const ALL = isCardTarget ? CARD_STEPS : STEPS;
const only = argv.includes("--only")
  ? argv[argv.indexOf("--only") + 1].split(",").map((s) => s.trim())
  : null;
const steps = only ? ALL.filter((s) => only.includes(s.name)) : ALL;
if (!steps.length) {
  console.error("no steps matched --only; available:", ALL.map((s) => s.name).join(", "));
  process.exit(2);
}

// No backticks anywhere in here: this whole block is interpolated into a template literal below, and a
// backtick inside a comment terminates it (already cost one SyntaxError).
const PRELUDE = `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const txt = (el) => (el.textContent || "").trim().replace(/\\s+/g, " ");
  // Exact-ish match on visible text, so "Library" does not also hit "Library settings".
  const byName = (sel, want) =>
    [...document.querySelectorAll(sel)].find((el) => {
      const t = txt(el);
      return (t === want || t.startsWith(want)) && el.getClientRects().length > 0;
    });
  const byLabel = (re) =>
    [...document.querySelectorAll("button, [role=button], a")].find((el) => {
      const s = (el.getAttribute("aria-label") || el.getAttribute("title") || "") + " " + txt(el);
      return (typeof re === "string" ? s.includes(re) : re.test(s)) && el.getClientRects().length > 0;
    });
  // Whole-string match on the accessible name alone. A substring test for 'Queue' is not enough on
  // Home, where "Queue tracks like this one" sits earlier in document order than the queue orb.
  const byExactLabel = (want) =>
    [...document.querySelectorAll("button, [role=button], a")].find((el) => {
      const s = txt({ textContent: el.getAttribute("aria-label") || el.getAttribute("title") || "" });
      return s === want && el.getClientRects().length > 0;
    });
  // Library's Songs/Albums/Artists tabs. They carry a live count inside the label ("Albums 267"), so
  // an exact text match never finds them — startsWith only.
  const facet = (want) =>
    [...document.querySelectorAll("button.facet")].find(
      (el) => txt(el).startsWith(want) && el.getClientRects().length > 0,
    );
  const vis = (sel) =>
    [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).length;

  // The fullscreen player UNMOUNTS the rail — measured navInDom: 0 while .stage is up, not merely
  // zero client rects — and a click on a selector that matches nothing is a silent no-op. So unwind any
  // overlay before a hop instead of assuming the app is sitting on a view. The player's header
  // "Library" orb is the only way back out: there is no Escape binding (measured — two keydowns on
  // window and document left the rail unmounted), and a broad /close|back/ matcher just finds
  // "Close lyrics" and toggles the lyric panel forever without ever leaving the player.
  //
  // Guard on the URL, never on the rail's presence: "no .nav in the DOM" is also true of the desktop
  // card, which has no rail at all and no overlay to close, and guarding on the rail made this return
  // immediately while inside the player — the exact case it exists for.
  const isCard = location.pathname.includes("mini");
  const navVisible = () =>
    [...document.querySelectorAll(".nav")].some((n) => n.getClientRects().length > 0);
  const closeOverlays = async () => {
    if (isCard) return;
    for (let i = 0; i < 5 && !navVisible(); i++) {
      const exit = byExactLabel("Library") || byExactLabel("Album view");
      if (exit) exit.click();
      else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(600);
    }
  };

  const probe = () => (${probe});
`;

function buildExpression(step) {
  const expect = JSON.stringify(step.expect ?? "");
  const check = step.check ?? "true";
  return `(async () => {
  ${PRELUDE}
  ${step.rail === false ? "" : "await closeOverlays();"}
  ${step.act};
  await sleep(900);
  const rep = JSON.parse(probe());
  rep.landed = (${expect} ? rep.view.includes(${expect}) : true) && (${check});
  return JSON.stringify(rep);
})()`;
}

function runOnce(step) {
  // Unique per step and per process: two sweeps can be running at once when another session picks
  // this up, and a shared temp name would let one overwrite the other's expression mid-flight.
  const tmp = join(here, `.sweep-generated-${process.pid}-${step.name}.mjs`);
  writeFileSync(tmp, buildExpression(step), "utf8");
  try {
    const raw = execFileSync(process.execPath, [join(here, "cdp-eval.mjs"), "--file", tmp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The harness prints a JSON-encoded string, so the report needs two parses.
    const line = raw.split("\n").filter((l) => l.trim()).pop();
    return JSON.parse(JSON.parse(line));
  } finally {
    rmSync(tmp, { force: true });
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let total = 0;
let missed = 0;
const reports = [];

for (const step of steps) {
  let rep = null;
  let lastError = null;
  // Three attempts. "Execution context was destroyed" is the expected transient — a Vite HMR full
  // reload from another session editing this tree — and a reload resets the app to Home, which the
  // next attempt's closeOverlays + act recovers from by itself.
  for (let attempt = 1; attempt <= 3 && !rep; attempt++) {
    try {
      rep = runOnce(step);
    } catch (e) {
      lastError = e;
      const why = (e.stderr || e.message || "").toString().split("\n")[0];
      console.log(`${step.name.padEnd(14)} attempt ${attempt} failed: ${why}`);
      await sleep(1500);
    }
  }
  if (!rep) {
    console.log(`${step.name.padEnd(14)} UNREACHABLE after 3 attempts: ${String(lastError).split("\n")[0]}`);
    missed++;
    continue;
  }
  reports.push(rep);
  const head =
    `${step.name.padEnd(14)} ${rep.landed ? "" : "NAV FAILED "}view="${rep.view}" rules=${rep.rulesRead} ` +
    `judged=${rep.judgedSelectors} measured=${rep.measured} ` +
    `findings=${rep.findings} els=${rep.elementsAffected} swaps=${rep.appearSwaps.length} ` +
    `unmounted=${rep.unmountedSelectors}`;
  console.log(head);
  if (!rep.landed) missed++;
  total += rep.findings;
  // A zero with nothing behind it is not a clean reading.
  if (!rep.measured) console.log("   (nothing mounted to judge — this surface was empty)");
  for (const f of rep.list) {
    console.log(
      `   ! ${f.pseudo} ${f.sel} | on: ${f.on} | x${f.count} | props: ${f.props.join(",")} | have: ${f.have}`,
    );
  }
  for (const a of rep.appearSwaps) {
    console.log(`   ~ swap ${a.sel} | on: ${a.on} | x${a.count} | props: ${a.props.join(",")}`);
  }
}

// Leave the app where a human would expect it, rather than parked on whichever step ran last — and
// with the queue panel shut, so the next run's `queue` step starts from a known state. The card has
// neither a rail nor a queue panel, so there is nothing to park it on.
if (!isCardTarget) {
  try {
    runOnce({
      name: "cleanup",
      expect: "",
      act: `byExactLabel('Close queue')?.click(); await sleep(400); byName('.nav','Home')?.click()`,
    });
  } catch {
    // best effort
  }
}

const swept = reports.length - missed;
console.log(`\n${steps.length} steps, ${swept} actually reached, ${total} findings total`);
process.exit(total || missed ? 1 : 0);
