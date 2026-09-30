/**
 * The app's icon geometry: original shapes drawn on a 24x24 grid, authored here rather than lifted
 * from any product's artwork.
 *
 * `paths` are stroked, `filled` are solid. Kept out of Icon.svelte so `IconName` can be imported by
 * other modules — a type exported from a component's instance script does not hoist.
 */
export const paths = {
  home: ["M4 10.6 12 4.2l8 6.4V19a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 19z", "M9.4 20.4v-6.2h5.2v6.2"],
  library: ["M5.6 4.4v15.2", "M10.6 4.4v15.2", "M18.9 5.1l-3.6 14.5"],
  playlists: ["M4.2 6.4h11", "M4.2 11.4h11", "M4.2 16.4h6.6", "M17.4 13.1v6", "M15.6 19.6a1.8 1.8 0 1 0 3.6 0 1.8 1.8 0 0 0-3.6 0"],
  /*
     Traced from the owner's own reference outline, not drafted by hand.

     This replaces a shape that had been changed three times on adjectives alone — "too roundy on the
     bottom half", then "way too pointy in the bottom half" — which is the signature of arguing about a
     curve without measuring it. `scripts/trace-heart.mjs` reads the reference, picks the ink polarity
     from the mean luminance (this reference is dark line on white; the previous one was the reverse),
     takes the outline's largest connected component so the watermark in the corner cannot contaminate
     the fit, mirror-averages the per-column profile to remove the hand-drawn lean (12px residual
     asymmetry over 941px), resamples by arc length and emits a closed Catmull-Rom curve onto this 24
     grid.

     It then evaluates the beziers it just emitted and reports how far they stray from the source,
     because the failure mode of arc-length resampling is silent: it shaves the two points a heart is
     recognised by. At 44 samples the cleft loses 13px and the apex 7.5px. 80 — the default, and the
     measured floor — gives mean 0.14px off a 941px outline, worst 3px, apex within 0.1px, cleft within
     0.5px. SAMPLES is an environment argument, not a constant, so the next reference can be swept.

     Metrics, so the next adjustment is a number and not a feeling: aspect 1.05 (w/h), mapped box
     16.4 x 15.56, cleft depth 12% of height, apex at y=20.4.

     Do not re-draft this by eye. If it needs changing, change the reference and re-run the tracer.
     See PROGRESS.md D-087 for the round-trip this ends.
  */
  heart: [
    "M3.8 8.82C3.82 8.61 3.88 8.4 3.93 8.2C3.99 7.99 4.05 7.79 4.13 7.59C4.21 7.4 4.31 7.2 4.41 7.02C4.52 6.84 4.64 6.66 4.77 6.5C4.91 6.33 5.05 6.17 5.21 6.03C5.36 5.88 5.53 5.74 5.7 5.62C5.87 5.5 6.06 5.39 6.24 5.3C6.43 5.2 6.63 5.12 6.83 5.06C7.04 4.99 7.25 4.95 7.45 4.91C7.66 4.88 7.88 4.85 8.09 4.85C8.3 4.84 8.51 4.85 8.72 4.88C8.93 4.9 9.14 4.93 9.35 4.98C9.56 5.03 9.76 5.1 9.96 5.18C10.15 5.25 10.35 5.35 10.53 5.45C10.71 5.56 10.89 5.68 11.06 5.81C11.22 5.94 11.38 6.08 11.53 6.23C11.68 6.39 11.8 6.71 11.94 6.72C12.08 6.74 12.23 6.46 12.38 6.32C12.53 6.18 12.68 6.01 12.84 5.88C13 5.74 13.18 5.62 13.36 5.51C13.54 5.4 13.73 5.3 13.92 5.22C14.12 5.14 14.32 5.07 14.52 5.01C14.73 4.96 14.94 4.92 15.15 4.89C15.36 4.86 15.57 4.84 15.78 4.85C16 4.85 16.21 4.87 16.42 4.9C16.63 4.93 16.84 4.97 17.04 5.03C17.24 5.09 17.44 5.16 17.64 5.25C17.83 5.34 18.02 5.44 18.19 5.56C18.37 5.68 18.54 5.81 18.69 5.95C18.85 6.09 19 6.25 19.14 6.41C19.27 6.57 19.4 6.74 19.51 6.92C19.62 7.1 19.72 7.29 19.81 7.49C19.89 7.68 19.96 7.88 20.02 8.09C20.08 8.29 20.12 8.5 20.15 8.71C20.18 8.92 20.18 9.13 20.18 9.34C20.19 9.56 20.19 9.77 20.17 9.98C20.15 10.19 20.1 10.4 20.05 10.61C20.01 10.81 19.95 11.02 19.88 11.22C19.82 11.42 19.74 11.62 19.66 11.82C19.57 12.01 19.48 12.2 19.38 12.39C19.29 12.58 19.18 12.77 19.08 12.95C18.97 13.13 18.85 13.31 18.74 13.49C18.62 13.67 18.5 13.84 18.38 14.02C18.25 14.19 18.13 14.36 17.99 14.53C17.86 14.69 17.73 14.86 17.59 15.02C17.46 15.18 17.32 15.35 17.18 15.5C17.04 15.66 16.89 15.82 16.74 15.97C16.6 16.13 16.45 16.28 16.31 16.43C16.16 16.59 16.01 16.74 15.86 16.89C15.71 17.04 15.56 17.19 15.4 17.33C15.25 17.48 15.1 17.63 14.94 17.77C14.79 17.92 14.63 18.06 14.48 18.21C14.32 18.35 14.17 18.5 14.01 18.64C13.85 18.79 13.69 18.93 13.53 19.07C13.38 19.21 13.22 19.35 13.06 19.49C12.9 19.63 12.74 19.78 12.57 19.9C12.41 20.02 12.23 20.21 12.05 20.22C11.87 20.23 11.67 20.08 11.5 19.97C11.32 19.86 11.17 19.7 11.01 19.56C10.85 19.42 10.69 19.28 10.53 19.14C10.37 19 10.22 18.86 10.06 18.71C9.9 18.57 9.74 18.43 9.59 18.28C9.43 18.14 9.28 18 9.12 17.85C8.97 17.7 8.81 17.56 8.66 17.41C8.51 17.26 8.36 17.12 8.2 16.97C8.05 16.82 7.9 16.66 7.76 16.51C7.61 16.36 7.46 16.21 7.31 16.06C7.16 15.9 7.02 15.75 6.88 15.59C6.74 15.43 6.6 15.27 6.46 15.11C6.32 14.94 6.19 14.78 6.06 14.61C5.93 14.45 5.8 14.28 5.67 14.11C5.55 13.93 5.42 13.76 5.31 13.58C5.19 13.41 5.07 13.23 4.96 13.05C4.85 12.86 4.75 12.68 4.65 12.49C4.55 12.3 4.46 12.11 4.37 11.92C4.28 11.72 4.21 11.53 4.14 11.33C4.07 11.13 4 10.92 3.95 10.72C3.9 10.51 3.86 10.3 3.84 10.09C3.81 9.88 3.81 9.67 3.8 9.46C3.79 9.24 3.78 9.03 3.8 8.82Z",
  ],
  /*
     Settings as a mixer, not a gear.

     The gear here was a traced path full of `.05` and `h.06` micro-offsets — ten teeth drawn to be
     geometrically faithful at 24px, which at the 18-20px it actually renders in the orb row and the
     sidebar collapses into mud, because the notches are narrower than the 2.15 stroke that has to draw
     them. No amount of tidying fixes that: a gear's detail is below this set's line weight.

     Three tracks with knobs at different positions reads at any size, is a common preferences mark,
     and suits a player that already has queue, lyrics timing and an EQ to put behind it.
  */
  settings: [
    "M3.6 6.2h10",
    "M18.8 6.2h1.6",
    "M16.2 4.2a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
    "M3.6 12h1.7",
    "M10.5 12h9.9",
    "M7.9 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
    "M3.6 17.8h6.7",
    "M15.5 17.8h4.9",
    "M12.9 15.8a2 2 0 1 0 0 4 2 2 0 1 0 0-4z",
  ],
  shuffle: ["M3.4 6.6h3.4c1.5 0 2.4.8 3.3 2.1l4 6c.9 1.3 1.8 2.1 3.3 2.1h2.2", "M17.6 4.6l2.9 2.1-2.9 2.1", "M3.4 17.4h3.4c1.3 0 2.2-.6 3-1.6", "M14.1 8.2c.9-1.3 1.8-1.6 3.1-1.6h3.3", "M17.6 14.2l2.9 2.1-2.9 2.1"],
  repeat: ["M7.4 5.6h9.2a3 3 0 0 1 3 3v.6", "M10.1 3.3l-2.7 2.3 2.7 2.3", "M16.6 18.4H7.4a3 3 0 0 1-3-3v-.6", "M13.9 20.7l2.7-2.3-2.7-2.3"],
  // Same loop with a "1" in the middle, so the three repeat states are one family.
  "repeat-one": ["M7.4 5.6h9.2a3 3 0 0 1 3 3v.6", "M10.1 3.3l-2.7 2.3 2.7 2.3", "M16.6 18.4H7.4a3 3 0 0 1-3-3v-.6", "M13.9 20.7l2.7-2.3-2.7-2.3", "M11.2 10.7l1.2-.9v5.3"],
  volume: ["M4.6 9.4h3L11.6 6v12L7.6 14.6h-3z", "M15.4 9.2a4 4 0 0 1 0 5.6", "M18 6.8a7.4 7.4 0 0 1 0 10.4"],
  "volume-mute": ["M4.6 9.4h3L11.6 6v12L7.6 14.6h-3z", "M15.6 9.8l4.6 4.4", "M20.2 9.8l-4.6 4.4"],
  close: ["M5.8 5.8l12.4 12.4", "M18.2 5.8L5.8 18.2"],
  fullscreen: ["M9 4.2H4.2V9", "M15 4.2h4.8V9", "M15 19.8h4.8V15", "M9 19.8H4.2V15"],
  "fullscreen-exit": ["M4.2 9H9V4.2", "M19.8 9H15V4.2", "M19.8 15H15v4.8", "M4.2 15H9v4.8"],
  queue: ["M4.2 7h11", "M4.2 12h11", "M4.2 17h7", "M17.4 12.5v7", "M15.8 19.5a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 0 0-3.4 0"],
  search: ["M10.8 17.4a6.6 6.6 0 1 0 0-13.2 6.6 6.6 0 0 0 0 13.2z", "M15.6 15.6l4 4"],
  layout: ["M4.2 5.4h15.6v13.2H4.2z", "M4.2 10.2h15.6", "M11 10.2v8.4"],
  lyrics: ["M4.6 7.2h14.8", "M4.6 12h14.8", "M4.6 16.8h9"],
  stats: ["M4 20h16", "M7 20v-6.4", "M12 20V4.6", "M17 20v-9.2"],
  plus: ["M12 5.4v13.2", "M5.4 12h13.2"],
  /*
     Picture-in-picture. The old version was "a rectangle with a smaller rectangle inside it", which
     sat two buttons away from `layout` — "a rectangle with lines inside it" — and at 18px those are the
     same object. Here the frame is deliberately broken at the bottom-right and the small panel overlaps
     the gap and runs past it, so it reads as a second window floating above the first.
  */
  pip: [
    "M14.8 17.2H4.8a1.4 1.4 0 0 1-1.4-1.4V6.8a1.4 1.4 0 0 1 1.4-1.4h14.4a1.4 1.4 0 0 1 1.4 1.4v4",
    "M13.4 12.2h7.4v6.2h-7.4z",
  ],
  expand: ["M4.2 9.4V4.2h5.2", "M19.8 9.4V4.2h-5.2", "M4.2 14.6v5.2h5.2", "M19.8 14.6v5.2h-5.2"],
  chevron: ["M9.2 5.6l6.4 6.4-6.4 6.4"],
  trash: ["M4.6 7.2h14.8", "M9.4 7.2V5.1h5.2v2.1", "M6.6 7.2l.9 12.1a1.2 1.2 0 0 0 1.2 1.1h6.6a1.2 1.2 0 0 0 1.2-1.1l.9-12.1", "M10.4 11v6", "M13.6 11v6"],
  clock: ["M12 20.4a8.4 8.4 0 1 0 0-16.8 8.4 8.4 0 0 0 0 16.8z", "M12 7.4V12l3.2 2"],
  folder: ["M3.6 7.1a1.4 1.4 0 0 1 1.4-1.4h3.9l1.9 2.1h7.7a1.4 1.4 0 0 1 1.4 1.4v8.1a1.4 1.4 0 0 1-1.4 1.4H5a1.4 1.4 0 0 1-1.4-1.4z"],
  "list-plus": ["M4.2 7h11", "M4.2 12h8", "M4.2 17h8", "M17.4 9.6v8.4", "M13.2 13.8h8.4"],
  "arrow-left": ["M19.4 12H5.2", "M11.2 5.6 4.8 12l6.4 6.4"],
  check: ["M5 12.6l4.6 4.6L19 7.4"],
  disc: ["M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2z", "M12 14.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z"],
  mic: ["M12 15.2a3.6 3.6 0 0 0 3.6-3.6V6.2a3.6 3.6 0 0 0-7.2 0v5.4a3.6 3.6 0 0 0 3.6 3.6z", "M18 11.6a6 6 0 0 1-12 0", "M12 17.6v3"],
  command: ["M9 4.2H4.2V9", "M15 4.2h4.8V9", "M15 19.8h4.8V15", "M9 19.8H4.2V15", "M9 9h6v6H9z"],
  // Circle with a bar, not a diagonal slash: a slash across a circle is the Unicode "no entry"
  // sign and reads as an error rather than as "this one is parked".
  block: ["M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2z", "M8.2 12h7.6"],
  bookmark: ["M6.6 4.4h10.8v15.4L12 15.5l-5.4 4.3z"],
};

export const filled = {
  play: ["M8.2 5.4a.9.9 0 0 1 1.36-.77l9.1 6.6a.9.9 0 0 1 0 1.54l-9.1 6.6a.9.9 0 0 1-1.36-.77z"],
  // Bars 3.4 units apart and 3 wide. They were 1 unit apart, which read as one blob at small
  // sizes and is the single most-cited complaint about the transport.
  pause: ["M7.3 4.9h3v14.2h-3z", "M13.7 4.9h3v14.2h-3z"],
  // Solid media glyphs. Noctis renders its whole transport as filled geometry rather than thin
  // strokes, and it is why theirs reads as crisp at 18px and mine read as underfed.
  skipBack: [
    "M5.6 5.2h2.3v13.6H5.6z",
    "M19.6 6v12a.8.8 0 0 1-1.25.66l-8.2-6a.8.8 0 0 1 0-1.32l8.2-6A.8.8 0 0 1 19.6 6z",
  ],
  skipForward: [
    "M16.1 5.2h2.3v13.6h-2.3z",
    "M4.4 6v12a.8.8 0 0 0 1.25.66l8.2-6a.8.8 0 0 0 0-1.32l-8.2-6A.8.8 0 0 0 4.4 6z",
  ],
  // Same outline as the stroked `heart`, which is already a closed path — the two states have to
  // be one silhouette or the toggle reads as two different controls.
  "heart-filled": [
    "M3.8 8.82C3.82 8.61 3.88 8.4 3.93 8.2C3.99 7.99 4.05 7.79 4.13 7.59C4.21 7.4 4.31 7.2 4.41 7.02C4.52 6.84 4.64 6.66 4.77 6.5C4.91 6.33 5.05 6.17 5.21 6.03C5.36 5.88 5.53 5.74 5.7 5.62C5.87 5.5 6.06 5.39 6.24 5.3C6.43 5.2 6.63 5.12 6.83 5.06C7.04 4.99 7.25 4.95 7.45 4.91C7.66 4.88 7.88 4.85 8.09 4.85C8.3 4.84 8.51 4.85 8.72 4.88C8.93 4.9 9.14 4.93 9.35 4.98C9.56 5.03 9.76 5.1 9.96 5.18C10.15 5.25 10.35 5.35 10.53 5.45C10.71 5.56 10.89 5.68 11.06 5.81C11.22 5.94 11.38 6.08 11.53 6.23C11.68 6.39 11.8 6.71 11.94 6.72C12.08 6.74 12.23 6.46 12.38 6.32C12.53 6.18 12.68 6.01 12.84 5.88C13 5.74 13.18 5.62 13.36 5.51C13.54 5.4 13.73 5.3 13.92 5.22C14.12 5.14 14.32 5.07 14.52 5.01C14.73 4.96 14.94 4.92 15.15 4.89C15.36 4.86 15.57 4.84 15.78 4.85C16 4.85 16.21 4.87 16.42 4.9C16.63 4.93 16.84 4.97 17.04 5.03C17.24 5.09 17.44 5.16 17.64 5.25C17.83 5.34 18.02 5.44 18.19 5.56C18.37 5.68 18.54 5.81 18.69 5.95C18.85 6.09 19 6.25 19.14 6.41C19.27 6.57 19.4 6.74 19.51 6.92C19.62 7.1 19.72 7.29 19.81 7.49C19.89 7.68 19.96 7.88 20.02 8.09C20.08 8.29 20.12 8.5 20.15 8.71C20.18 8.92 20.18 9.13 20.18 9.34C20.19 9.56 20.19 9.77 20.17 9.98C20.15 10.19 20.1 10.4 20.05 10.61C20.01 10.81 19.95 11.02 19.88 11.22C19.82 11.42 19.74 11.62 19.66 11.82C19.57 12.01 19.48 12.2 19.38 12.39C19.29 12.58 19.18 12.77 19.08 12.95C18.97 13.13 18.85 13.31 18.74 13.49C18.62 13.67 18.5 13.84 18.38 14.02C18.25 14.19 18.13 14.36 17.99 14.53C17.86 14.69 17.73 14.86 17.59 15.02C17.46 15.18 17.32 15.35 17.18 15.5C17.04 15.66 16.89 15.82 16.74 15.97C16.6 16.13 16.45 16.28 16.31 16.43C16.16 16.59 16.01 16.74 15.86 16.89C15.71 17.04 15.56 17.19 15.4 17.33C15.25 17.48 15.1 17.63 14.94 17.77C14.79 17.92 14.63 18.06 14.48 18.21C14.32 18.35 14.17 18.5 14.01 18.64C13.85 18.79 13.69 18.93 13.53 19.07C13.38 19.21 13.22 19.35 13.06 19.49C12.9 19.63 12.74 19.78 12.57 19.9C12.41 20.02 12.23 20.21 12.05 20.22C11.87 20.23 11.67 20.08 11.5 19.97C11.32 19.86 11.17 19.7 11.01 19.56C10.85 19.42 10.69 19.28 10.53 19.14C10.37 19 10.22 18.86 10.06 18.71C9.9 18.57 9.74 18.43 9.59 18.28C9.43 18.14 9.28 18 9.12 17.85C8.97 17.7 8.81 17.56 8.66 17.41C8.51 17.26 8.36 17.12 8.2 16.97C8.05 16.82 7.9 16.66 7.76 16.51C7.61 16.36 7.46 16.21 7.31 16.06C7.16 15.9 7.02 15.75 6.88 15.59C6.74 15.43 6.6 15.27 6.46 15.11C6.32 14.94 6.19 14.78 6.06 14.61C5.93 14.45 5.8 14.28 5.67 14.11C5.55 13.93 5.42 13.76 5.31 13.58C5.19 13.41 5.07 13.23 4.96 13.05C4.85 12.86 4.75 12.68 4.65 12.49C4.55 12.3 4.46 12.11 4.37 11.92C4.28 11.72 4.21 11.53 4.14 11.33C4.07 11.13 4 10.92 3.95 10.72C3.9 10.51 3.86 10.3 3.84 10.09C3.81 9.88 3.81 9.67 3.8 9.46C3.79 9.24 3.78 9.03 3.8 8.82Z",
  ],
  /*
     "Play similar". Two four-point stars, a large one and a satellite.

     It used to live in `paths` as a straight-sided star, and at the 15–22px it actually renders the
     2.15 outline filled the short spikes solid — the mark read as a blob with notches. Solid is the
     only weight that survives there, which is the same finding that made the transport filled.

     The arms are quadratic rather than straight, pinched to 52% of the tip radius at the waist, so the
     silhouette reads as a sparkle rather than as a compass point. Both stars use the same ratio, which
     is what makes the pair look like one object that happens to have a companion.
  */
  sparkle: [
    "M9.45 8.6Q10.8 12.85 15.05 14.2Q10.8 15.55 9.45 19.8Q8.1 15.55 3.85 14.2Q8.1 12.85 9.45 8.6Z",
    "M17.45 3.5Q18.1 5.55 20.15 6.2Q18.1 6.85 17.45 8.9Q16.8 6.85 14.75 6.2Q16.8 5.55 17.45 3.5Z",
  ],
  // Three solid dots. Stroked circles read as tiny rings at 18px, which is not what an overflow
  // trigger should look like.
  more: [
    "M12 3.7a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4z",
    "M12 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4z",
    "M12 16.9a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 1 0 0-3.4z",
  ],
};

export type IconName = keyof typeof paths | keyof typeof filled;
