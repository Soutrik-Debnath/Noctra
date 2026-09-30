/**
 * Turn an absolute local file path into a URL the webview can load.
 *
 * This targets Noctra's own `noctra-audio://` scheme rather than the stock asset protocol, because
 * the asset protocol cannot repair the FLAC picture-block MIME string that makes Chromium reject
 * those files — see BUG-008 and `src-tauri/src/audio_protocol.rs`. The same handler serves the
 * extracted cover images, so audio and artwork share one path to disk.
 *
 * `convertFileSrc` takes the protocol name and handles the platform-specific shape. Hand-writing
 * `noctra-audio://...` fails silently on Windows, where custom schemes are only reachable through
 * the rewritten `http://<scheme>.localhost/...` form.
 */
import { convertFileSrc } from "@tauri-apps/api/core";

export function localFileUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath, "noctra-audio");
}
