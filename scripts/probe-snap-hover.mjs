// Which on-screen interactive rules change appearance with no transition behind them?
//
// A hover or active state that snaps is the most common mechanical cause of a UI reading as "sloppy",
// and it is invisible in the source: the `:hover` block looks fine on its own and the base rule that
// was supposed to carry the transition is somewhere else, possibly in another file.
//
// Two-stage, because neither stage alone is trustworthy.
//
// Stage one reads **computed** transition lists rather than declared strings. A first version
// compared declarations and drowned in false positives: `transition: border-color` covers
// `border-top-color` per spec but not per string comparison, and a stem like `.orb:not(:disabled)`
// never matches the `.orb` base rule it inherits from.
//
// Stage two asks the cascade what actually changes. Stage one cannot, and guessing cost three
// separate rounds of hand-verification:
//   - a `background` shorthand in a hover rule reports seven longhands as "changed" even when the
//     value is a plain colour, because the shorthand resets them all to their initial values;
//   - `.orb-primary:not(:disabled):hover` re-declares `transparent`/`none`/`#fff` purely to
//     out-specify `.orb:hover:not(:disabled)`, so it changes nothing at all;
//   - and `.orb:hover:not(:disabled)` *does* declare a real plate — which the primary orb then
//     overrides, so on that one element it changes nothing either. Per-rule analysis sees the
//     declaration and never sees the winner.
// So the surviving candidates get a clone parked beside the original, with every rule that would
// apply under the pseudo mirrored onto it through an attribute selector of identical specificity.
// The clone inherits the same custom properties, resolves the same `var()`s, and the same cascade
// picks the same winner — so comparing computed values against the original is the ground truth.
//
// Run through scripts/cdp-eval.mjs --file.
(() => {
  const PSEUDO = /:(hover|active)/;
  const IGNORE = new Set([
    "transition", "transition-duration", "transition-property",
    "transition-timing-function", "transition-delay",
    // `transition-behavior: allow-discrete` rides along in a `transition` shorthand. It is a
    // transition longhand, not a visual property, and it was showing up as a change.
    "transition-behavior",
  ]);
  // A transition naming the shorthand covers every longhand in it.
  const SHORTHAND = [
    ["border-color", ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]],
    ["border-width", ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"]],
    ["border", ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"]],
    ["background", ["background-image", "background-position-x", "background-position-y", "background-size",
      "background-repeat", "background-attachment", "background-origin", "background-clip", "background-color"]],
    ["inset", ["top", "right", "bottom", "left"]],
    ["gap", ["row-gap", "column-gap"]],
    ["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
    ["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
  ];
  // Never animatable, so a missing transition is not a defect. Discrete by spec. `background-image`
  // is here because swapping one `url()` or one gradient shape for another cannot interpolate; the
  // other background longhands can, so they are reported.
  // `text-overflow` was measured rather than assumed: declared `transition: text-overflow 400ms`,
  // `ellipsis` -> `clip` had already flipped on the first 60ms sample and never passed through an
  // intermediate value. `.title.scrolling:hover` drops the ellipsis while the ticker travels, which
  // is an instant swap by construction and cannot be eased.
  const DISCRETE = new Set(["z-index", "visibility", "display", "pointer-events", "content",
    "background-image", "text-overflow",
    // An animation is not a transition, and this probe's whole model is "the hover rule changed X, so
    // X needs a transition behind it". That does not hold when the change *is* the attachment of an
    // animation: `animation-name` is discrete, and the animation supplies the motion itself.
    // `.title.scrolling:hover .ticker { animation: title-marquee ... }` was reported as four uncovered
    // properties for exactly this — and its first keyframe is `translateX(0)`, the value the element
    // already sits at, so nothing jumps either.
    "animation", "animation-name", "animation-duration", "animation-timing-function",
    "animation-delay", "animation-iteration-count", "animation-direction",
    "animation-fill-mode", "animation-play-state"]);

  const BG_INITIAL = {
    "background-position-x": ["0%"],
    "background-position-y": ["0%"],
    "background-size": ["auto", "auto auto"],
    "background-repeat": ["repeat"],
    "background-attachment": ["scroll"],
    "background-origin": ["padding-box"],
    "background-clip": ["border-box"],
  };
  // Cheap pre-filter for the `background`-shorthand case: if the element already sits at the
  // longhand's initial value, a plain-colour shorthand cannot move it. Saves a clone per property.
  const bgAtInitial = (cs, prop) => {
    const init = BG_INITIAL[prop];
    if (!init) return false;
    return cs[prop].split(",").every((v) => init.includes(v.trim())); // one entry per layer
  };

  // Collected with their ancestor at-rule preludes, so a mirrored rule stays inside the `@media` or
  // `@supports` that gated the original.
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (rs, anc) => {
      for (const r of rs) {
        // Collected *before* recursing. Since CSS nesting every CSSStyleRule carries a `cssRules`
        // list — usually empty, always truthy — so testing that first swallows the whole document.
        if (r.selectorText) rules.push({ r, anc });
        if (r.cssRules && r.cssRules.length) {
          const prelude = r.conditionText || null;
          walk(r.cssRules, prelude ? [...anc, prelude] : anc);
        }
      }
    };
    walk(list, []);
  }

  const covers = (el, prop) => {
    const cs = getComputedStyle(el);
    const props = cs.transitionProperty.split(", ").map((s) => s.trim());
    const durs = cs.transitionDuration.split(", ").map((s) => parseFloat(s) || 0);
    if (props.includes("all")) return durs.some((d) => d > 0);
    const idx = props.indexOf(prop);
    if (idx >= 0) return durs[idx] > 0;
    const group = SHORTHAND.find(([, longs]) => longs.includes(prop));
    if (!group) return false;
    const gi = props.indexOf(group[0]);
    return gi >= 0 && durs[gi] > 0;
  };

  // The clone is parked out of flow with inline position/inset/margin, so those properties read
  // differently by construction and say nothing about the hover state.
  const CLONE_NOISE = new Set(["position", "top", "right", "bottom", "left", "inset",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left"]);

  // Maps a border colour longhand to the side whose width decides whether it is visible at all.
  const SIDE = /^border-(top|right|bottom|left)-color$/;

  const mirror = (el, pseudo, tag) => {
    const test = new RegExp(":" + pseudo + "(?![\\w-])");
    const all = new RegExp(":" + pseudo + "(?![\\w-])", "g");
    let css = "";
    for (const { r, anc } of rules) {
      if (!r.style || !r.style.length) continue;
      const body = r.style.cssText;
      if (!body) continue;
      for (const sel of r.selectorText.split(",").map((s) => s.trim())) {
        if (!test.test(sel)) continue;
        const stem = sel.replace(all, "").trim();
        if (!stem) continue;
        try {
          if (!el.matches(stem)) continue;
        } catch {
          continue; // pseudo-elements and the odd exotic selector
        }
        // `:hover` -> `[data-snap-hover]` is specificity-neutral (both 0,1,0) and keeps source
        // order, so the clone resolves the same winner the real hovered element would.
        css += anc.map((a) => a + "{").join("") +
          sel.replace(all, "[" + tag + "]") + "{" + body + "}" +
          "}".repeat(anc.length);
      }
    }
    return css;
  };

  const realChanges = (el, pseudo, props) => {
    if (!el.parentNode) return props;
    const tag = "data-snap-" + pseudo;
    // Copy first: getComputedStyle returns a live object, and everything below mutates the DOM.
    const cs = getComputedStyle(el);
    const before = {};
    for (const p of props) before[p] = cs[p];
    // Border widths are snapshotted alongside the colours they gate, for the same reason.
    for (const p of props) {
      const side = SIDE.exec(p);
      if (side) before["border-" + side[1] + "-width"] = cs["border-" + side[1] + "-width"];
    }

    const clone = el.cloneNode(true);
    clone.style.position = "fixed";
    clone.style.left = "-9999px";
    clone.style.top = "0";
    clone.style.margin = "0";
    clone.setAttribute(tag, "");
    // Ancestors are marked as well, so a mirrored `.row:hover .p` still reaches the clone.
    const chain = [];
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) chain.push(n);
    const st = document.createElement("style");
    st.textContent = mirror(el, pseudo, tag);
    el.parentNode.insertBefore(clone, el.nextSibling);
    for (const n of chain) n.setAttribute(tag, "");
    document.head.appendChild(st);

    const after = getComputedStyle(clone);
    const out = props.filter((p) => {
      if (CLONE_NOISE.has(p) || before[p] === after[p]) return false;
      // An edge that is not drawn cannot snap. `border: none` leaves the colour resolving to
      // `currentcolor`, so a hover rule that only touches the colour still reads as a computed
      // change on a zero-width edge — Settings' `:last-child` rows were eight findings of exactly
      // this, all invisible. Only dismissed when the width is zero on both sides, so a hover that
      // draws a new border is still reported.
      const side = SIDE.exec(p);
      if (side) {
        const w = "border-" + side[1] + "-width";
        if (!parseFloat(before[w]) && !parseFloat(after[w])) return false;
      }
      return true;
    });

    st.remove();
    for (const n of chain) n.removeAttribute(tag);
    clone.remove();
    return out;
  };

  const cls = (el) =>
    (typeof el.className === "string" ? el.className : el.getAttribute("class")) || el.tagName;

  const findings = [];
  const seen = new Set();
  // Reported separately rather than as defects: the rule takes the element from `display: none` to
  // something rendered, so there is no starting computed value to interpolate from and no transition
  // could ever run on it. `.row:hover .p` swaps a track number for a play glyph this way, which is
  // how the reference players do it too — an instant swap, not a missed ease.
  const appearSwaps = [];
  // Hover rules this pass could not judge, because nothing on the current view matches their stem.
  // Without this the report reads as "the app is clean" when it really means "this view is clean" —
  // Svelte only mounts the view you are looking at, so Library, Settings and the player surfaces are
  // invisible until you navigate to them.
  const unmounted = new Set();
  // Coverage, so a zero can be trusted. `findings: 0` on an empty view and `findings: 0` on a view
  // with four hundred measured elements print identically, and that ambiguity has already produced
  // two false "clean" readings — Playlists and Favorites, both swept while their lists were empty.
  let judgedSelectors = 0;
  let measured = 0;

  for (const { r } of rules) {
    if (!PSEUDO.test(r.selectorText)) continue;
    const changed = [...r.style].filter((p) => !IGNORE.has(p) && !DISCRETE.has(p));
    if (!changed.length) continue;
    const appears = r.style.getPropertyValue("display") && r.style.getPropertyValue("display") !== "none";

    for (const sel of r.selectorText.split(",").map((s) => s.trim())) {
      if (!PSEUDO.test(sel)) continue;
      const pseudo = sel.match(/:(hover|active)/)[1];
      const stem = sel.replace(/:(hover|active)/g, "").trim();
      if (!stem) continue;
      let els;
      try {
        els = document.querySelectorAll(stem);
      } catch {
        continue;
      }
      if (!els.length) {
        unmounted.add(stem.replace(/\.svelte-[a-z0-9]+/g, ""));
        continue;
      }
      judgedSelectors++;
      measured += els.length;
      // Group every match by what it is missing, keyed on the element's own class list so the Svelte
      // hash names the component that owns the gap. Sampling only `els[0]` hid real defects: `.row`
      // is a shared class name, and on one view the first match was a QueuePanel row that *does*
      // cover `transform`, which silently cleared 40 Favorites rows behind it.
      const groups = new Map();
      for (const el of els) {
        const cs = getComputedStyle(el);
        const uncovered = changed.filter((p) => !covers(el, p) && !bgAtInitial(cs, p));
        if (!uncovered.length) continue;
        const gk = uncovered.join(",") + "|" + cls(el);
        const g = groups.get(gk) || { uncovered, el, count: 0 };
        g.count++;
        groups.set(gk, g);
      }
      for (const g of groups.values()) {
        const real = realChanges(g.el, pseudo, g.uncovered);
        if (!real.length) continue;
        if (appears && getComputedStyle(g.el).display === "none") {
          appearSwaps.push({ sel: stem, on: cls(g.el), props: real, count: g.count });
          continue;
        }
        const key = stem + "|" + cls(g.el) + "|" + pseudo + "|" + real.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        const cs = getComputedStyle(g.el);
        findings.push({
          sel: stem,
          on: cls(g.el),
          pseudo,
          props: real,
          have: cs.transitionProperty === "all" && cs.transitionDuration === "0s"
            ? "(no transition)"
            : cs.transitionProperty.slice(0, 60) + " @ " + cs.transitionDuration.slice(0, 30),
          count: g.count,
        });
      }
    }
  }

  findings.sort((a, b) => b.count - a.count);
  const nav = document.querySelector(".nav.active");
  // Visibility-filtered, and not `querySelector(".page, .home, .stage, .now")`: that returns the
  // first match in *document* order, and the Lyrics `.stage` sits above `.home` in the tree, so it
  // labelled the Home view "stage" while the nav rail was plainly mounted and Home was active.
  const root = [...document.querySelectorAll(".page, .home, .stage, .now")]
    .find((el) => el.getClientRects().length > 0);
  // Every visible candidate, not just the winner. The fullscreen player stacks `.now` and `.stage`,
  // and labelling a sweep step by whichever comes first in the tree hid which surface was really up.
  const roots = [...document.querySelectorAll(".page, .home, .stage, .now")]
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => el.className.replace(/\.?svelte-[a-z0-9]+/g, "").trim());
  return JSON.stringify(
    {
      view: (nav ? nav.textContent.trim() : "(no nav)") + " / " + (root ? root.className : "(no root)"),
      roots,
      rulesRead: rules.length,
      judgedSelectors,
      measured,
      findings: findings.length,
      elementsAffected: findings.reduce((n, f) => n + f.count, 0),
      list: findings.slice(0, 30),
      appearSwaps: appearSwaps.slice(0, 10),
      unmountedSelectors: unmounted.size,
      unmounted: [...unmounted].sort().slice(0, 60),
    },
    null,
    1,
  );
})();
