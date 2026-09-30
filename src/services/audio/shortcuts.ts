/**
 * Global playback shortcuts: space toggles, arrows seek and adjust volume.
 *
 * The interesting part is what has to be *excluded*. A blanket window listener would fire
 * alongside the control that already owns the key — Space on a focused button would both activate
 * the button and toggle playback, and arrows over the seek bar would double-seek. So the handler
 * yields to any focused element that plausibly wants the key.
 */
import { player } from "../../stores/player.svelte";
import { ui } from "../../stores/ui.svelte";
import { addBookmark } from "../trackMenu";

const SEEK_SMALL = 5;
const SEEK_LARGE = 30;
const VOLUME_STEP = 0.05;

/** Elements that handle their own keyboard input and must not also trigger the global action. */
function targetHandlesItself(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  // Note: a native <button> has an *implicit* role, so [role="button"] alone would miss it and
  // Space would both activate the button and toggle playback.
  return !!el.closest(
    'button, a[href], input, select, textarea, [role="slider"], [role="button"], [contenteditable="true"]',
  );
}

export function registerPlaybackShortcuts(): () => void {
  function onPointerDown(e: PointerEvent) {
    // Mouse side buttons arrive as button 3 (back) and 4 (forward). Chromium would otherwise try to
    // navigate its own history, which in a single-view app means nothing — so they are claimed here
    // for the thing people actually expect them to do.
    if (e.button === 3) {
      e.preventDefault();
      void player.previous();
    } else if (e.button === 4) {
      e.preventDefault();
      void player.next();
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    // Ctrl/Cmd+F is the one combination shortcut, so it is checked before the modifier guard.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      ui.set("library");
      // The view has to mount before its input exists, hence the frame.
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[aria-label="Search library"]')?.focus());
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (targetHandlesItself(e.target ?? e.currentTarget)) return;

    switch (e.key) {
      case " ":
      case "Spacebar":
        e.preventDefault();
        void player.toggle();
        return;
      case "ArrowRight":
        e.preventDefault();
        player.seek(Math.min(player.duration, player.position + (e.shiftKey ? SEEK_LARGE : SEEK_SMALL)));
        return;
      case "ArrowLeft":
        e.preventDefault();
        player.seek(Math.max(0, player.position - (e.shiftKey ? SEEK_LARGE : SEEK_SMALL)));
        return;
      case "ArrowUp":
        e.preventDefault();
        player.setVolume(Math.min(1, player.volume + VOLUME_STEP));
        return;
      case "ArrowDown":
        e.preventDefault();
        player.setVolume(Math.max(0, player.volume - VOLUME_STEP));
        return;
      case "m":
      case "M":
        e.preventDefault();
        player.setMuted(!player.muted);
        return;
      case "s":
      case "S":
        e.preventDefault();
        player.shuffle = !player.shuffle;
        return;
      case "r":
      case "R":
        e.preventDefault();
        player.cycleRepeat();
        return;
      case "l":
      case "L":
        e.preventDefault();
        ui.set(ui.view === "lyrics" ? "nowplaying" : "lyrics");
        return;
      case "b":
      case "B":
        if (!player.current.id) return;
        e.preventDefault();
        addBookmark(player.current, player.position);
        return;
      case "Escape":
        // An open dialog owns Escape. This listener is registered before any dialog mounts, so it
        // fires first on the same target and a dialog cannot cancel it — the check has to live here.
        if (document.querySelector('[role="dialog"]')) return;
        if (ui.view === "lyrics") ui.set("nowplaying");
        return;
      default:
        return;
    }
  }

  window.addEventListener("keydown", onKeyDown);
  // Capture phase, so the side button is claimed before the browser's own history handling sees
  // it. `preventDefault` on a pointerdown is what stops the back-navigation.
  window.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointerdown", onPointerDown, true);
  };
}
