<script lang="ts">
  /**
   * Ctrl+K palette: one box to jump to a song, album, artist or action.
   *
   * Matching is a subsequence score rather than a substring test, so "mmmbo" finds "Mr. Mister".
   * The result list is capped because typing fast against a 300-track library otherwise re-renders a
   * long DOM on every keystroke for rows nobody can see.
   */
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { groupAlbums, groupArtists } from "../services/collections";
  import { openSleepMenu } from "../services/sleepMenu";
  import { formatTime } from "../utils/format";
  import { leadArtist } from "../data/track";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let q = $state("");
  let cursor = $state(0);
  let input = $state<HTMLInputElement | null>(null);
  let listEl = $state<HTMLDivElement | null>(null);

  type Row = {
    kind: "Song" | "Album" | "Artist" | "Action";
    label: string;
    sub: string;
    icon: IconName;
    haystack: string;
    run: () => void;
  };

  const actions = $derived<Row[]>([
    { kind: "Action", label: "Go to home", sub: "", icon: "home", haystack: "home", run: () => ui.set("home") },
    { kind: "Action", label: "Go to library", sub: "", icon: "library", haystack: "library songs all tracks", run: () => ui.set("library") },
    { kind: "Action", label: "Go to playlists", sub: "", icon: "playlists", haystack: "playlists", run: () => ui.set("playlists") },
    { kind: "Action", label: "Go to favourites", sub: "", icon: "heart", haystack: "favorites favourites liked", run: () => ui.set("favorites") },
    { kind: "Action", label: "Go to statistics", sub: "", icon: "stats", haystack: "stats statistics listening", run: () => ui.set("stats") },
    { kind: "Action", label: "Open settings", sub: "", icon: "settings", haystack: "settings preferences options", run: () => ui.set("settings") },
    { kind: "Action", label: "Open Now Playing", sub: "", icon: "expand", haystack: "now playing fullscreen lyrics", run: () => ui.openFullscreen() },
    { kind: "Action", label: "Open lyrics", sub: "", icon: "lyrics", haystack: "lyrics words", run: () => ui.set("lyrics") },
    {
      kind: "Action",
      label: "Toggle queue",
      sub: "",
      icon: "queue",
      haystack: "queue play next",
      run: () => ui.toggleQueue(),
    },
    {
      kind: "Action",
      label: "Shuffle everything",
      sub: "Pick a random track and keep shuffling",
      icon: "shuffle",
      haystack: "shuffle random surprise",
      run: () => player.shuffleAll(),
    },
    {
      kind: "Action",
      label: "Play similar",
      sub: "Build a run from tracks like the current one",
      icon: "sparkle",
      haystack: "similar radio like this ai mix",
      run: () => void player.playSimilar(),
    },
    {
      kind: "Action",
      label: "Sleep timer",
      sub: "Stop playback later or after this song",
      icon: "clock",
      haystack: "sleep timer stop countdown",
      run: () => openSleepMenu({ clientX: innerWidth / 2, clientY: 120 } as MouseEvent),
    },
    {
      kind: "Action",
      label: ui.miniOpen ? "Close desktop mini player" : "Open desktop mini player",
      sub: "",
      icon: "pip",
      haystack: "mini desktop card floating",
      run: () => void toggleMiniFromPalette(),
    },
  ]);

  async function toggleMiniFromPalette() {
    const { toggleMiniWindow } = await import("../services/windowBridge");
    await toggleMiniWindow();
  }

  const songs = $derived<Row[]>(
    player.tracks.map((t) => ({
      kind: "Song" as const,
      label: t.title,
      sub: `${leadArtist(t.artist)} · ${formatTime(t.duration)}`,
      icon: "play" as IconName,
      haystack: `${t.title} ${t.artist} ${t.album}`,
      run: () => player.playFrom(t.id),
    })),
  );

  const albums = $derived<Row[]>(
    groupAlbums(player.tracks).map((a) => ({
      kind: "Album" as const,
      label: a.title,
      sub: `${a.artist} · ${a.tracks.length} songs`,
      icon: "disc" as IconName,
      haystack: `${a.title} ${a.artist}`,
      run: () => ui.openAlbum(a.key),
    })),
  );

  const artists = $derived<Row[]>(
    groupArtists(player.tracks).map((a) => ({
      kind: "Artist" as const,
      label: a.name,
      sub: `${a.tracks.length} songs`,
      icon: "mic" as IconName,
      haystack: a.name,
      run: () => ui.openArtist(a.name),
    })),
  );

  /** Subsequence score: earlier and consecutive hits win; ties break on a shorter label. */
  function score(needle: string, hay: string): number {
    if (!needle) return 0;
    const h = hay.toLowerCase();
    const n = needle.toLowerCase();
    if (h.startsWith(n)) return 1000 - h.length;
    const direct = h.indexOf(n);
    if (direct >= 0) return 700 - direct - Math.min(200, h.length / 4);
    // Fall back to a subsequence match so scattered letters still find the right thing.
    let at = 0;
    let gaps = 0;
    for (const ch of n) {
      const found = h.indexOf(ch, at);
      if (found === -1) return -1;
      gaps += found - at;
      at = found + 1;
    }
    return 300 - Math.min(290, gaps);
  }

  const rows = $derived.by(() => {
    const trimmed = q.trim();
    const pools: Row[][] = trimmed ? [actions, songs, albums, artists] : [actions];
    const out: { row: Row; s: number }[] = [];
    for (const pool of pools) {
      for (const row of pool) {
        const s = trimmed ? score(trimmed, row.haystack) : 0;
        if (trimmed && s < 0) continue;
        out.push({ row, s });
      }
    }
    if (!trimmed) return out.slice(0, 8).map((x) => x.row);
    return out
      .sort((a, b) => b.s - a.s || a.row.label.length - b.row.label.length)
      .slice(0, 24)
      .map((x) => x.row);
  });

  $effect(() => {
    if (open) {
      q = "";
      cursor = 0;
      void Promise.resolve().then(() => input?.focus());
    }
  });

  $effect(() => {
    void cursor;
    const el = listEl?.querySelector<HTMLElement>(`[data-i="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  });

  function choose(row: Row) {
    row.run();
    onclose();
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      cursor = Math.min(rows.length - 1, cursor + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(0, cursor - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) choose(row);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div
    class="scrim"
    role="presentation"
    onclick={() => onclose()}
    onkeydown={(e) => e.key === "Escape" && onclose()}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="sheet glass-strong" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <div class="field">
        <Icon name="search" size={17} />
        <input
          bind:this={input}
          bind:value={q}
          placeholder="Search songs, albums, artists, or jump to…"
          aria-label="Search"
          spellcheck="false"
          onkeydown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
              e.preventDefault();
              onKey(e);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>

      <div class="results" bind:this={listEl} role="listbox">
        {#if rows.length === 0}
          <p class="none">Nothing matches “{q}”.</p>
        {:else}
          {#each rows as row, i (row.kind + row.label)}
            <button
              class="res"
              class:at={i === cursor}
              data-i={i}
              role="option"
              aria-selected={i === cursor}
              onclick={() => choose(row)}
              onmouseenter={() => (cursor = i)}
            >
              <span class="ri"><Icon name={row.icon} size={14} /></span>
              <span class="rl">{row.label}</span>
              {#if row.sub}<span class="rs">{row.sub}</span>{/if}
              <span class="rk">{row.kind}</span>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 12vh 24px 24px;
    background: rgba(5, 5, 9, 0.55);
    animation: fade 160ms var(--ease-out);
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }

  .sheet {
    width: min(620px, 100%);
    border-radius: 18px;
    overflow: hidden;
    animation: drop 200ms var(--ease-out);
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.985);
    }
  }

  .field {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--hairline);
    color: var(--text-dim);
  }

  input {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text);
    background: none;
  }

  input::placeholder {
    color: var(--text-faint);
  }

  kbd {
    font: inherit;
    font-size: var(--fs-2xs);
    font-weight: 700;
    color: var(--text-faint);
    border: 1px solid var(--hairline);
    border-radius: 5px;
    padding: 2px 6px;
    flex: none;
  }

  .results {
    max-height: min(52vh, 420px);
    overflow-y: auto;
    padding: 8px;
  }

  .res {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 10px 11px;
    border-radius: 10px;
    text-align: left;
    transition: background-color 120ms var(--ease-out);
  }

  .res.at {
    background: rgb(var(--accent-rgb) / 0.16);
  }

  .ri {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--surface-1);
    color: var(--text-dim);
    flex: none;
  }

  .res.at .ri {
    color: var(--accent-text);
  }

  .rl {
    font-size: var(--fs-md);
    font-weight: 700;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: none;
    max-width: 46%;
  }

  .rs {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim);
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rk {
    font-size: var(--fs-2xs);
    font-weight: 800;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--text-faint);
    flex: none;
  }

  .none {
    padding: 26px 12px;
    text-align: center;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-faint);
  }
</style>
