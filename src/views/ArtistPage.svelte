<script lang="ts">
  /** One artist: their albums plus every track credited to them. */
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { artistBy } from "../services/collections";
  import { formatTime } from "../utils/format";
  import TrackList from "../components/TrackList.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";

  let { name }: { name: string } = $props();

  const artist = $derived(artistBy(player.tracks, name));
  const top = $derived(artist?.albums.slice(0, 8) ?? []);
  let showAll = $state(false);

  function playAll() {
    if (!artist) return;
    const first = artist.tracks.find((t) => t.albumArtist.trim() === artist.name) ?? artist.tracks[0];
    player.playFrom(first.id);
  }
</script>

{#if !artist}
  <EmptyState title="Artist not found" body="They may have been retagged in a rescan." />
{:else}
  <div class="page">
    <button class="back" onclick={() => ui.back()}>
      <Icon name="arrow-left" size={15} />
      Back
    </button>

    <header>
      {#if artist.artwork}
        <img class="hero" src={artist.artwork} alt="" draggable="false" />
      {:else}
        <div class="hero none"><Icon name="mic" size={44} /></div>
      {/if}
      <div class="head">
        <span class="kind">Artist</span>
        <h1>{artist.name}</h1>
        <p class="meta">
          {artist.albums.length} {artist.albums.length === 1 ? "album" : "albums"} ·
          {artist.tracks.length} songs · {formatTime(artist.tracks.reduce((s, t) => s + t.duration, 0))}
        </p>
        <div class="acts">
          <button class="btn btn-primary" onclick={playAll}>
            <Icon name="play" size={14} />
            Play
          </button>
          <button
            class="btn"
            onclick={() => {
              player.shuffle = true;
              player.playFrom(artist.tracks[Math.floor(Math.random() * artist.tracks.length)].id);
            }}
          >
            <Icon name="shuffle" size={14} />
            Shuffle
          </button>
        </div>
      </div>
    </header>

    {#if top.length > 0}
      <h2 class="sec">Albums</h2>
      <div class="grid stagger">
        {#each top as a (a.key)}
          <button class="card" onclick={() => ui.openAlbum(a.key)}>
            {#if a.artwork}
              <img src={a.artwork} alt="" draggable="false" loading="lazy" />
            {:else}
              <span class="ph"><Icon name="disc" size={26} /></span>
            {/if}
            <span class="ct">
              <span class="t">{a.title}</span>
              <span class="s">{a.year || `${a.tracks.length} songs`}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <h2 class="sec">Songs</h2>
    <TrackList tracks={showAll ? artist.tracks : artist.tracks.slice(0, 12)} />
    {#if artist.tracks.length > 12}
      <button class="more" onclick={() => (showAll = !showAll)}>
        {showAll ? "Show less" : `Show all ${artist.tracks.length}`}
      </button>
    {/if}
  </div>
{/if}

<style>
  .page {
    padding: 26px clamp(22px, 3.4vw, 46px) 120px;
    animation: rise 340ms var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-dim);
    padding: 7px 13px 7px 10px;
    border-radius: 999px;
    margin-bottom: 18px;
    transition:
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .back:hover {
    color: var(--text);
    background: var(--surface-1);
  }

  header {
    display: flex;
    align-items: flex-end;
    gap: clamp(18px, 2.6vw, 34px);
    margin-bottom: 14px;
  }

  .hero {
    width: clamp(140px, 15vw, 208px);
    aspect-ratio: 1;
    border-radius: 50%;
    object-fit: cover;
    flex: none;
    box-shadow:
      0 26px 60px -22px rgba(0, 0, 0, 0.85),
      inset 0 0 0 1px rgba(255, 255, 255, 0.09);
  }

  .hero.none {
    display: grid;
    place-items: center;
    background: var(--surface-1);
    color: var(--text-faint);
  }

  .head {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .kind {
    font-size: var(--fs-xs);
    font-weight: 800;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  h1 {
    font-size: clamp(28px, 4.2vw, 52px);
    font-weight: 800;
    letter-spacing: -1.6px;
    line-height: 1.04;
  }

  .meta {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-dim);
  }

  .acts {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }

  .sec {
    font-size: var(--fs-xl);
    font-weight: 800;
    letter-spacing: -0.5px;
    margin: 30px 0 14px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 16px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 13px;
    border-radius: 13px;
    text-align: left;
    background: var(--surface-1);
    /* `box-shadow` has to be listed too: the hover below sets it along with the lift, and a
       transition list naming only two of the three leaves the shadow snapping on. */
    transition:
      background-color var(--tap) var(--ease-out),
      transform var(--tap) var(--ease-spring),
      box-shadow var(--tap) var(--ease-out);
  }

  .card:active {
    transform: scale(0.975);
  }

  .card:hover {
    background: var(--surface-2);
    transform: translateY(-3px);
    box-shadow: var(--elev-3);
  }

  .card img,
  .ph {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 8px;
    object-fit: cover;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--text-faint);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }

  .ct {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .t {
    font-size: var(--fs-base);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .s {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
  }

  .more {
    margin: 16px 0 0 12px;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--text-dim);
    padding: 8px 14px;
    border-radius: 999px;
    transition:
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .more:hover {
    color: var(--text);
    background: var(--surface-1);
  }
</style>
