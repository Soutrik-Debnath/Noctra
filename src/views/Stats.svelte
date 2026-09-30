<script lang="ts">
  /**
   * Statistics.
   *
   * Two groups, matching how the reference splits it: what the library *is*, and what you have
   * actually *done* to it. The second group is only meaningful once history has been recorded, so
   * it says so rather than showing a page of zeros.
   */
  import Icon from "../components/Icon.svelte";
  import { player } from "../stores/player.svelte";
  import { library } from "../stores/library.svelte";
  import { history } from "../stores/history.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { ui } from "../stores/ui.svelte";
  import { formatTime } from "../utils/format";

  const tracks = $derived(player.tracks);

  const albums = $derived(new Set(tracks.map((t) => t.album).filter(Boolean)).size);
  /**
   * Distinct lead artists, not distinct `artist` strings. Tag fields here are feature lists, so a
   * raw count reports 264 "artists" across 314 songs, which is nonsense.
   */
  const artists = $derived(
    new Set(tracks.map((t) => t.artist.split(/,\s*|&|\s+feat\.?\s+|\s+vs\.?\s+/iu)[0].trim())).size,
  );
  const totalSeconds = $derived(tracks.reduce((s, t) => s + t.duration, 0));
  const avgSeconds = $derived(tracks.length ? totalSeconds / tracks.length : 0);

  const lossless = $derived(
    library.tracks.filter((t) => ["flac", "wav", "ape"].includes(t.codec.toLowerCase()) ||
      /\.(flac|wav|ape)$/i.test(t.path)).length,
  );
  const lossy = $derived(library.tracks.length - lossless);

  /** Play counts rolled up by lead artist and album. */
  const topArtists = $derived.by(() => {
    const m = new Map<string, number>();
    for (const t of tracks) {
      const a = t.artist.split(/,\s*|&|\s+feat\.?\s+|\s+vs\.?\s+/iu)[0].trim() || "Unknown artist";
      m.set(a, (m.get(a) ?? 0) + history.count(t.id));
    }
    return [...m].filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 5);
  });

  const topAlbums = $derived.by(() => {
    const m = new Map<string, { album: string; artist: string; plays: number }>();
    for (const t of tracks) {
      const key = `${t.album}||${t.artist}`;
      const plays = history.count(t.id);
      if (!plays) continue;
      const hit = m.get(key);
      if (hit) hit.plays += plays;
      else m.set(key, { album: t.album || "Singles", artist: t.artist, plays });
    }
    return [...m.values()].sort((a, b) => b.plays - a.plays).slice(0, 5);
  });

  const hasHistory = $derived(history.secondsListened > 0 || topArtists.length > 0);

  /** Hours with a remainder, because "21h 6m" reads better than "21.1 hours". */
  function hm(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function copySummary() {
    const lines = [
      `Noctra library: ${tracks.length} songs, ${albums} albums, ${artists} artists, ${hm(totalSeconds)} of music`,
      hasHistory
        ? `Listened: ${hm(history.secondsListened)} across ${Object.values(history.plays).reduce((a, b) => a + b, 0)} plays`
        : "No listening history recorded yet",
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      /* Clipboard can be refused; the numbers are on screen anyway. */
    }
  }
</script>

<div class="page">
  <header class="head">
    <div>
      <h1>Statistics</h1>
      <p>Your library and your listening, at a glance.</p>
    </div>
    <div class="head-actions">
      <button class="btn btn-sm" onclick={() => void copySummary()}>
        <Icon name="plus" size={13} />
        Copy summary
      </button>
      <button class="orb orb-sm" title="Close" aria-label="Close" onclick={() => ui.set("home")}>
        <Icon name="close" size={16} />
      </button>
    </div>
  </header>

  <section class="card block">
    <h2 class="micro">Your music library</h2>
    <div class="figures">
      <div class="fig"><span class="num">{tracks.length}</span><span class="cap">Songs</span></div>
      <div class="fig"><span class="num">{albums}</span><span class="cap">Albums</span></div>
      <div class="fig"><span class="num">{artists}</span><span class="cap">Artists</span></div>
      <div class="fig"><span class="num">{hm(totalSeconds)}</span><span class="cap">Total duration</span></div>
    </div>
    <div class="chips">
      <span class="chip">{lossless} lossless</span>
      <span class="chip">{lossy} lossy</span>
      <span class="chip">{library.roots.length} folder{library.roots.length === 1 ? "" : "s"}</span>
    </div>
  </section>

  <section class="card block">
    <h2 class="micro">Listening</h2>
    {#if hasHistory}
      <div class="figures">
        <div class="fig">
          <span class="num accent">{Object.values(history.plays).reduce((a, b) => a + b, 0)}</span>
          <span class="cap">Total plays</span>
        </div>
        <div class="fig"><span class="num accent">{hm(history.secondsListened)}</span><span class="cap">Time listened</span></div>
        <div class="fig"><span class="num accent">{formatTime(avgSeconds)}</span><span class="cap">Avg track length</span></div>
        <div class="fig"><span class="num accent">{favorites.count()}</span><span class="cap">Liked songs</span></div>
      </div>

      <div class="tops">
        <div class="top">
          <h3>Top artists</h3>
          <ol>
            {#each topArtists as [name, plays], i (name)}
              <li><span class="rank">{i + 1}</span><span class="t-name">{name}</span><span class="chip">{plays}</span></li>
            {/each}
          </ol>
        </div>
        <div class="top">
          <h3>Top albums</h3>
          <ol>
            {#each topAlbums as a, i (`${a.album}||${a.artist}`)}
              <li>
                <span class="rank">{i + 1}</span>
                <span class="t-stack">
                  <span class="t-name">{a.album}</span>
                  <span class="t-sub">{a.artist}</span>
                </span>
                <span class="chip">{a.plays}</span>
              </li>
            {/each}
          </ol>
        </div>
      </div>
    {:else}
      <p class="hint">
        Nothing recorded yet. Play a few tracks and this fills in — Noctra counts plays and listening
        time from the first run, so there is nothing to switch on.
      </p>
      <button class="btn btn-primary" onclick={() => ui.set("library")}>Go to library</button>
    {/if}
  </section>
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 28px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  .head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
  }

  .head h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.5px;
  }

  .head p {
    margin-top: 5px;
    font-size: var(--fs-base);
    font-weight: 500;
    color: var(--text-dim);
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: none;
  }

  .block {
    padding: 20px 22px 22px;
    max-width: 900px;
  }

  .micro {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .figures {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 18px;
    margin-top: 16px;
  }

  .fig {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .num {
    /* Display role: these are the largest numbers in the app and several change as the track changes.
       Bricolage's tabular figures were verified (1111 and 8888 measure identically with
       `font-variant-numeric: tabular-nums`), so promoting them does not make the columns wobble. */
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -1px;
    font-variant-numeric: tabular-nums;
  }

  .num.accent {
    color: var(--accent-text);
    transition: color 500ms var(--ease-out);
  }

  .cap {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim);
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 16px;
  }

  .tops {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 26px;
    margin-top: 24px;
  }

  .top h3 {
    font-size: var(--fs-base);
    font-weight: 700;
    color: var(--text-dim);
    padding-bottom: 8px;
    border-bottom: 1px solid var(--hairline);
  }

  .top ol {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .top li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .t-name {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-base);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .t-stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .t-sub {
    font-size: var(--fs-xs);
    font-weight: 500;
    color: var(--text-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    margin-top: 12px;
    font-size: var(--fs-base);
    line-height: 1.55;
    color: var(--text-dim);
    max-width: 52ch;
  }

  .block .btn-primary {
    margin-top: 16px;
  }
</style>
