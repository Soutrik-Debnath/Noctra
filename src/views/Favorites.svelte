<script lang="ts">
  /**
   * Favorites. The heart is the only control here; playlists and queue modes are still Phase 5.
   *
   * The list is derived from the playable tracks rather than stored separately, so a track that
   * leaves the library drops out of favorites on its own instead of lingering as a dead row.
   */
  import Icon from "../components/Icon.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import { player } from "../stores/player.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { formatTime } from "../utils/format";
  import { menu } from "../stores/menu.svelte";
  import { trackMenu } from "../services/trackMenu";

  const list = $derived(player.tracks.filter((t) => favorites.has(t.id)));
</script>

<div class="page">
  <header>
    <h1>Favorites</h1>
    <p class="sub">
      {#if list.length}
        {list.length} {list.length === 1 ? "track" : "tracks"}
      {:else}
        Nothing hearted yet
      {/if}
    </p>
  </header>

  {#if list.length === 0}
    <EmptyState
      title="Your favorites are empty"
      body="Heart a track from the mini-player bar or the Now Playing artwork and it will collect here."
      icon="heart"
    />
  {:else}
    <ul>
      {#each list as track (track.id)}
        <li>
          <button
            class="row"
            class:active={player.current?.id === track.id}
            onclick={() => void player.playFrom(track.id, list)}
            oncontextmenu={(e) => {
              e.preventDefault();
              menu.show(e, trackMenu(track));
            }}
          >
            <img class="thumb" src={track.artwork} alt="" draggable="false" loading="lazy" />
            <span class="text">
              <span class="title">{track.title}</span>
              <span class="sub">{track.artist} · {track.album}</span>
            </span>
            <span class="dur">{formatTime(track.duration)}</span>
            <span class="fav">
              <Icon name="heart-filled" size={15} />
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 32px var(--gutter);
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  h1 {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }

  .page > header > .sub {
    margin-top: 6px;
    font-size: var(--fs-base);
    color: var(--text-dim);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 720px;
  }

  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid transparent;
    text-align: left;
    /* Replaces the `.row` primitive's list rather than adding to it — the scoped `.row.svelte-hash`
       out-specifies the global `.row`, so `transform` has to be repeated here or the shared
       `.row:active` press squeeze snaps on every favourite. */
    transition:
      background-color 160ms var(--ease-out),
      border-color 160ms var(--ease-out),
      transform 160ms var(--ease-out);
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
    width: 46px;
    height: 46px;
    border-radius: 9px;
    object-fit: cover;
    flex: none;
    background: var(--surface-2);
    box-shadow:
      0 6px 16px -7px rgba(0, 0, 0, 0.8),
      inset 0 0 0 1px rgba(255, 255, 255, 0.11);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
    flex: 1;
  }

  .title {
    font-size: var(--fs-md);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .active .title {
    /* See controls.css .row.active: raw accent on sleeve-coloured glass measures 2.33:1. */
    color: var(--accent-text);
    transition: color 500ms var(--ease-out);
  }

  .text .sub {
    font-size: var(--fs-sm);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dur {
    font-size: var(--fs-sm);
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .fav {
    display: grid;
    place-items: center;
    width: 26px;
    color: var(--accent-text);
    flex: none;
    transition: color 500ms var(--ease-out);
  }
</style>
