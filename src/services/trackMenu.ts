/**
 * Builds the right-click menu for a track.
 *
 * One factory rather than a menu written into each list: Library, Favorites, Home, the queue,
 * playlist pages and the album/artist drill-downs all need the same nine actions, and six copies
 * drift apart within a feature or two.
 */
import { favorites } from "../stores/favorites.svelte";
import { blocked } from "../stores/blocked.svelte";
import { bookmarks } from "../stores/bookmarks.svelte";
import { menu, type MenuItem } from "../stores/menu.svelte";
import { dialog } from "../stores/dialog.svelte";
import { notice } from "../stores/notice.svelte";
import { playlists } from "../stores/playlists.svelte";
import { player } from "../stores/player.svelte";
import { lyricsStore } from "../stores/lyrics.svelte";
import { ui } from "../stores/ui.svelte";
import type { Track } from "../data/track";
import { albumCredit, leadArtist } from "../data/track";
import { formatTime } from "../utils/format";
import { deleteCache, lyricsQuery } from "./lyrics/lyrics";
import { revealInExplorer } from "./shell";

export function trackMenu(track: Track, opts: { inQueueIndex?: number } = {}): MenuItem[] {
  const liked = favorites.has(track.id);
  const items: MenuItem[] = [
    { label: "Play now", icon: "play", onSelect: () => void player.playFrom(track.id) },
    { label: "Play next", icon: "list-plus", onSelect: () => player.enqueue(track.id, true) },
    { label: "Add to queue", icon: "queue", onSelect: () => player.enqueue(track.id) },
    { separator: true },
    {
      label: liked ? "Remove from favourites" : "Add to favourites",
      icon: liked ? "heart-filled" : "heart",
      onSelect: () => favorites.toggle(track.id),
    },
    {
      label: blocked.trackIds.has(track.id) ? "Allow this song again" : "Never play this song",
      icon: "block",
      onSelect: () => blocked.toggleTrack(track.id),
    },
    {
      label: blockArtistLabel(track),
      icon: "block",
      disabled: !track.artist,
      onSelect: () => blocked.toggleArtist(track.artist),
    },
    {
      label: "Go to album",
      icon: "disc",
      disabled: !track.album,
      onSelect: () => ui.openAlbum(albumKey(track)),
    },
    {
      label: "Go to artist",
      icon: "mic",
      disabled: !track.artist,
      onSelect: () => ui.openArtist(leadArtist(track.artist)),
    },
    { separator: true },
    { label: "Add to playlist…", icon: "plus", onSelect: () => openPlaylistPicker(track.id) },
    {
      label: "Show in File Explorer",
      icon: "folder",
      onSelect: () => void revealInExplorer(track.source),
    },
    ...(track.id === player.current.id ? bookmarkItems(track) : []),
    {
      label: "Delete cached lyrics",
      icon: "trash",
      danger: true,
      onSelect: () => {
        void deleteCache(lyricsQuery(track)).then((outcome) => {
          const isCurrent = track.id === player.current.id;
          if (outcome === "deleted") {
            // Only reset the live view if we just deleted what it is showing, otherwise the current
            // song's words would vanish for an unrelated track.
            if (isCurrent) lyricsStore.report("Saved lyrics removed. Find lyrics to fetch a new set.");
            else notice.say(`Removed the saved lyrics for ${track.title}.`);
            return;
          }
          if (outcome === "notCached") {
            // Nothing to remove is a real answer, not a failure — but it is only worth saying because
            // the old code said "deleted" here. See BUG-050.
            if (isCurrent) {
              lyricsStore.report("Nothing was saved for this track. What is on screen came from a local file or from this session.");
            } else {
              notice.say(`No saved lyrics existed for ${track.title}.`);
            }
            return;
          }
          notice.say(`Could not delete the saved lyrics for ${track.title}.`, "bad");
        });
      },
    },
  ];

  if (opts.inQueueIndex !== undefined) {
    const at = opts.inQueueIndex;
    items.splice(3, 0, {
      label: "Remove from queue",
      icon: "close",
      onSelect: () => player.removeAt(at),
    });
  }

  return items;
}

/**
 * Albums are keyed by album + album artist, not album + track artist. A various-artists soundtrack
 * grouped per track artist fragments into one "album" per song, which is the bug the album-artist
 * field exists to fix.
 */
export function albumKey(track: Track): string {
  return `${track.album}|||${albumCredit(track)}`;
}

/** Names the artist it is about to block, so the click is not a guess at what "never again" covers. */
function blockArtistLabel(track: Track): string {
  const name = leadArtist(track.artist) || "this artist";
  return blocked.artistBlocked(track.artist) ? `Allow ${name} again` : `Never play ${name} again`;
}

/** Prompt for a label and file the mark. Shared with the `B` shortcut so both behave identically. */
export async function addBookmark(track: Track, at: number): Promise<void> {
  const label = await dialog.ask(`Moment at ${formatTime(at)}`, {
    inputLabel: "Label (optional)",
    allowEmpty: true,
    confirmText: "Save",
  });
  // null means cancelled, which must not silently file an unlabelled mark.
  if (label === null) return;
  bookmarks.add(track.id, at, label);
}

/**
 * The saved-moment entries, offered only for the track that is actually playing.
 *
 * Jumping to a mark in *another* song means starting it and then seeking once it has loaded, which
 * needs a load-completion hook a context menu has no business owning. For the current track a seek
 * is immediate and exact, so that is where the feature lives.
 */
function bookmarkItems(track: Track): MenuItem[] {
  const list = bookmarks.for(track.id);
  const shown = list.slice(0, 8);
  const items: MenuItem[] = [
    { separator: true },
    {
      label: `Bookmark ${formatTime(player.position)}…`,
      icon: "bookmark",
      onSelect: () => addBookmark(track, player.position),
    },
  ];

  for (const b of shown) {
    items.push({
      label: `${formatTime(b.at)} · ${b.label || "saved moment"}`,
      icon: "bookmark",
      onSelect: () => player.seek(b.at),
    });
  }

  if (list.length > shown.length) {
    items.push({
      label: `${list.length - shown.length} more not listed`,
      icon: "bookmark",
      disabled: true,
      onSelect: () => {},
    });
  }

  if (list.length > 0) {
    items.push({
      label: "Clear every mark in this song",
      icon: "trash",
      danger: true,
      onSelect: () => bookmarks.clear(track.id),
    });
  }

  return items;
}

/**
 * A submenu is not modelled, so the picker is a short menu of the playlists themselves.
 *
 * Returns false because `menu.run` closes the menu unless a handler returns exactly false, and this
 * handler has already called `menu.show` itself to swap in the picker. Without it the picker is opened
 * and then hidden in the same tick, so "Add to playlist…" does nothing visible at all.
 */
function openPlaylistPicker(trackId: string): false {
  const existing = playlists.lists;
  const items: MenuItem[] = existing.map((p) => ({
    label: p.name,
    icon: "playlists" as const,
    onSelect: () => playlists.add(p.id, trackId),
  }));
  items.push(
    ...(existing.length > 0 ? [{ separator: true } as MenuItem] : []),
    {
      label: "New playlist…",
      icon: "plus" as const,
      onSelect: async () => {
        const name = await dialog.ask("New playlist", {
          inputLabel: "Playlist name",
          confirmText: "Create",
        });
        if (name === null) return;
        const created = playlists.create(name, [trackId]);
        ui.openPlaylist(created.id);
      },
    },
  );
  // Re-anchor at the same spot the caller's menu opened at.
  menu.show(lastEvent(), items);
  return false;
}

/**
 * The picker needs a pointer position to open at, but it is invoked from inside a menu item whose
 * originating event is long gone. The last observed pointer position is good enough and avoids
 * threading the event through every caller.
 */
let lastXY = { x: 0, y: 0 };
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastXY = { x: e.clientX, y: e.clientY };
    },
    true,
  );
}

function lastEvent(): MouseEvent {
  return { clientX: lastXY.x, clientY: lastXY.y } as MouseEvent;
}
