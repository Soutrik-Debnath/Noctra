/**
 * Custom playlist covers, shared by the Playlists grid and the playlist page header.
 *
 * Two kinds, because those are the two things a person actually wants: a single emoji, which costs
 * nothing to store, or a picture. There is no third kind — a bespoke picker UI would be more chrome
 * than the three menu items it replaces, and the app already drives multi-choice actions this way
 * (see `repeatMenu` and `sleepMenu`).
 *
 * Storage lives in localStorage alongside playlists, favourites and settings, so a picture is
 * downscaled to a 256px square before it is encoded. A raw multi-megabyte data URL per playlist is
 * the fastest way to run the webview out of its quota, and 256px is larger than anything the UI draws.
 */
import { dialog } from "../stores/dialog.svelte";
import { player } from "../stores/player.svelte";
import { playlists, type Playlist } from "../stores/playlists.svelte";
import type { MenuItem } from "../stores/menu.svelte";

const EMOJI = "emoji:";
const SIDE = 256;

export type Cover =
  | { kind: "none" }
  | { kind: "emoji"; value: string }
  | { kind: "image"; value: string };

/**
 * What to draw for a playlist: the owner's choice first, then the first track that has artwork,
 * which is what the grid did before custom covers existed.
 */
export function coverOf(list: Playlist | undefined): Cover {
  if (!list) return { kind: "none" };
  if (list.artwork?.startsWith(EMOJI)) return { kind: "emoji", value: list.artwork.slice(EMOJI.length) };
  if (list.artwork) return { kind: "image", value: list.artwork };
  const auto = list.trackIds
    .map((t) => player.tracks.find((x) => x.id === t)?.artwork ?? "")
    .find(Boolean);
  return auto ? { kind: "image", value: auto } : { kind: "none" };
}

/** Whether the playlist shows something the owner put there, which is what "Remove cover" undoes. */
export function hasCustomCover(list: Playlist | undefined): boolean {
  return !!list?.artwork;
}

/**
 * Decode, centre-crop to a square, resample to 256px and re-encode.
 *
 * The centre crop is deliberate: a landscape cover squeezed into the grid's square frame would be
 * stretched, and `object-fit: cover` only hides that at certain sizes.
 */
export async function downscale(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) return null;
    const canvas = document.createElement("canvas");
    canvas.width = SIDE;
    canvas.height = SIDE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      SIDE,
      SIDE,
    );
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch {
    // An undecodable file is a failed pick, not a crash: the caller reports it.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Open the OS file picker without shipping a form control in every view.
 *
 * The element exists only for the duration of the pick. `cancel` is what modern engines fire when
 * the user backs out; without it the promise would never settle and the caller would hang.
 */
function pickPicture(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    const done = (value: string | null) => {
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      done(file ? await downscale(file) : null);
    });
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * The cover entries for a playlist's options menu.
 *
 * `dialog` is a singleton that cancels whatever is already open, so these handlers must not run
 * concurrently with another prompt — they are only ever reached from a menu item, which closes the
 * menu first.
 */
export function coverMenuItems(id: string): MenuItem[] {
  const list = playlists.byId(id);
  const items: MenuItem[] = [
    {
      label: "Set emoji cover…",
      icon: "sparkle",
      onSelect: async () => {
        const answer = await dialog.ask("Emoji cover", {
          inputLabel: "One emoji",
          placeholder: "🎧",
          confirmText: "Apply",
          detail: "Leave it blank to go back to the album artwork.",
        });
        if (answer === null) return;
        const char = answer.trim();
        playlists.setArtwork(id, char ? `${EMOJI}${char}` : null);
      },
    },
    {
      label: "Choose picture…",
      icon: "disc",
      onSelect: async () => {
        const data = await pickPicture();
        if (data) playlists.setArtwork(id, data);
      },
    },
  ];
  if (hasCustomCover(list)) {
    items.push({ label: "Remove cover", icon: "trash", onSelect: () => playlists.setArtwork(id, null) });
  }
  return items;
}
