# Noctra 1.0.0

First public release. Noctra is an offline-first music player for Windows — your library never
leaves your machine, there is no account, and nothing phones home.

**Download:** `Noctra_1.0.0_x64-setup.exe` (about 2.1 MB). Run it and you're done — no runtime,
no dependencies, no internet connection required. Windows 10 or 11, 64-bit.

> The installer is unsigned, so SmartScreen will show "Windows protected your PC". Click
> **More info → Run anyway**. Signing costs a certificate, not a code change.

## What it does

- **Library** — scans folders you point it at, reads real tags and embedded cover art, and works
  entirely from local files. FLAC, MP3, M4A, AAC, OGG, WAV and MP4.
- **Lyrics** — word-level timing from LRCLIB, or local `.lrc` sidecar files, or embedded tags.
  Line-by-line reveal, a scrollable reel you can click to seek, and romanisation for Hindi, Bengali
  and Gujarati so you can read along. This is the only feature that touches the network, and only
  when you ask for a song's lyrics.
- **Now Playing** — a fullscreen surface built on the artwork, with a liquid-glass layer that picks
  up the current cover's colour and adapts its ink so text stays readable on any sleeve.
- **Mini-player** — a detached desktop card that grows its artwork on hover and mirrors the
  fullscreen lyrics treatment.
- **Playback** — gapless, and a real two-deck crossfade with a configurable overlap. Shuffle,
  repeat, queue with drag-reorder, sleep timer, "play similar" built from your own listening.
- **Windows integration** — play/pause/previous/next/favourite in the taskbar hover preview, system
  media keys, and the window title as `Track - Artist`.
- Playlists, favourites, statistics, a command palette on `Ctrl+K`, and right-click menus
  throughout.

## Fixed in this release

- The Now Playing bar shipped without its glass blur, and the fullscreen favourite button was
  offset from the artwork. Both were caused by the production build silently dropping
  `backdrop-filter` and `translate` from the CSS — invisible in development, visible only once
  installed.
- Crossfade started and then cancelled itself about a second in, so transitions cut hard instead of
  overlapping. It now runs the full configured window.
- "Play similar" was truncating its candidate pool to 30 tracks and ignoring featured artist
  credits; it now uses the whole related set.
- The heart glyph in the taskbar preview rendered upside down.
- Seeking the volume slider by clicking, lyric-column scrolling, and several cases where a manual
  scroll or a cached lyric response would wedge the view.

## Verified before publishing

0 type errors and 93/93 unit tests. Zero contrast failures across all six views, measured against
rendered pixels rather than CSS. An interaction pass against the *installed* build — every view,
fullscreen, queue, command palette and transport — with zero console errors or uncaught exceptions.
