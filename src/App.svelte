<script lang="ts">
  import { player } from "./stores/player.svelte";
  import { ui } from "./stores/ui.svelte";
  import { library } from "./stores/library.svelte";
  import { getAccent, prefetchAccent } from "./services/artwork/palette";
  import { engine } from "./services/audio/engine";
  import { registerPlaybackShortcuts } from "./services/audio/shortcuts";
  import { startMainBridge } from "./services/windowBridge";
  import {
    registerMediaSession,
    syncMediaMetadata,
    syncMediaPlaybackState,
  } from "./services/mediaSession";
  import {
    startTaskbarBridge,
    syncTaskbarFavorite,
    syncTaskbarPlaying,
    syncWindowTitle,
  } from "./services/taskbar";
  import { favorites } from "./stores/favorites.svelte";
  import { lyricsStore } from "./stores/lyrics.svelte";
  import { lyricsQuery } from "./services/lyrics/lyrics";
  import { settings } from "./stores/settings.svelte";
  import { pickRandom } from "./utils/shuffle";
  import BlurredBackground from "./components/BlurredBackground.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import MiniPlayer from "./components/MiniPlayer.svelte";
  import NowPlaying from "./views/NowPlaying.svelte";
  import Lyrics from "./views/Lyrics.svelte";
  import Home from "./views/Home.svelte";
  import Library from "./views/Library.svelte";
  import Playlists from "./views/Playlists.svelte";
  import Favorites from "./views/Favorites.svelte";
  import Settings from "./views/Settings.svelte";
  import AlbumPage from "./views/AlbumPage.svelte";
  import ArtistPage from "./views/ArtistPage.svelte";
  import PlaylistPage from "./views/PlaylistPage.svelte";
  import QueuePanel from "./components/QueuePanel.svelte";
  import ContextMenu from "./components/ContextMenu.svelte";
  import Dialog from "./components/Dialog.svelte";
  import Notice from "./components/Notice.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import { startSleepTimer } from "./services/sleepMenu";
  import { startDragDrop } from "./services/dragDrop";
  import Stats from "./views/Stats.svelte";

  // Publish the active track's extracted accent as a CSS variable. Consumers transition their own
  // colour, so changing the variable interpolates the whole UI's accent over ~500ms instead of
  // hard-cutting. Extraction is cached per artwork URL, so this is free after the first look.
  $effect(() => {
    const artwork = player.current?.artwork;
    const id = player.current?.id;
    if (!artwork) return;
    let stale = false;
    void getAccent(artwork).then((rgb) => {
      if (!stale) document.documentElement.style.setProperty("--accent-rgb", rgb);
    });
    // Warm the next track's palette while this one plays.
    prefetchAccent(player.tracks[(player.index + 1) % player.tracks.length]?.artwork);
    return () => {
      stale = true;
    };
  });

  $effect(() => registerPlaybackShortcuts());

  // Pay the one-time audio output initialisation cost during launch rather than on first play.
  // No delay: the cost is ~6.8s and every millisecond of head start is one less the user might
  // otherwise spend watching a buffering indicator. A real play cancels it (see engine.cancelWarmUp).
  $effect(() => {
    void engine.warmUpOutput();
  });

  // Gapless and crossfade are chosen in Settings but executed by the engine, so the two are kept in
  // step here. `syncHandoffSettings` reads both settings itself, which is what subscribes this effect
  // to them; it cancels an armed handoff first, because a standby decoded under the old values is the
  // wrong standby.
  $effect(() => player.syncHandoffSettings());

  // Load the previously scanned library so relaunching does not start from empty.
  $effect(() => void library.restore());

  // A library saved before the wider tag set has blank year/genre/album-artist forever, so rebuild
  // it once rather than shipping metadata columns that never fill in.
  $effect(() => {
    if (library.loaded && library.stale) void library.rebuildAll();
  });

  /*
     Reopen on the track that was armed last session, at the point it was left.

     Deliberately *armed, not playing*: `player.select` routes through `moveTo`, which starts a track
     only if something was already playing. So this lands on the last song with the transport showing
     play, and the spacebar does exactly what it looks like it will.

     `restored` gates the writer below, and the ordering is the whole point. Both effects read the same
     reactive state, and without the gate the writer would run first on a cold start — where `index`
     defaults to 0 — and overwrite the remembered track with the first of the library before the reader
     ever got to it.
  */
  let restored = $state(false);

  $effect(() => {
    if (restored || !library.loaded) return;
    restored = true;
    const id = settings.value.lastTrackId;

    if (settings.value.onLaunch === "shuffle") {
      /*
         Start somewhere new.

         The track that would otherwise have been resumed is excluded from the pool on purpose: with it
         left in, a shuffle lands on the same song a meaningful share of the time and reads as a resume
         that failed rather than a choice that was made. If the remembered track was the only one in the
         library, the pool is empty and the library itself is used, because there is nowhere else to go.
         Armed rather than playing, exactly like resume — `select` only starts a track if something was
         already playing.
      */
      const rest = player.tracks.filter((t) => t.id !== id);
      const pick = pickRandom(rest.length ? rest : player.tracks);
      if (pick) player.select(pick.id);
      return;
    }

    // A track that has been moved, renamed or deleted just fails this lookup and the session starts
    // clean, which is why the id is stored rather than a path.
    if (!id || !player.tracks.some((t) => t.id === id)) return;
    player.select(id);
    // The offset is applied by the store once the media reports a length — see `armResume`.
    player.armResume(settings.value.lastPosition);
  });

  // Remember where the session is. Guarded on there being a current track: an empty library
  // mid-startup must not wipe the memory before it has been read.
  $effect(() => {
    if (!restored) return;
    const id = player.current?.id;
    if (id) settings.set("lastTrackId", id);
    /*
       Throttled by value rather than by a timer. `position` updates about fifteen times a second and
       every `settings.set` re-serialises and writes the whole object, so the write only happens once the
       live position has moved two seconds away from what is already stored. That needs no clock and no
       cleanup, and it stops writing on its own the moment playback pauses.

       Also held off while a resume is still pending: the position is legitimately sitting at the saved
       offset waiting for the media to load, and writing during that window can race the seek.
    */
    if (player.resuming) return;
    const pos = Math.floor(player.position);
    if (Math.abs(pos - Math.floor(settings.value.lastPosition)) >= 2) settings.set("lastPosition", pos);
  });

  // Auto-scan runs once the library has loaded, and follows the setting live.
  $effect(() => {
    if (!library.loaded || !settings.value.autoScan) return;
    return library.startAutoScan(() => 600_000);
  });

  // Push the persisted visual settings onto the root element before anything paints.
  $effect(() => settings.apply());

  // Keep the floating mini-player card in sync with playback.
  $effect(() => startMainBridge());

  // Fetch lyrics as soon as the track changes, from here rather than from the lyrics view. The card
  // and the Now Playing panel both need them, and if the request only started when the fullscreen
  // view mounted, an empty store was all the card would ever see. Fire-and-forget: playback never
  // waits on this.
  let lyricsForTrack = "";
  $effect(() => {
    const id = player.current?.id;
    if (!id || id === lyricsForTrack) return;
    lyricsForTrack = id;
    void lyricsStore.load(lyricsQuery(player.current));
  });

  // Windows system media controls (SMTC).
  $effect(() => registerMediaSession());
  $effect(() => {
    void player.current.id;
    syncMediaMetadata();
  });
  $effect(() => {
    void player.isPlaying;
    syncMediaPlaybackState();
  });

  // Native taskbar thumbnail buttons. Same state, different control surface.
  $effect(() => void startTaskbarBridge());  $effect(() => syncTaskbarPlaying(player.isPlaying));
  $effect(() => {
    const id = player.current?.id;
    syncTaskbarFavorite(id ? favorites.has(id) : false);
  });
  // "Track - Artist" in the shell's own labels. Reads the same two fields, so it lives with them.
  $effect(() => {
    void player.current?.id;
    syncWindowTitle();
  });

  // Ctrl+K palette. Bound here rather than in the shortcuts service because it needs component state.
  let palette = $state(false);
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        palette = !palette;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  $effect(() => startSleepTimer());

  // Dropping files onto the window adds and plays them. The registration is async, so the teardown
  // is captured rather than returned — an effect may not return a promise.
  $effect(() => {
    let dispose: (() => void) | null = null;
    void startDragDrop().then((d) => (dispose = d));
    return () => dispose?.();
  });
</script>

<div class="shell">
  <BlurredBackground src={player.current.artwork} />

  {#if ui.view !== "lyrics"}
    <div class="frame">
      <Sidebar />
      <main class="content">
        {#if ui.view === "nowplaying"}
          <NowPlaying />
        {:else if ui.view === "library"}
          <Library />
        {:else if ui.view === "playlists"}
          <Playlists />
        {:else if ui.view === "favorites"}
          <Favorites />
        {:else if ui.view === "settings"}
          <Settings />
        {:else if ui.view === "stats"}
          <Stats />
        {:else if ui.view === "album"}
          <AlbumPage key={ui.param} />
        {:else if ui.view === "artist"}
          <ArtistPage name={ui.param} />
        {:else if ui.view === "playlist"}
          <PlaylistPage id={ui.param} />
        {:else}
          <Home />
        {/if}

        {#if ui.queueOpen}
          <QueuePanel />
        {/if}
      </main>
    </div>

    <MiniPlayer />
  {:else}
    <!-- Full-bleed lyrics replaces the whole shell, as in the reference. Leaving the frame mounted
         underneath would show the library straight through it. -->
    <Lyrics />
  {/if}

  <ContextMenu />
  <Dialog />
  <Notice />
  <CommandPalette open={palette} onclose={() => (palette = false)} />
</div>

<style>
  .shell {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    isolation: isolate;
  }

  /* The frame no longer partitions the window. Both glass panes float against it and the content
     fills it, so the rail and the bar have something to refract at their edges — see the note on
     floating panes in app.css. */
  .frame {
    position: absolute;
    inset: 0;
  }

  .content {
    position: absolute;
    inset: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
