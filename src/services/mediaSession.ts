/**
 * Windows system media controls (SMTC) via the W3C Media Session API.
 *
 * Chromium implements Media Session on top of Windows' System Media Transport Controls, so
 * populating it makes Noctra show up in the Windows media flyout, Win+G and the lock screen with
 * artwork, track metadata, playback state and prev/play/next — and those buttons drive the real
 * player because they call into the same store.
 *
 * This is the honest answer to "taskbar media controls" on Windows 11. The hover-thumbnail toolbar
 * with buttons (`ITaskbarList3::ThumbbarAddButton`) is a Windows 7/10 API that Windows 11 does not
 * render, and the spec forbids faking it with a hand-built window.
 *
 * One deliberate omission: the ♡ "favorite" button in the reference mock-up. `favorite` is not a
 * Media Session action Chromium supports — `setActionHandler("favorite", …)` throws
 * NotSupportedError and Windows shows no such button. Rather than fake it, the like control lives
 * in the app itself (Phase 5).
 */
import { player } from "../stores/player.svelte";

function setMetadata() {
  const track = player.current;
  const art = track.artwork;
  const ms = navigator.mediaSession;
  ms.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    // Same-origin path now; Phase 3 swaps this for the per-file asset URL.
    artwork: [{ src: art, sizes: "512x512", type: "image/jpeg" }],
  });
}

function setPosition() {
  const ms = navigator.mediaSession;
  if (!("setPositionState" in ms) || player.duration <= 0) return;
  try {
    ms.setPositionState({
      duration: player.duration,
      position: player.position,
      playbackRate: 1,
    });
  } catch {
    /* Called before the element has a real duration — the next tick will succeed. */
  }
}

/** Register SMTC handlers and keep them in sync. Returns a teardown function. */
export function registerMediaSession(): () => void {
  const ms = navigator.mediaSession;
  if (!ms) return () => {};

  const handlers: Array<[MediaSessionAction, (details?: MediaSessionActionDetails) => void]> = [
    ["play", () => void player.play()],
    ["pause", () => player.pause()],
    ["previoustrack", () => void player.previous()],
    ["nexttrack", () => void player.next()],
    ["seekto", (details) => {
      const seek = details?.seekTime;
      if (typeof seek === "number") player.seek(seek);
    }],
  ];

  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* Action unsupported by this WebView2 build; skip it rather than breaking the rest. */
    }
  }

  // Position is pushed on a slow timer — SMTC UI does not need 15Hz and Windows throttles it
  // anyway. Track and play-state changes are handled reactively by the caller's effects.
  const timer = setInterval(setPosition, 1000);

  return () => {
    clearInterval(timer);
    for (const [action] of handlers) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
  };
}

/** Call when the track changes. */
export function syncMediaMetadata(): void {
  if (!navigator.mediaSession) return;
  setMetadata();
  setPosition();
}

/** Call when play state changes. */
export function syncMediaPlaybackState(): void {
  if (!navigator.mediaSession) return;
  navigator.mediaSession.playbackState = player.isPlaying ? "playing" : "paused";
  setPosition();
}
