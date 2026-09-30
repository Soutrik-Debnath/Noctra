#!/usr/bin/env node
/**
 * `npm run tauri <args>`, except that `dev` gets a Chrome remote-debugging port and `build` never does.
 *
 * The port is what `scripts/cdp-eval.mjs` and the probe harness attach to, so development needs it. A
 * published installer must not carry it: it lets any local process open a debugging session against the
 * app and drive it. So `tauri.conf.json` ships clean and this adds the flag back for `dev` only.
 *
 * The overlay is a *complete* generated config rather than a partial patch. Tauri's documented merge
 * behaviour for arrays is not specified, so a partial `app.windows` patch could either replace the array
 * and drop the other window's properties, or merge by index and land on the wrong window. Regenerating
 * the whole file from the base gives the same result under either semantic.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tauriDir = join(root, "src-tauri");
const args = process.argv.slice(2);

if (args[0] === "dev") {
  const base = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
  for (const win of base.app.windows) {
    win.additionalBrowserArgs += " --remote-debugging-port=9223";
  }
  const overlay = join(tauriDir, "tauri.dev.json");
  writeFileSync(overlay, JSON.stringify(base, null, 2) + "\n");
  args.push("--config", overlay);
}

const child = spawn(
  process.execPath,
  [join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"), ...args],
  { cwd: root, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
