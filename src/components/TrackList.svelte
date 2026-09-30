<script lang="ts">
  /**
   * A numbered track list with per-row play state and the shared right-click menu.
   *
   * Used by the album, artist and playlist pages. Deliberately not virtualised: these lists are
   * bounded by one album or one artist's output, not by the whole library, so the windowed list in
   * Library would be solving a problem that is not present here.
   */
  import { player } from "../stores/player.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { menu } from "../stores/menu.svelte";
  import { trackMenu } from "../services/trackMenu";
  import { formatTime } from "../utils/format";
  import { leadArtist } from "../data/track";
  import type { Track } from "../data/track";
  import Icon from "./Icon.svelte";

  let {
    tracks,
    showArtist = true,
    onRemove,
  }: {
    tracks: Track[];
    showArtist?: boolean;
    /** When set, a row gets a remove affordance — used by playlists. */
    onRemove?: (track: Track, index: number) => void;
  } = $props();

  function openMenu(e: MouseEvent, track: Track) {
    e.preventDefault();
    menu.show(e, trackMenu(track));
  }
</script>

<ol class="list">
  {#each tracks as track, i (track.id)}
    {@const active = track.id === player.current.id}
    <li>
      <button
        class="row"
        class:active
        onclick={() => player.playFrom(track.id, tracks)}
        ondblclick={() => player.playFrom(track.id, tracks)}
        oncontextmenu={(e) => openMenu(e, track)}
      >
        <span class="num">
          {#if active}
            <span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>
          {:else}
            <span class="n">{i + 1}</span>
            <span class="p"><Icon name="play" size={13} /></span>
          {/if}
        </span>

        {#if track.artwork}
          <img class="art" src={track.artwork} alt="" draggable="false" loading="lazy" />
        {/if}

        <span class="meta">
          <span class="t">{track.title}</span>
          {#if showArtist}<span class="a">{leadArtist(track.artist)}</span>{/if}
        </span>

        {#if favorites.has(track.id)}
          <span class="liked"><Icon name="heart-filled" size={12} /></span>
        {/if}

        <span class="dur">{formatTime(track.duration)}</span>

        {#if onRemove}
          <span
            class="rm"
            role="button"
            tabindex="0"
            aria-label="Remove from this list"
            title="Remove from this list"
            onclick={(e) => {
              e.stopPropagation();
              onRemove(track, i);
            }}
            onkeydown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onRemove(track, i);
            }}
          >
            <Icon name="close" size={13} />
          </span>
        {/if}
      </button>
    </li>
  {/each}
</ol>

<style>
  ol,
  li {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 12px;
    border-radius: 10px;
    text-align: left;
    /* No `transition` here on purpose. The global `.row` primitive already carries
       background-color, border-color and transform at `--tap`; re-declaring a partial list under a
       scoped `.row.svelte-hash` out-specifies it and silently drops the rest, which is how the press
       squeeze and the hover border came to snap on album, artist and playlist track lists. */
  }

  .row:hover {
    background: var(--surface-1);
  }

  .row.active {
    background: rgb(var(--accent-rgb) / 0.13);
  }

  .num {
    width: 22px;
    flex: none;
    display: grid;
    place-items: center;
    color: var(--text-faint);
  }

  /*
    The index cell crossfades between the track number and the play glyph.

    It swapped `display: none` for `display: grid`, which is atomic: an element that was not rendered
    has no starting computed value, so nothing can ease. The number popped out on the same frame the
    glyph popped in, while the row's own background was still washing in over --tap — the one part of
    the hover that arrived instantly. Both children now share the single 22px cell via
    `grid-area: 1 / 1` and trade opacity instead, so the swap lasts as long as the hover that caused
    it and the cell never changes size mid-fade.

    No markup cost: `.p` wraps an Icon that is already `aria-hidden`, so holding it in the tree at
    opacity 0 exposes nothing new, and Chromium skips painting a fully transparent element.
  */
  .n,
  .p {
    grid-area: 1 / 1;
    transition:
      opacity var(--tap) var(--ease-out),
      color var(--tap) var(--ease-out);
  }

  .n {
    font-size: var(--fs-sm);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .p {
    opacity: 0;
  }

  .bars {
    display: none;
  }

  .row:hover .n {
    opacity: 0;
  }

  .row:hover .p {
    opacity: 1;
    color: var(--text);
  }

  .row.active .bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 12px;
  }

  .bars i {
    width: 2.5px;
    border-radius: 2px;
    background: rgb(var(--accent-rgb));
    animation: eq 1s ease-in-out infinite;
  }

  .bars i:nth-child(1) {
    height: 45%;
    animation-delay: -0.4s;
  }

  .bars i:nth-child(2) {
    height: 90%;
  }

  .bars i:nth-child(3) {
    height: 60%;
    animation-delay: -0.7s;
  }

  @keyframes eq {
    0%,
    100% {
      transform: scaleY(0.45);
    }
    50% {
      transform: scaleY(1);
    }
  }

  :global(html[data-low-power]) .bars i {
    animation: none;
  }

  .art {
    width: 34px;
    height: 34px;
    border-radius: 5px;
    object-fit: cover;
    flex: none;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }

  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .t {
    font-size: var(--fs-md);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row.active .t {
    color: var(--accent-text);
  }

  .a {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .liked {
    color: var(--love);
    flex: none;
    display: grid;
    place-items: center;
  }

  .dur {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .rm {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex: none;
    color: var(--text-faint);
    opacity: 0;
    transition:
      opacity var(--tap) var(--ease-out),
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .row:hover .rm {
    opacity: 1;
  }

  .rm:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .rm:focus-visible {
    opacity: 1;
    outline: 2px solid rgb(var(--accent-rgb) / 0.8);
  }
</style>
