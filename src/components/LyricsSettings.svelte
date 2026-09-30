<script lang="ts">
  /**
   * Lyrics controls, opened in place over the fullscreen view.
   *
   * Deliberately not a trip to the app's Settings page. Every knob here is only meaningful while the
   * words are on screen — you nudge the timing and watch the line land on the syllable. Sending the
   * user to a different page to do that means adjusting blind, so the panel overlays the lyrics and
   * every change is visible immediately behind it.
   */
  import { lyricsStore } from "../stores/lyrics.svelte";
  import { player } from "../stores/player.svelte";
  import { settings } from "../stores/settings.svelte";
  import { deleteCache, lyricsQuery } from "../services/lyrics/lyrics";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  /** Nudge in ms. The offsets people actually reach for are small, so the buttons are too. */
  function nudge(ms: number) {
    settings.set("lyricsOffset", Math.max(-10000, Math.min(10000, settings.value.lyricsOffset + ms)));
  }

  const offsetLabel = $derived(
    settings.value.lyricsOffset === 0
      ? "In sync"
      : `${settings.value.lyricsOffset > 0 ? "+" : ""}${settings.value.lyricsOffset} ms`,
  );

  const sourceLabel = $derived(
    lyricsStore.lyrics?.source === "cache"
      ? "Saved on this PC"
      : lyricsStore.lyrics?.source === "local file"
        ? "Local .lrc file"
        : lyricsStore.lyrics?.source === "embedded tag"
          ? "Embedded in the track"
          : lyricsStore.lyrics?.source === "lrclib"
            ? "LRCLIB"
            : "—",
  );

  /**
   * What the source actually supplied, as the panel says it. Stated rather than smoothed over: the whole
   * point of the level model is that word level only appears when real per-word timestamps were parsed,
   * so this is the one place the user can check what they are looking at is built from.
   */
  const level = $derived(lyricsStore.lyrics?.level ?? "plain");
  /**
   * Partial coverage is normal and has to be stated. LRCLIB's word-synced records commonly carry word
   * timings for only a few of their lines — measured on King Gnu's "AIZO": 5 of 70 — and labelling the
   * whole track "word level" would oversell it. The lines that have timings light word by word and the
   * rest use the line fill, which is what the count below tells you.
   */
  const wordLines = $derived(lyricsStore.lyrics?.lines.filter((l) => l.words).length ?? 0);
  const levelLabel = $derived(
    level === "word"
      ? `word level · ${wordLines} of ${lyricsStore.lyrics?.lines.length ?? 0} lines`
      : level === "line"
        ? "line level"
        : "no timing",
  );

  async function refetch() {
    const c = player.current;
    if (!c) return;
    await lyricsStore.load(lyricsQuery(c), true);
  }

  /**
   * Delete, then say which thing actually happened.
   *
   * "Nothing was saved for this track" matters: before the fingerprint was keyed to one duration
   * source, this call reported success while removing a file that had never existed, which is how
   * BUG-050 hid for so long.
   */
  async function dropCache() {
    const c = player.current;
    if (!c) return;
    const outcome = await deleteCache(lyricsQuery(c));
    if (outcome === "deleted") lyricsStore.report("Saved lyrics removed. Find lyrics to fetch a new set.");
    else if (outcome === "notCached") lyricsStore.report("Nothing was saved for this track.");
    else lyricsStore.report("Could not delete the saved lyrics file.");
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      // Immediate, not plain stopPropagation: the global lyrics shortcut listens on the same
      // window target, so a normal stop still lets it fire and eject the whole fullscreen view.
      e.stopImmediatePropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation" onclick={onclose} onkeydown={(e) => e.key === "Escape" && onclose()}>
  <div class="sheet glass-strong" role="dialog" aria-modal="true" aria-label="Lyrics settings" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Lyrics</h2>
      <button aria-label="Close" title="Close" onclick={onclose}><Icon name="close" size={15} /></button>
    </header>

    <div class="body">
      <div class="grp">
        <div class="hd">
          <span>Timing</span>
          <span class="val" class:zero={settings.value.lyricsOffset === 0}>{offsetLabel}</span>
        </div>
        <p class="hint">If the words light up before or after they are sung, shift them here.</p>
        <div class="nudges">
          {#each [-250, -100, -25, 25, 100, 250] as step (step)}
            <button onclick={() => nudge(step)}>{step > 0 ? `+${step}` : step}</button>
          {/each}
        </div>
        <input
          class="rng"
          type="range"
          min={-3000}
          max={3000}
          step={10}
          value={settings.value.lyricsOffset}
          aria-label="Lyrics timing offset in milliseconds"
          oninput={(e) => settings.set("lyricsOffset", Number(e.currentTarget.value))}
        />
        {#if settings.value.lyricsOffset !== 0}
          <button class="reset" onclick={() => settings.set("lyricsOffset", 0)}>
            <Icon name="arrow-left" size={13} /> Reset to in sync
          </button>
        {/if}
      </div>

      <div class="grp">
        <div class="hd"><span>Highlight style</span></div>
        <p class="hint">
          {#if level === "word"}
            These lyrics carry real word timings, so each word lights as it is sung. Lines that have no
            word data of their own use the line fill instead.
          {:else if level === "line"}
            The line being sung fills left to right at its true speed. The fill only claims what the two
            line timestamps actually say — word timing exists in some local files and in a small share of
            LRCLIB records, and where neither supplied it for this track, nothing is guessed.
          {:else}
            These lyrics have no timestamps anywhere in the source, so they are shown as a plain column
            rather than scrolled on a schedule that exists in nothing but the app.
          {/if}
        </p>
      </div>

      <div class="grp">
        <div class="hd"><span>Size</span><span class="val">{settings.value.lyricsScale}%</span></div>
        <input class="rng" type="range" min={70} max={150} step={2} value={settings.value.lyricsScale}
          aria-label="Lyrics text size"
          oninput={(e) => settings.set("lyricsScale", Number(e.currentTarget.value))} />
      </div>

      <div class="grp">
        <div class="hd"><span>Softness of other lines</span><span class="val">{settings.value.lyricsBlur.toFixed(1)}px</span></div>
        <p class="hint">How out-of-focus the lines you are not singing should be.</p>
        <input class="rng" type="range" min={0} max={10} step={0.5} value={settings.value.lyricsBlur}
          aria-label="Blur on non-singing lines"
          oninput={(e) => settings.set("lyricsBlur", Number(e.currentTarget.value))} />
      </div>

      <div class="grp">
        <div class="hd"><span>Fade of other lines</span><span class="val">{settings.value.lyricsDim}%</span></div>
        <input class="rng" type="range" min={0} max={80} step={2} value={settings.value.lyricsDim}
          aria-label="Dimming of non-singing lines"
          oninput={(e) => settings.set("lyricsDim", Number(e.currentTarget.value))} />
      </div>

      <div class="grp">
        <label class="tog">
          <input type="checkbox" checked={settings.value.romanise}
            onchange={(e) => settings.set("romanise", e.currentTarget.checked)} />
          <span></span><b>Romanise where possible</b>
        </label>
        <p class="hint">Replaces the line with a Latin-alphabet reading — Hindi, Bengali, Punjabi and
          Gujarati. Word-by-word highlighting is dropped on those lines, since the timed words belong to
          the original script. Japanese, Korean, Chinese, Tamil, Telugu, Kannada and Malayalam are left
          as written rather than guessed at.</p>
      </div>

      <div class="grp">
        <div class="hd"><span>Source</span><span class="val">{sourceLabel}</span></div>
        <p class="hint">
          {lyricsStore.lyrics?.lines.length ?? 0} {level === "plain" ? "lines" : "timed lines"} ·
          {levelLabel}
        </p>
        <div class="acts">
          <button class="btn btn-sm" onclick={() => void refetch()}>
            <Icon name="search" size={13} /> Search again
          </button>
          <button class="btn btn-sm btn-danger" onclick={() => void dropCache()}>
            <Icon name="trash" size={13} /> Delete saved lyrics
          </button>
        </div>
        <p class="hint">Deleting removes only what Noctra saved. Lyrics written into the audio file
          itself are never touched.</p>
      </div>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 24px clamp(16px, 3vw, 40px);
    background: rgba(5, 5, 9, 0.35);
    animation: fade 160ms var(--ease-out);
  }

  @keyframes fade {
    from { opacity: 0; }
  }

  .sheet {
    width: min(392px, 100%);
    max-height: min(86vh, 760px);
    display: flex;
    flex-direction: column;
    border-radius: 20px;
    animation: in 240ms var(--ease-out);
  }

  @keyframes in {
    from { opacity: 0; transform: translateX(18px) scale(0.985); }
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 14px;
    flex: none;
    border-bottom: 1px solid var(--hairline);
  }

  h2 {
    font-size: var(--fs-lg);
    font-weight: 800;
    letter-spacing: -0.3px;
  }

  header button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    color: var(--text-dim);
    transition: color var(--tap) var(--ease-out), background-color var(--tap) var(--ease-out);
  }

  header button:hover { color: #fff; background: var(--surface-2); }

  .body {
    overflow-y: auto;
    padding: 6px 20px 20px;
    display: flex;
    flex-direction: column;
  }

  .grp {
    padding: 16px 0;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .grp:last-child { border-bottom: none; }

  .hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--fs-base);
    font-weight: 800;
  }

  .val {
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--accent-text);
    font-variant-numeric: tabular-nums;
  }

  .val.zero { color: var(--text-faint); }

  .hint {
    font-size: var(--fs-xs);
    font-weight: 500;
    line-height: 1.5;
    color: var(--text-faint);
  }

  .nudges {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 5px;
  }

  .nudges button {
    font-size: var(--fs-2xs);
    font-weight: 700;
    padding: 7px 0;
    border-radius: 8px;
    background: var(--surface-1);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    transition: color var(--tap) var(--ease-out), background-color var(--tap) var(--ease-out),
      transform var(--tap) var(--ease-spring);
  }

  .nudges button:hover {
    color: #fff;
    background: var(--surface-2);
    transform: translateY(-1px);
  }

  .rng {
    width: 100%;
    accent-color: rgb(var(--accent-rgb));
    height: 22px;
  }

  .reset {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-dim);
    padding: 5px 10px;
    border-radius: 999px;
    transition: color var(--tap) var(--ease-out), background-color var(--tap) var(--ease-out);
  }

  .reset:hover { color: #fff; background: var(--surface-1); }

  .tog {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: var(--fs-sm);
  }

  .tog b { font-weight: 700; }

  .tog input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .tog span {
    width: 38px;
    height: 22px;
    border-radius: 999px;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--hairline);
    position: relative;
    flex: none;
    transition: background-color 200ms var(--ease-out);
  }

  .tog span::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 220ms var(--ease-spring);
  }

  .tog input:checked + span { background: rgb(var(--accent-rgb)); }
  .tog input:checked + span::after { transform: translateX(16px); }
  .tog input:focus-visible + span { outline: 2px solid rgb(var(--accent-rgb) / 0.8); outline-offset: 2px; }

  .acts { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
