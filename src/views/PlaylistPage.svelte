<script lang="ts">
  /** One playlist: editable name, drag-free reorder through the row menu, and removal. */
  import { player } from "../stores/player.svelte";
  import { playlists } from "../stores/playlists.svelte";
  import { ui } from "../stores/ui.svelte";
  import { menu } from "../stores/menu.svelte";
  import { dialog } from "../stores/dialog.svelte";
  import { trackMenu } from "../services/trackMenu";
  import { coverMenuItems, coverOf } from "../services/playlistCover";
  import { formatTime } from "../utils/format";
  import type { Track } from "../data/track";
  import TrackList from "../components/TrackList.svelte";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";

  let { id }: { id: string } = $props();

  const list = $derived(playlists.byId(id));
  const tracks = $derived(
    list ? (list.trackIds.map((t) => player.tracks.find((x) => x.id === t)).filter(Boolean) as Track[]) : [],
  );

  let editing = $state(false);
  let draft = $state("");

  function startRename() {
    if (!list) return;
    draft = list.name;
    editing = true;
  }

  function commit() {
    if (list && draft.trim()) playlists.rename(list.id, draft);
    editing = false;
  }

  /** The header square: owner's cover if set, else the first track's artwork. */
  const art = $derived(coverOf(list));

  function openMenu(e: MouseEvent) {
    e.preventDefault();
    if (!list) return;
    menu.show(e, [
      {
        label: "Play",
        icon: "play",
        onSelect: () => {
          if (tracks[0]) void player.playFrom(tracks[0].id);
        },
      },
      {
        label: "Shuffle play",
        icon: "shuffle",
        onSelect: () => {
          player.shuffle = true;
          const pick = tracks[Math.floor(Math.random() * tracks.length)];
          if (pick) void player.playFrom(pick.id);
        },
      },
      { separator: true },
      { label: "Rename", icon: "check", onSelect: startRename },
      { separator: true },
      ...coverMenuItems(list.id),
      { separator: true },
      {
        label: "Delete playlist",
        icon: "trash",
        danger: true,
        onSelect: async () => {
          const yes = await dialog.confirm(
            `Delete "${list.name}"?`,
            "The songs themselves are not touched.",
          );
          if (!yes) return;
          playlists.remove(list.id);
          ui.set("playlists");
        },
      },
    ]);
  }
</script>

{#if !list}
  <EmptyState title="Playlist not found" body="It may have been deleted." />
{:else}
  <div class="page">
    <button class="back" onclick={() => ui.set("playlists")}>
      <Icon name="arrow-left" size={15} />
      All playlists
    </button>

    <header>
      {#if art.kind === "image"}
        <img class="hero" src={art.value} alt="" draggable="false" />
      {:else if art.kind === "emoji"}
        <div class="hero emoji" aria-hidden="true">{art.value}</div>
      {:else}
        <div class="hero none"><Icon name="playlists" size={40} /></div>
      {/if}
      <div class="head">
        <span class="kind">Playlist</span>
        {#if editing}
          <input
            class="edit"
            bind:value={draft}
            aria-label="Playlist name"
            onkeydown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") editing = false;
            }}
            onblur={commit}
          />
        {:else}
          <h1 ondblclick={startRename} title="Double-click to rename">{list.name}</h1>
        {/if}
        <p class="meta">
          {tracks.length} {tracks.length === 1 ? "song" : "songs"} ·
          {formatTime(tracks.reduce((s, t) => s + t.duration, 0))}
        </p>
        {#if tracks.length > 0}
          <div class="acts">
            <button class="btn btn-primary" onclick={() => player.playFrom(tracks[0].id)}>
              <Icon name="play" size={14} />
              Play
            </button>
            <button
              class="btn"
              onclick={() => {
                player.shuffle = true;
                player.playFrom(tracks[Math.floor(Math.random() * tracks.length)].id);
              }}
            >
              <Icon name="shuffle" size={14} />
              Shuffle
            </button>
          </div>
        {/if}
      </div>
      <button class="opts" aria-label="Playlist options" onclick={(e) => openMenu(e)}>
        <Icon name="more" size={17} />
      </button>
    </header>

    {#if tracks.length === 0}
      <div class="empty">
        <p>Nothing here yet.</p>
        <span>Right-click any song and choose <b>Add to playlist</b>.</span>
      </div>
    {:else}
      <TrackList
        {tracks}
        onRemove={(t) => {
          playlists.removeTrack(list.id, t.id);
        }}
      />
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
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: clamp(18px, 2.6vw, 34px);
    margin-bottom: 26px;
  }

  /* An owner-chosen emoji fills the same square the artwork would, scaled off the square itself. */
  .hero.emoji {
    display: grid;
    place-items: center;
    font-size: clamp(56px, 6vw, 84px);
    line-height: 1;
    background: var(--surface-2);
  }

  .hero {
    width: clamp(130px, 14vw, 190px);
    aspect-ratio: 1;
    border-radius: 13px;
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
    font-size: clamp(26px, 4vw, 48px);
    font-weight: 800;
    letter-spacing: -1.6px;
    line-height: 1.06;
    cursor: text;
  }

  .edit {
    font: inherit;
    font-size: clamp(26px, 4vw, 48px);
    font-weight: 800;
    letter-spacing: -1.6px;
    background: var(--surface-1);
    border-radius: 10px;
    padding: 4px 12px;
    outline: 2px solid rgb(var(--accent-rgb) / 0.7);
    width: 100%;
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

  .opts {
    position: absolute;
    right: 0;
    bottom: 0;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    color: var(--text-dim);
    transition:
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .opts:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .empty {
    padding: 34px 6px;
    color: var(--text-faint);
  }

  .empty p {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-dim);
    margin-bottom: 5px;
  }

  .empty span {
    font-size: var(--fs-base);
  }

  .empty b {
    color: var(--text-dim);
  }
</style>
