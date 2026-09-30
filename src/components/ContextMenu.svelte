<script lang="ts">
  /**
   * The floating context menu. Mounted once in App and driven by the `menu` store.
   *
   * Positioned with `position: fixed` from the anchor point, then clamped inside the viewport after
   * the first paint — measuring before layout would use a stale height and let the bottom of a long
   * menu run off screen.
   */
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { menu } from "../stores/menu.svelte";

  let root = $state<HTMLDivElement | null>(null);
  let pos = $state({ x: 0, y: 0 });

  // Place, measure, then pull back inside the window if it overflowed.
  $effect(() => {
    if (!menu.open) return;
    pos = { x: menu.x, y: menu.y };
    void tick().then(() => {
      const el = root;
      if (!el) return;
      const pad = 8;
      const r = el.getBoundingClientRect();
      let { x, y } = pos;
      if (x + r.width > innerWidth - pad) x = Math.max(pad, innerWidth - r.width - pad);
      if (y + r.height > innerHeight - pad) y = Math.max(pad, menu.y - r.height);
      if (y < pad) y = pad;
      pos = { x, y };
    });
  });

  function onKey(e: KeyboardEvent) {
    if (!menu.open) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      menu.hide();
    }
  }

  $effect(() => {
    if (!menu.open) return;
    const dismiss = () => menu.hide();
    // Captured on the next tick so the same right-click that opened it does not immediately close it.
    const t = setTimeout(() => window.addEventListener("pointerdown", dismiss, { once: true }), 0);
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<svelte:window oncontextmenu={menu.open ? (e) => e.preventDefault() : undefined} />

{#if menu.open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={root}
    class="menu glass-strong"
    role="menu"
    tabindex="-1"
    style="left: {pos.x}px; top: {pos.y}px;"
    onpointerdown={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each menu.items as item, i (i)}
      {#if "separator" in item}
        <div class="sep"></div>
      {:else}
        <button
          class="item"
          class:danger={item.danger}
          disabled={item.disabled}
          role="menuitem"
          onclick={() => menu.run(item)}
        >
          {#if item.icon}
            <span class="ico"><Icon name={item.icon} size={15} /></span>
          {:else}
            <span class="ico"></span>
          {/if}
          <span class="label">{item.label}</span>
          {#if item.hint}<span class="hint">{item.hint}</span>{/if}
        </button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 200;
    min-width: 214px;
    padding: 6px;
    border-radius: 14px;
    animation: pop 140ms var(--ease-out);
    transform-origin: top left;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(-4px);
    }
  }

  .item {
    display: flex;
    align-items: center;
    gap: 11px;
    width: 100%;
    padding: 9px 11px;
    border-radius: 9px;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text);
    text-align: left;
    transition:
      background-color var(--tap) var(--ease-out),
      color var(--tap) var(--ease-out);
  }

  .item:hover:not(:disabled) {
    background: var(--surface-2);
  }

  .item:focus-visible {
    outline: 2px solid rgb(var(--accent-rgb) / 0.8);
    outline-offset: -2px;
  }

  .item:disabled {
    opacity: 0.36;
    cursor: default;
  }

  .item.danger {
    color: var(--love);
  }

  .ico {
    display: grid;
    place-items: center;
    width: 17px;
    flex: none;
    opacity: 0.78;
  }

  .label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hint {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
    flex: none;
  }

  .sep {
    height: 1px;
    margin: 5px 8px;
    background: var(--hairline);
  }
</style>
