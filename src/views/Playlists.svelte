<script lang="ts">
  /** The playlist list. Creating one here starts it empty; tracks are added from any row menu. */
  import { playlists } from "../stores/playlists.svelte";
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { menu } from "../stores/menu.svelte";
  import { dialog } from "../stores/dialog.svelte";
  import { formatTime } from "../utils/format";
  import { coverMenuItems, coverOf } from "../services/playlistCover";
  import EmptyState from "../components/EmptyState.svelte";
  import Icon from "../components/Icon.svelte";

  function runtime(id: string): number {
    const list = playlists.byId(id);
    if (!list) return 0;
    return list.trackIds.reduce((s, t) => s + (player.tracks.find((x) => x.id === t)?.duration ?? 0), 0);
  }

  async function createNow() {
    const name = await dialog.ask("New playlist", {
      inputLabel: "Playlist name",
      confirmText: "Create",
    });
    if (name === null) return;
    const created = playlists.create(name);
    ui.openPlaylist(created.id);
  }

  function openMenu(e: MouseEvent | KeyboardEvent, id: string, name: string) {
    e.preventDefault();
    e.stopPropagation();
    // A keyboard activation carries no pointer position, so anchoring the menu on `clientX` would
    // park it in the top-left corner. Keyboard users get it hanging off the button they pressed.
    const anchor =
      e instanceof MouseEvent
        ? e
        : ((el) => {
            const r = el?.getBoundingClientRect();
            return { clientX: r ? r.right - 6 : 0, clientY: r ? r.bottom : 0 } as MouseEvent;
          })(e.currentTarget as HTMLElement | null);
    menu.show(anchor, [
      { label: "Open", icon: "play", onSelect: () => ui.openPlaylist(id) },
      {
        label: "Rename",
        icon: "check",
        onSelect: async () => {
          const next = await dialog.ask("Rename playlist", {
            inputLabel: "Playlist name",
            value: name,
            confirmText: "Rename",
          });
          if (next !== null && next.trim()) playlists.rename(id, next);
        },
      },
      { separator: true },
      ...coverMenuItems(id),
      { separator: true },
      {
        label: "Delete",
        icon: "trash",
        danger: true,
        onSelect: async () => {
          const yes = await dialog.confirm(
            `Delete "${name}"?`,
            "The songs themselves are not touched.",
          );
          if (yes) playlists.remove(id);
        },
      },
    ]);
  }

  const lists = $derived(playlists.lists);
  // Resolved once per render rather than per lookup inside the card markup.
  const rows = $derived(lists.map((p) => ({ p, art: coverOf(p) })));
</script>

<div class="page">
  <div class="top">
    <div>
      <h1 class="section-title">Playlists</h1>
      <p class="sub">
        {lists.length} {lists.length === 1 ? "playlist" : "playlists"}
      </p>
    </div>
    <button class="btn btn-primary" onclick={createNow}>
      <Icon name="plus" size={14} />
      New playlist
    </button>
  </div>

  {#if lists.length === 0}
    <EmptyState
      title="No playlists yet"
      body="Create one, then right-click any song and choose Add to playlist."
    />
  {:else}
    <div class="grid stagger">
      {#each rows as { p, art } (p.id)}
        <button
          class="card"
          onclick={() => ui.openPlaylist(p.id)}
          oncontextmenu={(e) => openMenu(e, p.id, p.name)}
        >
          {#if art.kind === "image"}
            <img src={art.value} alt="" draggable="false" loading="lazy" />
          {:else if art.kind === "emoji"}
            <span class="emoji" aria-hidden="true">{art.value}</span>
          {:else}
            <span class="ph"><Icon name="playlists" size={30} /></span>
          {/if}
          <span class="info">
            <span class="n">{p.name}</span>
            <span class="m">
              {p.trackIds.length} {p.trackIds.length === 1 ? "song" : "songs"}
              {#if p.trackIds.length}· {formatTime(runtime(p.id))}{/if}
            </span>
          </span>
          <span
            class="opts"
            role="button"
            tabindex="0"
            aria-label="Playlist options"
            onclick={(e) => {
              e.stopPropagation();
              openMenu(e, p.id, p.name);
            }}
            onkeydown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              openMenu(e, p.id, p.name);
            }}
            oncontextmenu={(e) => openMenu(e, p.id, p.name)}
          >
            <Icon name="more" size={16} />
          </span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page {
    padding: 30px clamp(22px, 3.4vw, 46px) 120px;
    animation: rise 340ms var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  .top {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 26px;
  }

  .sub {
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-dim);
    margin-top: 4px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 18px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 14px;
    border-radius: 14px;
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
  /*
     An owner-chosen emoji occupies the same box as the placeholder it replaces, so the grid does not
     reflow when a cover is set. The size is fluid because the card width is: a fixed px glyph would
     be a sticker on a large card and a smudge on a small one.
  */
  .emoji {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 9px;
    display: grid;
    place-items: center;
    font-size: clamp(28px, 4.2vw, 46px);
    line-height: 1;
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }

  .ph {
    width: 100%;
    aspect-ratio: 1;
    border-radius: 9px;
    object-fit: cover;
    display: grid;
    place-items: center;
    background: var(--surface-2);
    color: var(--text-faint);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .n {
    font-size: var(--fs-md);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .m {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
  }

  .opts {
    position: absolute;
    top: 20px;
    right: 20px;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(10, 10, 14, 0.62);
    color: var(--text-dim);
    opacity: 0;
    transition:
      opacity var(--tap) var(--ease-out),
      color var(--tap) var(--ease-out);
  }

  .card:hover .opts {
    opacity: 1;
  }

  .opts:hover {
    color: var(--text);
  }
</style>
