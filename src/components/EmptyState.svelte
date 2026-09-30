<script lang="ts">
  /** Honest stand-in for a view whose real content lands in a later phase. */
  import Icon from "../components/Icon.svelte";
  import type { IconName } from "../components/icons";

  let {
    title,
    body,
    phase,
    icon = "library",
  }: {
    title: string;
    body: string;
    /** Omit once the view is real; the tag is only for a placeholder. */
    phase?: string;
    // Was a hand-maintained list of four names, which meant every new view had to widen it before it
    // could show an empty state. `Icon` already defines the complete set.
    icon?: IconName;
  } = $props();
</script>

<div class="empty glass-panel">
  <span class="ico"><Icon name={icon} size={26} /></span>
  <h2>{title}</h2>
  <p>{body}</p>
  {#if phase}<span class="tag">Lands in {phase}</span>{/if}
</div>

<style>
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    text-align: center;
    padding: 48px 40px;
    max-width: 460px;
    margin: auto;
  }

  .ico {
    display: grid;
    place-items: center;
    width: 62px;
    height: 62px;
    border-radius: 50%;
    color: var(--text-faint);
    background-color: rgba(255, 255, 255, 0.06);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0) 60%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
    margin-bottom: 6px;
  }

  h2 {
    font-size: var(--fs-xl);
    font-weight: 650;
  }

  p {
    max-width: 380px;
    font-size: var(--fs-md);
    line-height: 1.55;
    color: var(--text-dim);
  }

  .tag {
    margin-top: 8px;
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    font-size: var(--fs-xs);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    /* Accent ink on an accent-tinted pill is 2.67:1; the floored variant is 5.8:1 on the same fill. */
    color: var(--accent-text);
    background: rgb(var(--accent-rgb) / 0.12);
    transition: color 500ms var(--ease-out);
  }
</style>
