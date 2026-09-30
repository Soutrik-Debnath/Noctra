import { mount } from "svelte";
import "./app.css";
import "./controls.css";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

// Dev-only handle for inspecting live state from the console, the Tauri webview inspector, or a
// CDP client. Stripped from production builds by the DEV guard.
if (import.meta.env.DEV) {
  const { player } = await import("./stores/player.svelte");
  const { ui } = await import("./stores/ui.svelte");
  const { engine } = await import("./services/audio/engine");
  const { library } = await import("./stores/library.svelte");
  const { favorites } = await import("./stores/favorites.svelte");
  const { blocked } = await import("./stores/blocked.svelte");
  const { bookmarks } = await import("./stores/bookmarks.svelte");
  const { notice } = await import("./stores/notice.svelte");
  const { settings } = await import("./stores/settings.svelte");
  const { lyricsStore } = await import("./stores/lyrics.svelte");
  const { history } = await import("./stores/history.svelte");
  (window as unknown as Record<string, unknown>).__noctra = {
    player,
    ui,
    engine,
    library,
    favorites,
    blocked,
    bookmarks,
    notice,
    settings,
    lyricsStore,
    history,
  };
}

export default app;
