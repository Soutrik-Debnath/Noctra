import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// Vite options tailored for Tauri development:
// 1. clearScreen keeps Rust compiler errors visible
// 2. strictPort because Tauri expects the dev server at a fixed address
// 3. src-tauri is ignored so Rust edits don't trigger a frontend reload
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  build: {
    // The rolldown-era default CSS minifier silently deletes `backdrop-filter` and the standalone
    // `translate` property from the output. Measured in the shipped app: the parsed `.glass` rule
    // contained background-color and box-shadow but no backdrop-filter, and `.bigheart` had
    // `left:50%;top:50%` with its `translate:-50% -50%` gone — which is the Now Playing bar arriving
    // with no glass at all and the fullscreen heart sitting half its own width down and to the right.
    // Both properties are present in dev, so every symptom of this only appears in a release build.
    cssMinify: false,
    // Two entries: the app window and the floating mini-player card. A separate HTML file is used
    // instead of a query flag because Tauri percent-encodes `?x=1` into the requested path, which
    // then 404s and leaves a blank window.
    rollupOptions: {
      input: {
        main: "index.html",
        mini: "mini.html",
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
