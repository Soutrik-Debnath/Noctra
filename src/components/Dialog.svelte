<script lang="ts">
  /**
   * The app's replacement for `window.prompt` / `window.confirm`.
   *
   * Mounted once beside `<Notice />` and driven by `stores/dialog.svelte.ts`, for the same reason the
   * context menu is mounted once: a dialog is not owned by the control that opened it, and the caller
   * has already moved on by the time the answer arrives.
   *
   * A form, so Enter submits from the field and the browser's own implicit submission does the work
   * rather than a keydown handler that would miss the second button.
   */
  import { dialog } from "../stores/dialog.svelte";

  let value = $state("");
  let field = $state<HTMLInputElement | null>(null);
  let okBtn = $state<HTMLButtonElement | null>(null);
  let restoreTo: HTMLElement | null = null;

  $effect(() => {
    const req = dialog.request;
    if (!req) {
      // Restoring focus is what keeps a keyboard user from being dropped at the top of the document
      // after dismissing a dialog they did not tab to.
      if (restoreTo?.isConnected) restoreTo.focus();
      restoreTo = null;
      return;
    }
    restoreTo = document.activeElement as HTMLElement | null;
    value = req.value ?? "";
    // One frame after the node exists; the {#if} mounts in the same tick as the store write.
    queueMicrotask(() => (req.inputLabel ? field : okBtn)?.focus());
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      dialog.cancel();
    }
  }

  function submit() {
    const req = dialog.request;
    if (!req) return;
    if (req.inputLabel && !req.allowEmpty && value.trim() === "") return; // nothing to act on yet
    dialog.submit(value.trim());
  }
</script>

{#if dialog.request}
  {@const req = dialog.request}
  <div
    class="scrim"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) dialog.cancel();
    }}
  >
    <div
      class="box glass-strong"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlg-title"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onKey}
    >
      <form
        onsubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 id="dlg-title">{req.title}</h2>
        {#if req.detail}
          <p class="detail">{req.detail}</p>
        {/if}
        {#if req.inputLabel}
          <label class="field">
            <span>{req.inputLabel}</span>
            <input
              bind:this={field}
              type="text"
              bind:value
              inputmode={req.numeric ? "numeric" : "text"}
              pattern={req.numeric ? "[0-9]*" : undefined}
              placeholder={req.placeholder ?? ""}
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        {/if}
        <div class="acts">
          <button type="button" class="btn" onclick={() => dialog.cancel()}>Cancel</button>
          <button
            type="button"
            class="btn {req.danger ? 'btn-danger' : 'btn-primary'}"
            bind:this={okBtn}
            disabled={req.inputLabel && !req.allowEmpty ? value.trim() === "" : false}
            onclick={submit}
          >
            {req.confirmText}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 24px;
    /* A dim, not a blur. The fullscreen stage already paints its own scrim at z-index 30 and the queue
       drawer at 40; a second blurred layer on top of them reads as fog rather than as a raised sheet. */
    background: rgba(5, 5, 9, 0.62);
    animation: dlg-scrim 180ms var(--ease-out);
  }

  .box {
    width: min(430px, 100%);
    padding: 24px 24px 20px;
    border-radius: var(--radius-float);
    animation: dlg-rise 220ms var(--ease-out);
  }

  h2 {
    font-size: var(--fs-xl);
    font-weight: 800;
    letter-spacing: -0.4px;
    color: var(--text);
  }

  .detail {
    margin-top: 8px;
    font-size: var(--fs-md);
    font-weight: 600;
    line-height: 1.45;
    color: var(--text-dim);
  }

  .field {
    display: block;
    margin-top: 18px;
  }

  .field span {
    display: block;
    margin-bottom: 7px;
    font-size: var(--fs-2xs);
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .field input {
    width: 100%;
    height: 44px;
    padding: 0 16px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.09);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-md);
    font-weight: 700;
    transition:
      background-color var(--tap) var(--ease-out),
      border-color var(--tap) var(--ease-out);
  }

  .field input:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }

  @keyframes dlg-scrim {
    from {
      opacity: 0;
    }
  }

  @keyframes dlg-rise {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
  }
</style>
