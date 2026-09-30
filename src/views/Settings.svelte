<script lang="ts">
  /**
   * Settings that actually do something.
   *
   * Every control here writes to the settings store, which persists it and pushes it to CSS custom
   * properties, so the change is visible immediately rather than after a restart. The blur and
   * dimming sliders exist because the owner's own answer to the aesthetics-vs-frame-rate tension was
   * "let the user choose" — a fixed value is always wrong for somebody's GPU or somebody's cover.
   */
  import { invoke } from "@tauri-apps/api/core";
  import Icon from "../components/Icon.svelte";
  import { blocked } from "../stores/blocked.svelte";
  import { library } from "../stores/library.svelte";
  import { player } from "../stores/player.svelte";
  import { openExternal } from "../services/shell";
  import { settings, type LaunchAction, type RepeatMode } from "../stores/settings.svelte";
  import { leadArtist } from "../data/track";

  let rustVersion = $state("querying…");
  let rustError = $state("");

  /** The version arrives from Rust as "noctra 0.1.0"; the signature shows the number alone. */
  const versionNumber = $derived(
    rustVersion.startsWith("noctra ") ? rustVersion.slice("noctra ".length) : rustVersion,
  );

  /** Kept as data so the two link rows cannot drift apart into different shapes. */
  const LINKS = [
    {
      label: "Instagram",
      handle: "@soutrik_debnath",
      url: "https://www.instagram.com/soutrik_debnath",
    },
    {
      label: "GitHub",
      handle: "Soutrik-Debnath",
      url: "https://github.com/Soutrik-Debnath",
    },
    {
      label: "Telegram",
      handle: "@Soutrik_Debnath",
      url: "https://t.me/Soutrik_Debnath",
    },
  ];

  /** Blocked entries are stored by id, so the label has to be resolved back out of the library. */
  const blockedSongs = $derived([...blocked.trackIds]);
  const blockedArtists = $derived([...blocked.artists]);

  function songLabel(id: string): string {
    const t = library.tracks.find((x) => x.id === id);
    return t ? `${t.title} — ${leadArtist(t.artist)}` : "File no longer in the library";
  }

  $effect(() => {
    invoke<string>("app_version")
      .then((v) => (rustVersion = v))
      .catch((e) => (rustError = String(e)));
  });

  const REPEAT_MODES: { value: RepeatMode; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "all", label: "All" },
    { value: "one", label: "One" },
    { value: "times", label: "N times" },
  ];

  /*
     Labelled "Random" rather than "Shuffle" on purpose. The Shuffle toggle above it is about the order
     the library plays in; this is about which song the app opens on. Two controls reading "Shuffle"
     side by side would be a coin flip for anyone setting up the app once and never reading the manual.
  */
  const LAUNCH_ACTIONS: { value: LaunchAction; label: string }[] = [
    { value: "resume", label: "Resume" },
    { value: "shuffle", label: "Random" },
  ];

  function offsetLabel(ms: number) {
    if (ms === 0) return "In sync";
    return `${ms > 0 ? "+" : "−"}${Math.abs(ms)} ms`;
  }
</script>

<div class="page">
  <header>
    <h1>Settings</h1>
    <p>Changes apply the moment you make them and are kept between runs.</p>
  </header>

  <section class="card glass-panel">
    <h2>Appearance</h2>

    <!-- The glass blur and colour-intensity dials were removed. In practice nobody lands on a
         better number than the tuned default by dragging a slider, and the backdrop is now built
         from a pre-blurred, chroma-boosted bitmap plus an accent bloom, which a live blur radius
         control cannot express. Extra dimming stayed, because that one has an honest answer that
         depends on the room and the cover. -->
    <label class="row">
      <span class="stack">
        <span class="label">Extra dimming</span>
        <span class="hint">Darkens the background for easier reading. Noctra already dims bright
          covers by itself; this is on top of that.</span>
      </span>
      <span class="control">
        <input type="range" min="0" max="0.4" step="0.02" value={settings.value.backdropDim}
          oninput={(e) => settings.set("backdropDim", Number(e.currentTarget.value))} />
        <span class="num">{Math.round(settings.value.backdropDim * 100)}%</span>
      </span>
    </label>

    <!-- Corner rounding is deliberately a percentage, not a pixel value, and it is not the same kind
         of dial as the glass-blur and colour-intensity controls removed above. Those had no
         aesthetically valid answer at the margin — past a point the backdrop stops being legible —
         whereas soft-versus-sharp corners is a real taste axis that costs nothing in contrast.
         Shown as a scale so the shipped relationship between artwork, cards and the floating rail
         survives, and so the base numbers live in exactly one file. -->
    <label class="row">
      <span class="stack">
        <span class="label">Corner rounding</span>
        <span class="hint">How rounded the album art, cards and the side rail are. 100% is the
          shipped look; lower goes toward sharp edges.</span>
      </span>
      <span class="control">
        <input type="range" min="0" max="200" step="5" value={settings.value.cornerScale}
          oninput={(e) => settings.set("cornerScale", Number(e.currentTarget.value))} />
        <span class="num">{settings.value.cornerScale}%</span>
      </span>
    </label>

    <button class="row toggle" onclick={() => settings.set("lowPower", !settings.value.lowPower)}>
      <span class="stack">
        <span class="label">Low power</span>
        <span class="hint">Stops the background drifting. Saves a little battery and a few frames.</span>
      </span>
      <span class="switch" class:on={settings.value.lowPower} role="switch"
        aria-checked={settings.value.lowPower}><span class="knob"></span></span>
    </button>
  </section>

  <section class="card glass-panel">
    <h2>Playback</h2>

    <button class="row toggle" onclick={() => (player.shuffle = !player.shuffle)}>
      <span class="stack">
        <span class="label">Shuffle</span>
        <span class="hint">Play the library in a random order. Keyboard: S</span>
      </span>
      <span class="switch" class:on={player.shuffle} role="switch" aria-checked={player.shuffle}>
        <span class="knob"></span>
      </span>
    </button>

    <div class="row">
      <span class="stack">
        <span class="label">On launch</span>
        <span class="hint">Resume reopens the song you left on, at the point you left it. Random starts
          on a different song each time. Neither one plays by itself — the song is loaded and waits for
          you.</span>
      </span>
      <div class="segmented" role="radiogroup" aria-label="Which song opens on launch">
        {#each LAUNCH_ACTIONS as opt (opt.value)}
          <button
            class="seg"
            class:on={settings.value.onLaunch === opt.value}
            role="radio"
            aria-checked={settings.value.onLaunch === opt.value}
            onclick={() => settings.set("onLaunch", opt.value)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="row">
      <span class="stack">
        <span class="label">Repeat</span>
        <span class="hint">Keyboard: R cycles off, all and one. Right-click the repeat button on the
          player for the counts.</span>
      </span>
      <div class="segmented" role="radiogroup" aria-label="Repeat mode">
        {#each REPEAT_MODES as mode (mode.value)}
          <button
            class="seg"
            class:on={player.repeat === mode.value}
            role="radio"
            aria-checked={player.repeat === mode.value}
            onclick={() => (player.repeat = mode.value)}
          >
            {mode.label}
          </button>
        {/each}
      </div>
    </div>

    {#if player.repeat === "times"}
      <label class="row">
        <span class="stack">
          <span class="label">Plays per track</span>
          <span class="hint">Each song plays this many times before the run moves on to the next.</span>
        </span>
        <span class="control">
          <input type="range" min="2" max="20" step="1" value={player.repeatTimes}
            oninput={(e) => player.setRepeatTimes(Number(e.currentTarget.value))} />
          <span class="num">{player.repeatTimes}×</span>
        </span>
      </label>
    {/if}

    <button class="row toggle" onclick={() => settings.set("gapless", !settings.value.gapless)}>
      <span class="stack">
        <span class="label">Gapless playback</span>
        <span class="hint">Decodes the next song early so there is no gap at the boundary. Seamless
          rather than sample-accurate — a few milliseconds either way is normal, and joining to the
          sample would need a different audio engine.</span>
      </span>
      <span class="switch" class:on={settings.value.gapless} role="switch"
        aria-checked={settings.value.gapless}><span class="knob"></span></span>
    </button>

    {#if settings.value.gapless}
      <label class="row">
        <span class="stack">
          <span class="label">Crossfade</span>
          <span class="hint">Overlap the outgoing and incoming song by this many seconds. Zero keeps a
            clean join with no fade.</span>
        </span>
        <span class="control">
          <input type="range" min="0" max="12" step="0.5" value={settings.value.crossfadeSec}
            oninput={(e) => settings.set("crossfadeSec", Number(e.currentTarget.value))} />
          <span class="num">{settings.value.crossfadeSec}s</span>
        </span>
      </label>
    {/if}

    <button class="row toggle" onclick={() => settings.set("romanise", !settings.value.romanise)}>
      <span class="stack">
        <span class="label">Romanise lyrics</span>
        <span class="hint">Replaces the line with a Latin-alphabet reading. Covers Hindi, Bengali,
          Punjabi and Gujarati; word-level highlighting is dropped on those lines. Not attempted for
          Japanese, Korean, Chinese or the Dravidian scripts — a wrong reading is worse than none.</span>
      </span>
      <span class="switch" class:on={settings.value.romanise} role="switch"
        aria-checked={settings.value.romanise}><span class="knob"></span></span>
    </button>

    <label class="row">
      <span class="stack">
        <span class="label">Lyrics timing</span>
        <span class="hint">Nudge the words earlier or later if they are running ahead of the singer.</span>
      </span>
      <span class="control">
        <input type="range" min="-3000" max="3000" step="50" value={settings.value.lyricsOffset}
          oninput={(e) => settings.set("lyricsOffset", Number(e.currentTarget.value))} />
        <span class="num">{offsetLabel(settings.value.lyricsOffset)}</span>
      </span>
    </label>

    <label class="row">
      <span class="stack">
        <span class="label">Lyrics size</span>
        <span class="hint">How large the words are on screen.</span>
      </span>
      <span class="control">
        <input type="range" min="70" max="150" step="2" value={settings.value.lyricsScale}
          oninput={(e) => settings.set("lyricsScale", Number(e.currentTarget.value))} />
        <span class="num">{settings.value.lyricsScale}%</span>
      </span>
    </label>

    <label class="row">
      <span class="stack">
        <span class="label">Softness of other lines</span>
        <span class="hint">How out-of-focus the lines you are not singing look.</span>
      </span>
      <span class="control">
        <input type="range" min="0" max="10" step="0.5" value={settings.value.lyricsBlur}
          oninput={(e) => settings.set("lyricsBlur", Number(e.currentTarget.value))} />
        <span class="num">{settings.value.lyricsBlur.toFixed(1)}px</span>
      </span>
    </label>

    <label class="row">
      <span class="stack">
        <span class="label">Fade of other lines</span>
        <span class="hint">How far the lines you are not singing dim. Kept separate from softness so
          you can have faint-but-sharp or bright-but-blurred.</span>
      </span>
      <span class="control">
        <input type="range" min="0" max="80" step="2" value={settings.value.lyricsDim}
          oninput={(e) => settings.set("lyricsDim", Number(e.currentTarget.value))} />
        <span class="num">{settings.value.lyricsDim}%</span>
      </span>
    </label>
  </section>

  <section class="card glass-panel">
    <h2>Music library</h2>

    <button class="row toggle" onclick={() => settings.set("autoScan", !settings.value.autoScan)}>
      <span class="stack">
        <span class="label">Check for new music</span>
        <span class="hint">Re-reads your folders when the window regains focus and every ten
          minutes. Files are never removed automatically.</span>
      </span>
      <span class="switch" class:on={settings.value.autoScan} role="switch"
        aria-checked={settings.value.autoScan}><span class="knob"></span></span>
    </button>

    {#if library.roots.length === 0}
      <p class="hint pad">No folders yet. Add one from the Library page.</p>
    {:else}
      {#each library.roots as root (root)}
        <div class="row folder">
          <span class="stack">
            <span class="label path">{root}</span>
            <span class="hint">
              {library.tracks.filter((t) => t.path.startsWith(root)).length} tracks
            </span>
          </span>
          <button
            class="btn btn-sm btn-danger"
            title="Remove this folder from Noctra. Your files are not touched."
            onclick={() => void library.removeRoot(root)}
          >
            Remove
          </button>
        </div>
      {/each}
    {/if}

    {#if blockedSongs.length + blockedArtists.length === 0}
      <p class="hint pad">Nothing is set to never play. Right-click a song or artist to park it here.</p>
    {:else}
      <div class="row">
        <span class="stack">
          <span class="label">Never play</span>
          <span class="hint">Kept out of shuffle, autoplay and "Play similar" — still there when you
            choose it yourself, and your files are never touched.</span>
          <span class="chips">
            {#each blockedArtists as name (name)}
              <button class="chip" title="Allow {name} again" onclick={() => blocked.unblockArtist(name)}>
                {name}
                <Icon name="close" size={12} />
              </button>
            {/each}
            {#each blockedSongs as id (id)}
              <button class="chip" title="Allow this song again" onclick={() => blocked.unblockTrack(id)}>
                {songLabel(id)}
                <Icon name="close" size={12} />
              </button>
            {/each}
          </span>
        </span>
        <button class="btn btn-sm" onclick={() => blocked.clear()}>Allow everything</button>
      </div>
    {/if}
  </section>

  <section class="card glass-panel">
    <h2>About</h2>
    <div class="row">
      <span class="stack">
        <span class="label">Backend bridge</span>
        <span class="hint">Proves the app can talk to Rust. It is a real call, not a hardcoded
          string.</span>
      </span>
      <span class="value" class:bad={!!rustError}>{rustError || rustVersion}</span>
    </div>
    <div class="row">
      <span class="stack">
        <span class="label">Lyrics source</span>
        <span class="hint">Fetched from LRCLIB when a song has no local lyrics file, then cached on
          disk and never re-downloaded.</span>
      </span>
      <span class="value">lrclib.net</span>
    </div>
    <div class="row">
      <span class="stack">
        <span class="label">Reset settings</span>
        <span class="hint">Back to the defaults. Your library and favourites are not touched.</span>
      </span>
      <button class="btn btn-sm btn-danger" onclick={() => settings.reset()}>Reset</button>
    </div>
  </section>

  <section class="card glass-panel credits">
    <h2>Credits</h2>

    <div class="signature">
      <span class="mark">Noctra</span>
      <p class="made">
        Made with
        <span class="love"><Icon name="heart-filled" size={13} /></span>
        by Soutrik Debnath
      </p>
      {#if !rustError}
        <span class="ver">v{versionNumber}</span>
      {/if}
    </div>

    {#each LINKS as link (link.url)}
      <button class="row toggle" onclick={() => void openExternal(link.url)}>
        <span class="stack">
          <span class="label">{link.label}</span>
          <span class="hint">Opens in your browser.</span>
        </span>
        <span class="value handle">{link.handle}
          <Icon name="chevron" size={13} /></span>
      </button>
    {/each}

    <div class="row">
      <span class="stack">
        <span class="label">Built with</span>
        <span class="hint">Svelte for the interface, Tauri for the window and Lofty for reading the
          tags. Every one of them free and open.</span>
      </span>
      <span class="value">MIT / Apache-2.0</span>
    </div>

    <div class="row">
      <span class="stack">
        <span class="label">Type</span>
        <span class="hint">The text you are reading, the display faces and the Bodoni wordmark above.
          Bundled in the app, never fetched.</span>
      </span>
      <span class="value">OFL 1.1</span>
    </div>

    <div class="row">
      <span class="stack">
        <span class="label">Privacy</span>
        <span class="hint">No account, no analytics, no crash reports. The only thing that ever
          leaves this machine is a lyric lookup.</span>
      </span>
      <span class="value">Local only</span>
    </div>

    <p class="rights">© 2026 Soutrik Debnath · Noctra plays files you already own.</p>
  </section>
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 32px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  header h1 {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.4px;
  }

  header p {
    margin-top: 6px;
    font-size: var(--fs-base);
    color: var(--text-dim);
  }

  .card {
    max-width: 760px;
    padding: 6px 22px 10px;
  }

  h2 {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.9px;
    text-transform: uppercase;
    color: var(--text-faint);
    padding: 16px 0 6px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 28px;
    width: 100%;
    text-align: left;
    padding: 15px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  .row:last-child {
    border-bottom: none;
  }

  /*
     `controls.css` defines a global `.row` for track-list rows, and it carries a hover plate
     (`--card-hover` on a 12px-rounded box) plus a press squeeze. Settings reuses the class name purely
     for its flex layout, so every setting inherited an affordance meant for a clickable song row — a
     rounded block lighting up behind whichever control the pointer happens to cross, which reads as a
     glitch rather than feedback. There is nothing to click on a slider row.

     The same collision is what forced the transport to rename itself (see the note in
     PlayerControls.svelte). Overriding here rather than renaming keeps the shared layout rules, and
     the real clickable rows below keep their own deliberately fainter `button.row:hover` tint, which
     wins on specificity.
  */
  .row:hover,
  .row:active {
    background-color: transparent;
    border-color: transparent;
    /* `border-color` is a shorthand, so cancelling the global hover's ring also erased the divider
       this row draws for itself — the line under each setting blinked out from under the pointer.
       Hand the bottom edge back. `:last-child` needs no exception: its `border-bottom: none` is a
       style, and this rule only touches colour. */
    border-bottom-color: rgba(255, 255, 255, 0.07);
    transform: none;
  }

  button.row {
    transition: background-color 160ms var(--ease-out);
  }

  button.row:hover {
    background-color: rgba(255, 255, 255, 0.035);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .label {
    font-size: var(--fs-md);
    font-weight: 600;
    color: var(--text);
  }

  .hint {
    font-size: var(--fs-sm);
    line-height: 1.45;
    color: var(--text-dim);
    max-width: 46ch;
  }

  .pad {
    padding: 8px 0 16px;
  }

  /* Removable tags for the block list. The global `.chip` is a label; these are buttons, so they
     need a hit target and a cursor of their own. */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 9px;
  }

  .chips :global(.chip) {
    gap: 6px;
    max-width: 260px;
    padding: 0 10px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
    transition: color 140ms var(--ease-out), border-color 140ms var(--ease-out);
  }

  .chips :global(.chip):hover {
    color: var(--text);
    border-color: rgb(var(--accent-rgb) / 0.55);
  }

  .path {
    font-size: var(--fs-base);
    font-weight: 500;
    word-break: break-all;
  }

  .control {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .control input {
    width: 150px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .num {
    font-size: var(--fs-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    /* --text-dim measured 4.09:1 here once D-073 made the pane deliberately more transparent, so the
       backdrop became the cover wash instead of a fixed panel tone. Full ink fixes the one number
       without touching the global veil that the contrast bracket depends on. */
    color: var(--text);
    min-width: 62px;
    text-align: right;
  }

  .value {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--accent-text);
    white-space: nowrap;
    transition: color 500ms var(--ease-out);
  }

  .value.bad {
    color: #ffb3b8;
  }

  .switch {
    flex: none;
    width: 44px;
    height: 25px;
    border-radius: var(--radius-pill);
    padding: 2px;
    background-color: rgba(255, 255, 255, 0.13);
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.35);
    transition: background-color 220ms var(--ease-out);
  }

  .switch.on {
    background-color: var(--accent);
    border-color: rgba(255, 255, 255, 0.4);
  }

  .knob {
    display: block;
    width: 19px;
    height: 19px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--elev-1);
    transition: transform 220ms var(--ease-out);
  }

  .switch.on .knob {
    transform: translateX(19px);
  }

  .segmented {
    display: flex;
    flex: none;
    padding: 3px;
    gap: 3px;
    border-radius: var(--radius-pill);
    background-color: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .seg {
    height: 28px;
    padding: 0 14px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim);
    transition:
      background-color 180ms var(--ease-out),
      color 180ms var(--ease-out);
  }

  .seg.on {
    background-color: rgb(var(--accent-rgb) / 0.24);
    color: var(--text);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
  }

  .folder .stack {
    flex: 1;
  }

  /* --- Credits footer --- */

  .signature {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 0 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  }

  /* The Bodoni lockup from `fonts/brand.css`, which exists for precisely this: the name has to read
     as a mark rather than as one more label in a list of labels. */
  .mark {
    font-family: var(--font-brand);
    font-size: 34px;
    font-weight: 500;
    letter-spacing: 0.5px;
    line-height: 1;
    color: var(--text);
    text-shadow: var(--text-shadow);
  }

  .made {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-md);
    color: var(--text-dim);
  }

  /* The app's own traced heart in the like colour, not a system emoji: an emoji picks whatever face
     the OS happens to ship, ignores the accent system entirely, and is the one glyph here nobody
     else on the page drew to the same weight. The shadow is the standard tight dark one rather than
     a glow, because on a red cover a red glow is the same hue as the background behind it. */
  .love {
    display: inline-flex;
    color: var(--love);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.7));
  }

  .ver {
    padding: 3px 9px;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    font-size: var(--fs-2xs);
    font-weight: 700;
    letter-spacing: 1.1px;
    color: var(--text-faint);
  }

  .value.handle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .rights {
    padding: 14px 0 4px;
    font-size: var(--fs-xs);
    letter-spacing: 0.3px;
    color: var(--text-faint);
  }
</style>
