<script lang="ts">
  /**
   * Library: pick a music folder, watch it fill in, then search and play.
   *
   * The list is windowed by hand rather than via a component library. With 300+ rows, mounting
   * every row makes scrolling and scanning expensive on the target hardware, and the spec sets a
   * virtualisation threshold at ~200 rows. A slice over a fixed-height spacer is about twenty lines
   * and has no dependency to maintain.
   */
  import { library } from "../stores/library.svelte";
  import { player } from "../stores/player.svelte";
  import { formatTime } from "../utils/format";
  import { menu } from "../stores/menu.svelte";
  import { trackMenu } from "../services/trackMenu";
  import { groupAlbums, groupArtists } from "../services/collections";
  import Icon from "../components/Icon.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import MediaCard from "../components/MediaCard.svelte";
  import { ui } from "../stores/ui.svelte";

  const ROW = 56;
  const OVERSCAN = 6;

  type Facet = "songs" | "albums" | "artists";
  let facet = $state<Facet>("songs");

  const FACETS: { id: Facet; label: string; icon: "playlists" | "disc" | "mic" }[] = [
    { id: "songs", label: "Songs", icon: "playlists" },
    { id: "albums", label: "Albums", icon: "disc" },
    { id: "artists", label: "Artists", icon: "mic" },
  ];

  let viewport = $state<HTMLDivElement | null>(null);
  let scrollTop = $state(0);
  let viewHeight = $state(600);

  const rows = $derived.by(() => {
    const list = library.filtered;
    const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
    const end = Math.min(list.length, start + Math.ceil(viewHeight / ROW) + OVERSCAN * 2);
    return { start, slice: list.slice(start, end), total: list.length };
  });

  /*
     Grouped from the *filtered* tracks, so the one search box narrows whichever facet you are on
     rather than only the song list. Searching "gorillaz" on Albums leaves the Gorillaz records instead
     of silently showing all 267. Grouping needs the full `Track` (artwork is resolved onto it), which
     is why this reads `player.tracks` through the store's own predicate rather than `filtered`.
  */
  const facetTracks = $derived(player.tracks.filter((t) => library.matches(t)));
  const albums = $derived(groupAlbums(facetTracks).filter((a) => a.artwork));
  const artists = $derived(groupArtists(facetTracks).filter((a) => a.artwork));

  const counts = $derived({ songs: rows.total, albums: albums.length, artists: artists.length });

  function pickFacet(next: Facet) {
    facet = next;
    // The song list is windowed off `scrollTop`; leaving a stale offset behind would reopen the tab
    // mid-list rather than at the top.
    scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
  }

  async function rescan() {
    const picked = await library.pickAndScan();
    if (picked) {
      player.index = 0;
      player.position = 0;
    }
  }

  async function replaceLibrary() {
    const picked = await library.pickAndScan(true);
    if (picked) {
      player.index = 0;
      player.position = 0;
    }
  }

  /** Keeps `viewHeight` in step with the real scroll area. */
  function measure(node: HTMLDivElement) {
    const sync = () => (viewHeight = node.clientHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

<div class="page">
  <header class="top glass-panel">
    <div>
      <h1>Library</h1>
      <p class="sub">
        {#if library.scanning}
          Scanning… {library.discovered} tracks found
        {:else if library.tracks.length}
          {counts[facet]} {counts[facet] === 1 ? FACETS.find((f) => f.id === facet)?.label.slice(0, -1) : FACETS.find((f) => f.id === facet)?.label.toLowerCase()}
          {#if library.query}matching “{library.query}”{/if}
        {:else}
          No music loaded yet
        {/if}
      </p>
    </div>

    <div class="actions">
      {#if library.tracks.length && !library.scanning}
        <div class="search glass-pill">
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="What do you want to play?"
            bind:value={library.query}
            aria-label="Search library"
          />
        </div>
      {/if}
      <button class="btn btn-primary" onclick={() => void rescan()} disabled={library.scanning}>
        <Icon name="plus" size={15} />
        {library.tracks.length ? "Add folder" : "Choose music folder"}
      </button>
      {#if library.tracks.length}
        <button
          class="btn"
          title="Clear everything and scan one folder from scratch"
          disabled={library.scanning}
          onclick={() => void replaceLibrary()}
        >
          Replace
        </button>
      {/if}
    </div>
  </header>

  {#if library.tracks.length && !library.scanning}
    <div class="facets" role="tablist" aria-label="Library view">
      {#each FACETS as f (f.id)}
        <button
          class="facet"
          class:on={facet === f.id}
          role="tab"
          aria-selected={facet === f.id}
          onclick={() => pickFacet(f.id)}
        >
          <Icon name={f.icon} size={14} weight={facet === f.id ? "fill" : "line"} />
          <span>{f.label}</span>
          <span class="n">{counts[f.id]}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if library.error}
    <p class="error" role="alert">{library.error}</p>
  {/if}

  {#if library.scanning}
    <div class="progress"><div class="bar"></div></div>
  {/if}

  {#if !library.tracks.length && !library.scanning}
    <EmptyState
      title="Point Noctra at your music"
      body="Pick a folder and it will be read in the background — tags and cover art come out of the files themselves, in batches, so nothing freezes."
      phase="Ready now"
      icon="library"
    />
  {:else if facet === "songs"}
    <div
      class="viewport"
      bind:this={viewport}
      onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
      use:measure
      aria-label="Tracks"
    >
      <div class="spacer" style="height: {rows.total * ROW}px">
        <div class="window" style="transform: translateY({rows.start * ROW}px)">
          {#each rows.slice as track (track.id)}
            <button
              class="row"
              class:active={player.current?.id === track.id}
              style="height: {ROW}px"
              onclick={() => void player.playFrom(track.id, library.filtered)}
              oncontextmenu={(e) => {
                e.preventDefault();
                const full = player.tracks.find((t) => t.id === track.id);
                if (full) menu.show(e, trackMenu(full));
              }}
            >
              {#if track.artworkPath}
                <img class="thumb" src={player.tracks.find((t) => t.id === track.id)?.artwork ?? ""} alt="" loading="lazy" />
              {:else}
                <span class="thumb none"><Icon name="playlists" size={15} /></span>
              {/if}
              <span class="text">
                <span class="title">{track.title}</span>
                <span class="sub">{track.artist}{#if track.album} · {track.album}{/if}</span>
              </span>
              <span class="state">
                {#if player.current?.id === track.id && player.isPlaying}
                  <Icon name="pause" size={13} />
                {:else}
                  <Icon name="play" size={13} />
                {/if}
              </span>
              <span class="dur">{formatTime(track.duration)}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {:else if facet === "albums"}
    {#if albums.length === 0}
      <p class="nomatch">No albums match “{library.query}”.</p>
    {:else}
      <div class="grid">
        {#each albums as a (a.key)}
          <MediaCard
            art={a.artwork}
            title={a.title}
            subtitle={a.artist}
            onclick={() => ui.openAlbum(a.key)}
          />
        {/each}
      </div>
    {/if}
  {:else}
    {#if artists.length === 0}
      <p class="nomatch">No artists match “{library.query}”.</p>
    {:else}
      <div class="grid round">
        {#each artists as a (a.name)}
          <MediaCard
            round
            showPlay={false}
            art={a.artwork}
            title={a.name}
            subtitle={`${a.tracks.length} ${a.tracks.length === 1 ? "track" : "tracks"}`}
            onclick={() => ui.openArtist(a.name)}
          />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<svelte:window on:resize={() => (viewHeight = viewport?.clientHeight ?? viewHeight)} />

<style>
  .page {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 28px var(--gutter) 0;
    gap: 16px;
  }

  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    flex-wrap: wrap;
    padding: 18px 22px;
    flex: none;
  }

  h1 {
    font-size: 25px;
    font-weight: 700;
  }

  .sub {
    margin-top: 4px;
    font-size: var(--fs-base);
    color: var(--text-dim);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .search {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 14px;
    height: 38px;
    width: 280px;
    color: var(--text-dim);
    transition:
      border-color 180ms var(--ease-out),
      background-color 180ms var(--ease-out);
  }

  .search:focus-within {
    border-color: rgb(var(--accent-rgb) / 0.6);
    background-color: rgba(255, 255, 255, 0.09);
  }

  .search input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-size: var(--fs-base);
  }
  .error {
    font-size: var(--fs-sm);
    color: #f0a5aa;
  }

  .progress {
    height: 2px;
    border-radius: 2px;
    background: var(--surface-2);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    width: 40%;
    border-radius: 2px;
    background: var(--accent);
    animation: slide 1.2s ease-in-out infinite alternate;
  }

  @keyframes slide {
    from {
      transform: translateX(-10%);
    }
    to {
      transform: translateX(160%);
    }
  }

  .viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: 20px;
  }

  /*
     The facet switch.

     Active is carried by lightness, not hue: the selected pill lifts its label to full ink and sits on
     a lighter plate. An accent-coloured active tab would be unreadable on the covers where the accent
     lands dark, and this app's accent changes with every track.
  */
  .facets {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    flex: none;
    padding: 4px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.045);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.07);
  }

  .facet {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 999px;
    color: var(--text-faint);
    font-size: var(--fs-md);
    font-weight: 600;
    transition:
      color 180ms var(--ease-out),
      background-color 180ms var(--ease-out),
      box-shadow 180ms var(--ease-out);
  }

  .facet:hover {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.05);
  }

  .facet.on {
    color: var(--text);
    background-color: rgba(255, 255, 255, 0.1);
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.12),
      0 6px 16px -10px rgba(0, 0, 0, 0.8);
  }

  .facet .n {
    font-size: var(--fs-xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
  }

  .facet.on .n {
    color: var(--text-dim);
  }

  /*
     Albums and Artists scroll inside their own pane rather than growing the page, so the header and
     the switch stay put — the same frame the song list uses. The tiles themselves skip off-screen
     work; see MediaCard.
  */
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    align-content: start;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 18px;
    /* A scroll container clips its contents at the padding edge, and the first row's art sat 2px below
       the top of this one — so every halo on the top row was severed along its upper side, and the outer
       columns were cut left and right. The padding is headroom for the light, not decoration: the glow
       reaches about 50px, and what remains outside it is the faintest part of the wash. */
    padding: 30px 26px 24px;
  }

  .grid.round {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
    justify-items: center;
  }

  .nomatch {
    padding: 40px 4px;
    color: var(--text-dim);
    font-size: var(--fs-md);
  }

  .spacer {
    position: relative;
    width: 100%;
  }

  /* The offset is a transform, so scrolling never invalidates layout for the visible rows. */
  .window {
    position: absolute;
    inset: 0 0 auto 0;
    display: flex;
    flex-direction: column;
  }

  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 0 12px;
    border-radius: 11px;
    border: 1px solid transparent;
    text-align: left;
    /* This list *replaces* the `.row` primitive's in controls.css rather than adding to it — Svelte
       scopes this to `.row.svelte-khfokh`, which out-specifies the global `.row`. `transform` has to
       be repeated here or the global `.row:active { scale(0.995) }` still applies to all 24 rows
       with nothing to ease it, and the press snaps. */
    transition:
      background-color 140ms var(--ease-out),
      border-color 140ms var(--ease-out),
      transform 140ms var(--ease-out);
  }

  .row:hover {
    background-color: rgba(255, 255, 255, 0.055);
    border-color: rgba(255, 255, 255, 0.09);
  }

  .row.active {
    background-color: rgba(255, 255, 255, 0.085);
    background-image: linear-gradient(90deg, rgb(var(--accent-rgb) / 0.14), transparent 45%);
    border-color: rgba(255, 255, 255, 0.14);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .thumb {
    width: 38px;
    height: 38px;
    border-radius: 8px;
    object-fit: cover;
    flex: none;
    background: var(--surface-2);
    box-shadow:
      0 4px 14px -6px rgba(0, 0, 0, 0.75),
      inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  }

  .thumb.none {
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
    flex: 1;
  }

  .title {
    font-size: var(--fs-base);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .active .title {
    /* See controls.css .row.active: raw accent on sleeve-coloured glass measures 2.33:1. */
    color: var(--accent-text);
  }

  .text .sub {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .state {
    display: grid;
    place-items: center;
    color: var(--text-dim);
    flex: none;
  }

  .dur {
    font-size: var(--fs-xs);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    min-width: 34px;
    text-align: right;
  }
</style>
