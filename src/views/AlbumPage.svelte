<script lang="ts">
  /** One album's tracklist. Reached from Home, Library rows, the artist page and the palette. */
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { albumBy, albumKind } from "../services/collections";
  import { formatTime } from "../utils/format";
  import TrackList from "../components/TrackList.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";

  let { key }: { key: string } = $props();

  const album = $derived(albumBy(player.tracks, key));
  const meta = $derived(
    album
      ? [album.artist, album.year ? String(album.year) : null, albumKind(album), `${album.tracks.length} songs`, formatTime(album.duration)]
          .filter(Boolean)
          .join(" · ")
      : "",
  );
</script>

{#if !album}
  <EmptyState
    title="Album not found"
    body="It may have been retagged or removed in a rescan."
  />
{:else}
  <div class="page">
    <button class="back" onclick={() => ui.back()}>
      <Icon name="arrow-left" size={15} />
      Back
    </button>

    <header>
      {#if album.artwork}
        <img class="hero" src={album.artwork} alt="" draggable="false" />
      {:else}
        <div class="hero none"><Icon name="disc" size={44} /></div>
      {/if}
      <div class="head">
        <span class="kind">{albumKind(album)}</span>
        <h1>{album.title}</h1>
        <p class="meta">{meta}</p>
        <div class="acts">
          <button class="btn btn-primary" onclick={() => player.playFrom(album.tracks[0].id, album.tracks)}>
            <Icon name="play" size={14} />
            Play
          </button>
          <button
            class="btn"
            onclick={() => {
              player.shuffle = true;
              player.playFrom(album.tracks[Math.floor(Math.random() * album.tracks.length)].id);
            }}
          >
            <Icon name="shuffle" size={14} />
            Shuffle
          </button>
        </div>
      </div>
    </header>

    <TrackList tracks={album.tracks} showArtist={album.tracks.some((t) => t.albumArtist && t.artist !== t.albumArtist)} />
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
    margin-bottom: 30px;
  }

  .hero {
    width: clamp(140px, 15vw, 208px);
    aspect-ratio: 1;
    border-radius: 14px;
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
</style>
