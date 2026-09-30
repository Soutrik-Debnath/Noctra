<script lang="ts">
  /**
   * The one transient message surface. See `stores/notice.svelte.ts` for why it exists.
   *
   * Sits above the player bar and centred on the content area rather than the window, so it does not
   * straddle the nav rail. Opacity and transform only, matching the motion budget everywhere else.
   */
  import Icon from "./Icon.svelte";
  import { notice } from "../stores/notice.svelte";
</script>

{#if notice.visible}
  <div class="notice glass-strong" class:bad={notice.tone === "bad"} role="status" aria-live="polite">
    <Icon name={notice.tone === "bad" ? "block" : "check"} size={14} />
    <span>{notice.text}</span>
    <button class="x" aria-label="Dismiss" onclick={() => notice.dismiss()}>
      <Icon name="close" size={12} />
    </button>
  </div>
{/if}

<style>
  .notice {
    position: fixed;
    left: 50%;
    bottom: calc(var(--pad-bottom) + 10px);
    transform: translate(-50%, 0);
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: min(520px, 60vw);
    padding: 9px 12px 9px 14px;
    border-radius: var(--radius-pill);
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    z-index: 60;
    animation: notice-in 260ms var(--ease-out);
  }

  .notice.bad {
    border-color: rgb(var(--love-rgb) / 0.4);
  }

  .notice :global(svg) {
    flex: none;
    color: var(--accent);
  }

  .notice.bad :global(svg) {
    color: var(--love);
  }

  span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .x {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: var(--text-faint);
    transition: color 140ms var(--ease-out);
  }

  .x:hover {
    color: var(--text);
  }

  @keyframes notice-in {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .notice {
      animation: none;
    }
  }

  :global(html[data-low-power]) .notice {
    animation: none;
  }
</style>
