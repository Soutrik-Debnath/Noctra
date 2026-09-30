<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ui, type View } from "../stores/ui.svelte";

  /*
     One-shot entrance on the nav glyph.

     The class is never cleared, and the element is re-created by the `{#key}` below instead. That is
     what restarts a CSS animation: the earlier design held the class for a fixed number of ms and
     cleared it on a timer, and a second click before the first timer expired stripped the class out of
     the middle of the new animation. Measured, a 380ms drop died at 60ms. There is no timer left to
     race.
  */
  let nudge = $state("");
  let nudgeKey = $state(0);

  /** Entering these views plays a one-shot on the nav glyph. `--ease-spring` settles both. */
  const ENTRY: Partial<Record<View, string>> = {
    settings: "mixer-nudge",
    library: "nav-drop",
  };

  function go(view: View) {
    ui.set(view);
    if (ENTRY[view]) {
      nudge = view;
      nudgeKey++;
    }
  }

  const items: {
    view: View;
    label: string;
    icon: "home" | "library" | "playlists" | "heart" | "settings" | "stats";
  }[] = [
    { view: "home", label: "Home", icon: "home" },
    { view: "library", label: "Library", icon: "library" },
    { view: "playlists", label: "Playlists", icon: "playlists" },
    { view: "favorites", label: "Favorites", icon: "heart" },
    { view: "stats", label: "Statistics", icon: "stats" },
    { view: "settings", label: "Settings", icon: "settings" },
  ];
</script>

<nav class="rail glass" aria-label="Primary">
  <div class="brand">
    <span class="word">Noctra</span>
  </div>

  <ul>
    {#each items as item (item.view)}
      <li>
        <button
          class="nav"
          class:active={ui.view === item.view}
          aria-current={ui.view === item.view ? "page" : undefined}
          onclick={() => go(item.view)}
        >
          {#key nudgeKey}
            <Icon
              name={item.icon}
              size={19}
              weight={ui.view === item.view ? "fill" : "line"}
              class={nudge === item.view ? ENTRY[item.view] : ""}
            />
          {/key}
          <span>{item.label}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .rail {
    position: absolute;
    left: var(--float-inset);
    top: var(--float-inset);
    bottom: calc(var(--bar-h) + var(--float-inset));
    width: var(--sidebar-w);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 26px;
    padding: 26px 18px;
    /* Floating capsule: the glass class carries the fill, blur, rim and bloom, so nothing is drawn
       locally except the shape. The reference detaches every pane from every edge. */
    border-radius: var(--radius-float);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 0 10px;
  }

  .word {
    /* A Didone's appeal is its thick/thin contrast, and that contrast only survives if the weight is
       pushed — Bodoni Moda is variable over 400-900, so 700 is a real weight and no optical stroke is
       needed. Sized above the original 1.18x because it was called too small. */
    font-family: var(--font-brand);
    font-size: calc(var(--fs-lg) * 1.58);
    font-weight: 700;
    letter-spacing: 0.9px;
    line-height: 1.3;
    /*
       The lockup borrows a whisper of the current cover's accent, so the brand mark sits inside the
       artwork rather than being pasted over it. Mixed 26% into white rather than used directly: the
       accent is per-cover and can land dark, muddy or nearly grey, and a wordmark must not be allowed
       to go unreadable just because the sleeve is. The glow is the same hue at low alpha.
    */
    color: color-mix(in oklab, var(--accent-text) 26%, #fff);
    text-shadow:
      0 0 18px rgb(var(--accent-rgb) / 0.28),
      0 1px 2px rgba(0, 0, 0, 0.45);
    transition: color 500ms var(--ease-out);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 11px 12px 11px 20px;
    border-radius: 11px;
    border: none;
    color: var(--text-faint);
    font-size: var(--fs-md);
    font-weight: 500;
    text-align: left;
    transition:
      color 180ms var(--ease-out),
      background-color 180ms var(--ease-out),
      border-color 180ms var(--ease-out);
  }

  .nav:hover {
    color: var(--text);
  }

  /* The reference nav signals the selected tab with ink brightness alone — Home is white, Library
     is grey, and there is no plate, ring or pill behind either. That also fixes a real defect: the
     old active row painted accent text on an accent-tinted plate, which measured 1.25:1 contrast.
     The dot is what keeps the state from being colour-only. */
  .nav.active {
    color: var(--text);
    font-weight: 650;
  }

  .nav.active::before {
    content: "";
    position: absolute;
    left: 3px;
    top: 50%;
    width: 5px;
    height: 5px;
    margin-top: -2.5px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 12px -1px rgb(var(--accent-rgb) / 0.85);
    transition:
      background-color 500ms var(--ease-out),
      box-shadow 500ms var(--ease-out);
  }
</style>
