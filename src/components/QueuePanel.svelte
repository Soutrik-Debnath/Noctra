<script lang="ts">
  /**
   * The play queue, sliding over the content area.
   *
   * Two lists, not one: the hand-added queue, which is reorderable and takes precedence, and the run
   * the player derived from shuffle / play-similar, which is read-only.
   *
   * Drag-reorder uses HTML5 drag events with an index carried in the data payload. Only the hand queue
   * is draggable, and it stays unvirtualised. The derived list is a different size problem — with
   * shuffle on it is the whole library — so its artwork is lazy-loaded and it is capped by the length
   * of the play order rather than by anything here.
   */
  import { player } from "../stores/player.svelte";
  import { ui } from "../stores/ui.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { trackMenu } from "../services/trackMenu";
  import { menu } from "../stores/menu.svelte";
  import { formatTime } from "../utils/format";
  import Icon from "./Icon.svelte";

  let dragFrom = $state(-1);
  let dropAt = $state(-1);

  const queued = $derived(player.queueTracks);
  const auto = $derived(player.upNext);
  const nowPlaying = $derived(player.current);

  function onDragStart(e: DragEvent, i: number) {
    dragFrom = i;
    e.dataTransfer?.setData("text/plain", String(i));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    if (dragFrom === -1) return;
    dropAt = i;
    // Keep the pointer target under the cursor when dragging downward, or the row lands one short.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (i > dragFrom && e.clientY > rect.top + rect.height / 2) {
      dropAt = i;
    }
  }

  function onDrop(i: number) {
    if (dragFrom !== -1 && dragFrom !== i) player.moveInQueue(dragFrom, i);
    dragFrom = -1;
    dropAt = -1;
  }

  function onDragEnd() {
    dragFrom = -1;
    dropAt = -1;
  }

  function openMenu(e: MouseEvent, i: number) {
    e.preventDefault();
    const track = queued[i];
    if (track) menu.show(e, trackMenu(track, { inQueueIndex: i }));
  }

  const totalRemaining = $derived(
    queued.reduce((sum, t) => sum + t.duration, 0) +
      Math.max(0, nowPlaying.duration - player.position),
  );
</script>

<section class="panel glass-strong" aria-label="Play queue" aria-hidden={!ui.queueOpen}>
  <header>
    <div class="titles">
      <h2>Queue</h2>
      <span class="sub">
        {#if queued.length > 0}
          {queued.length} {queued.length === 1 ? "song" : "songs"} · {formatTime(totalRemaining)} left
        {:else}
          Nothing queued · {auto.length} {auto.length === 1 ? "song" : "songs"} up next
        {/if}
      </span>
    </div>
    <div class="acts">
      {#if queued.length > 0}
        <button class="txt" onclick={() => player.clearQueue()}>Clear</button>
      {/if}
      <button class="icon" aria-label="Close queue" title="Close queue" onclick={() => ui.toggleQueue()}>
        <Icon name="close" size={16} />
      </button>
    </div>
  </header>

  <div class="body">
    <p class="label">Now playing</p>
    <div class="row current">
      <img src={nowPlaying.artwork} alt="" draggable="false" />
      <div class="meta">
        <span class="t">{nowPlaying.title || "Nothing loaded"}</span>
        <span class="a">{nowPlaying.artist}</span>
      </div>
      {#if favorites.has(nowPlaying.id)}
        <span class="liked"><Icon name="heart-filled" size={13} /></span>
      {/if}
    </div>

    {#if queued.length === 0 && auto.length === 0}
      <p class="label">Next up</p>
      <div class="empty">
        <Icon name="queue" size={26} />
        <p>Nothing queued.</p>
        <span>Right-click any song and choose <b>Add to queue</b> or <b>Play next</b>.</span>
      </div>
    {/if}
    {#if queued.length > 0}
      <p class="label">Next up</p>
      {#each queued as track, i (track.id)}
        <button
          class="row"
          class:dragging={dragFrom === i}
          class:target={dropAt === i && dragFrom !== -1 && dragFrom !== i}
          draggable="true"
          ondragstart={(e) => onDragStart(e, i)}
          ondragover={(e) => onDragOver(e, i)}
          ondrop={() => onDrop(i)}
          ondragend={onDragEnd}
          onclick={() => player.playFrom(track.id)}
          oncontextmenu={(e) => openMenu(e, i)}
        >
          <span class="grip" aria-hidden="true">⋮</span>
          <img src={track.artwork} alt="" draggable="false" />
          <div class="meta">
            <span class="t">{track.title}</span>
            <span class="a">{track.artist}</span>
          </div>
          <span class="dur">{formatTime(track.duration)}</span>
          <span
            class="rm"
            role="button"
            tabindex="0"
            aria-label="Remove from queue"
            title="Remove from queue"
            onclick={(e) => {
              e.stopPropagation();
              player.removeAt(i);
            }}
            onkeydown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              player.removeAt(i);
            }}
          >
            <Icon name="close" size={13} />
          </span>
        </button>
      {/each}
    {/if}

    <!--
       The run itself. Turning shuffle on has always permuted the play order; nothing rendered it, so
       the panel said "Nothing queued" while a full shuffled run was queued and working. This is the
       part the transport's shuffle and play-similar switches actually change.

       Not draggable and has no remove button: these picks are derived from the mode and the current
       song, not put here by hand, so reordering them would be undone by the next step and "removing"
       one is the block action, which lives on the track menu.
    -->
    {#if auto.length > 0}
      <p class="label">{player.runLabel}</p>
      {#each auto as track (track.id)}
        <button class="row auto" onclick={() => player.playFrom(track.id)} title="Play now">
          <span class="grip" aria-hidden="true"></span>
          <img src={track.artwork} alt="" loading="lazy" draggable="false" />
          <div class="meta">
            <span class="t">{track.title}</span>
            <span class="a">{track.artist}</span>
          </div>
          <span class="dur">{formatTime(track.duration)}</span>
        </button>
      {/each}
    {/if}
  </div>
</section>

<style>
  .panel {
    position: absolute;
    /* The rail's twin on the opposite side, deliberately to the pixel.

       This pane used to be `top: 0; right: 0; bottom: 0` — flush to three edges — while every other
       glass surface in the app floats with `--float-inset` and a `--radius-float` capsule. A flush
       rectangle with one hairline and square corners next to two floating pills reads as a different
       kind of object that fell on top of them, which is exactly what the owner reported. Sharing the
       rail's top and bottom insets makes the two panes close the window as one system.

       `overflow: hidden` is what lets the corners actually clip: the body scrolls, and without it the
       first row paints over the rounded bottom. */
    top: var(--float-inset);
    right: var(--float-inset);
    bottom: calc(var(--bar-h) + var(--float-inset));
    width: min(380px, 42vw);
    z-index: 40;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: var(--radius-float);
    animation: slide 300ms var(--ease-out);
  }

  @keyframes slide {
    from {
      transform: translateX(24px);
      opacity: 0;
    }
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 22px 20px 14px;
    flex: none;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  h2 {
    font-size: var(--fs-2xl);
    font-weight: 800;
    letter-spacing: -0.5px;
  }

  .sub {
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-dim);
  }

  .acts {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .txt {
    font-size: var(--fs-sm);
    font-weight: 700;
    padding: 6px 11px;
    border-radius: 999px;
    color: var(--text-dim);
    transition:
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .txt:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .icon {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--text-dim);
    transition:
      color var(--tap) var(--ease-out),
      background-color var(--tap) var(--ease-out);
  }

  .icon:hover {
    color: var(--text);
    background: var(--surface-2);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 12px 20px;
  }

  .label {
    font-size: var(--fs-2xs);
    font-weight: 800;
    letter-spacing: 1.1px;
    text-transform: uppercase;
    color: var(--text-faint);
    padding: 14px 8px 8px;
  }

  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px;
    border-radius: 11px;
    text-align: left;
    /* No `transition` here: the global `.row` primitive already lists background-color,
       border-color and transform at `--tap`. A partial scoped list wins on specificity and drops
       whatever it omits, which is how the hover border on queue rows came to snap. */
  }

  .row:hover {
    background: var(--surface-1);
  }

  /* The derived run sits under the hand queue and has to read that way, or a 300-row shuffled list
     looks like something the listener built. Ink only — no plate, no border — so the two sections
     still share one rhythm down the pane. */
  .row.auto .t {
    color: var(--text-dim);
  }

  .row.auto .dur {
    opacity: 0.55;
  }

  .row.dragging {
    opacity: 0.4;
  }

  .row.target {
    background: rgb(var(--accent-rgb) / 0.14);
    box-shadow: inset 0 0 0 1px rgb(var(--accent-rgb) / 0.4);
  }

  .row.current {
    cursor: default;
    background: var(--surface-1);
  }

  .grip {
    font-size: var(--fs-sm);
    line-height: 1;
    color: var(--text-faint);
    flex: none;
    width: 12px;
    cursor: grab;
    letter-spacing: -2px;
  }

  img {
    width: 38px;
    height: 38px;
    border-radius: 6px;
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
    font-size: var(--fs-base);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .a {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dur {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .liked {
    color: var(--love);
    flex: none;
    display: grid;
    place-items: center;
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

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    padding: 34px 22px;
    color: var(--text-faint);
  }

  .empty p {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--text-dim);
  }

  .empty span {
    font-size: var(--fs-sm);
    font-weight: 500;
    line-height: 1.5;
  }

  .empty b {
    color: var(--text-dim);
    font-weight: 700;
  }
</style>
