//! Rust commands exposed to the frontend via `invoke`.
//!
//! Remaining work by phase:
//!   TODO Phase 3: scan_folder (recursive, batched in ~50-track chunks), extract_artwork to a
//!                 cache dir keyed by track fingerprint
//!   TODO Phase 4: blur_image (image crate), palette extraction

pub mod scan;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use serde::Serialize;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn app_version() -> String {
    format!("noctra {}", env!("CARGO_PKG_VERSION"))
}

/// Open or close the floating desktop mini-player, returning the new open state.
///
/// Created here rather than from JS so no extra webview-creation capability has to be granted to
/// the main window. It loads `mini.html`, a separate Vite entry — a query flag on index.html does
/// not work because the App URL percent-encodes `?x=1` into the path and then 404s into a blank
/// window.
///
/// `build()` is called directly, on the async command's own thread. It already proxies window
/// creation onto the window thread internally, so wrapping it in `run_on_main_thread` nests one
/// main-thread handoff inside another and returns a `WebviewWindow` whose platform handle does not
/// exist yet — registered, but with no HWND and no initialised webview. That is the
/// "returns Ok, nothing on screen" symptom of BUG-011.
///
/// The window is built once and then only shown or hidden afterwards. Destroying it on close meant
/// every reopen went back through the creation path, and if a build ever left a half-live window
/// registered the command would find it, "close" it, and report false forever with nothing on
/// screen.
/// The window itself is declared in `tauri.conf.json` and starts hidden. It is deliberately not
/// built from here: on Windows a runtime-built webview ends up with a WebView2 environment whose
/// browser args differ from the main window's, which leaves a registered label with no platform
/// handle and no painted page — the "returns Ok, nothing on screen" symptom of BUG-011.
#[tauri::command]
pub async fn toggle_mini(app: AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("mini")
        .ok_or("mini window no longer exists at runtime")?;
    if window.is_visible().unwrap_or(false) {
        window.hide().map(|_| false).map_err(|e| e.to_string())
    } else {
        window
            .show()
            .and_then(|_| window.set_focus())
            .map(|_| true)
            .map_err(|e| e.to_string())
    }
}

/// Whether the mini window is actually on screen.
///
/// `toggle_mini` already asks the window rather than trusting a flag, but `ui.miniOpen` on the
/// frontend is a *mirror* of that state, and reloading the main window resets the mirror to false
/// while a visible card stays on screen. The bridge is gated on the mirror, so it would quietly stop
/// feeding a card that is still showing. This lets the mirror be re-derived from reality on startup.
#[tauri::command]
pub fn mini_visible(app: AppHandle) -> bool {
    app.get_webview_window("mini")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Hide the floating mini-player.
///
/// Explicit rather than reusing `toggle_mini`: a toggle whose outcome depends on which way the window
/// happens to be is exactly the guess that left the card stuck on screen with the bridge stopped.
#[tauri::command]
pub fn hide_mini(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("mini")
        .ok_or("mini window no longer exists at runtime")?
        .hide()
        .map_err(|e| e.to_string())
}

/// Reflect the playback state in the taskbar thumbnail's play/pause glyph.
///
/// `async` because the toolbar lives on the window thread: a synchronous command already runs on
/// that thread, so `run_on_main_thread` from one queues work onto the loop it is itself blocking.
#[tauri::command]
pub async fn taskbar_set_playing(app: AppHandle, playing: bool) {
    #[cfg(windows)]
    let _ = app.run_on_main_thread(move || crate::taskbar::set_playing(playing));
    #[cfg(not(windows))]
    let _ = (app, playing);
}

/// Reflect the current track's favourite state in the thumbnail's heart glyph.
#[tauri::command]
pub async fn taskbar_set_favorite(app: AppHandle, favorite: bool) {
    #[cfg(windows)]
    let _ = app.run_on_main_thread(move || crate::taskbar::set_favorite(favorite));
    #[cfg(not(windows))]
    let _ = (app, favorite);
}

/// Cache one track's lyrics as a plain file under the app config directory.
///
/// On disk rather than in `localStorage`: a library of thousands of tracks at a few KB of text
/// each runs past the webview's storage quota, and a file the user can inspect and delete is the
/// more honest place to keep something described as a cache.
#[tauri::command]
pub fn save_lyrics(app: AppHandle, fingerprint: String, text: String) -> Result<(), String> {
    let path = lyrics_path(&app, &fingerprint)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

/// Read a cached lyrics file. `None` just means it has never been fetched.
#[tauri::command]
pub fn load_lyrics(app: AppHandle, fingerprint: String) -> Result<Option<String>, String> {
    let path = lyrics_path(&app, &fingerprint)?;
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

/// Drop a cached lyrics file, reporting whether one was actually there.
///
/// A missing file used to be folded into `Ok(())`, which made the caller's boolean mean "no error"
/// while reading as "deleted something" — so a cache key that never matched the file written at save
/// time produced a success message for a no-op. Reported separately now. See BUG-050.
///
/// Only ever touches the file Noctra wrote into its own cache directory. Lyrics embedded in the
/// user's audio file are left completely alone; that would be modifying their music.
#[tauri::command]
pub fn delete_lyrics(app: AppHandle, fingerprint: String) -> Result<String, String> {
    let path = lyrics_path(&app, &fingerprint)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok("deleted".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok("notCached".into()),
        Err(e) => Err(e.to_string()),
    }
}

/// Sidecar extensions Noctra looks for, in priority order. LRC first: it is what people actually put
/// next to a track, and TTML files are rare enough that they must not shadow a real `.lrc`.
const SIDECAR_EXTS: [&str; 3] = ["lrc", "ttml", "tt"];

/// Read a lyrics sidecar sitting next to a track (`.lrc`, or TTML).
///
/// Together with the embedded tag this is the route by which real per-word timings reach the player from
/// something the user controls. LRCLIB does carry word data in its `lyricsfile` field, but coverage is
/// thin — measured at 3 of 760 sampled records — so local files remain the main source of the feature.
///
/// Read-only by construction. The path is rebuilt from the audio file's own parent directory and file
/// stem with a forced extension, so a caller cannot steer it at an arbitrary file, and a relative path is
/// refused outright rather than resolved against the process working directory.
#[tauri::command]
pub fn read_sidecar_lyrics(path: String) -> Option<String> {
    let audio = std::path::Path::new(&path);
    if !audio.is_absolute() {
        return None;
    }
    let dir = audio.parent()?;
    let stem = audio.file_stem()?;

    for ext in SIDECAR_EXTS {
        // The sidecar name is built as a string rather than with `with_extension`, which keys off the
        // last dot in the file name — on a track called "04. Tame Impala - Loser.flac" it would produce
        // "04.lrc" and silently miss the file.
        let name = format!("{}.{}", stem.to_string_lossy(), ext);
        let direct = dir.join(&name);
        let found = match direct.exists() {
            true => Some(direct),
            false => find_sidecar(dir, &stem.to_string_lossy(), ext),
        };
        // A file that exists but cannot be read still counts as "this track's sidecar was found", so the
        // search moves to the next format rather than falling through to a looser match.
        if let Some(file) = found {
            return read_text_file(&file);
        }
    }
    None
}

/// Case-insensitive sidecar match, for stems that only disagree on case — which is exactly when a
/// sidecar is most likely to have been hand-placed on a library assembled on more than one platform.
fn find_sidecar(dir: &std::path::Path, stem: &str, ext: &str) -> Option<std::path::PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            let same_ext = p
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case(ext));
            let same_stem = p
                .file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.eq_ignore_ascii_case(stem));
            same_ext && same_stem
        })
}

fn read_text_file(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    // Sidecars are written by tools with inconsistent opinions about encoding and BOMs. Lossy beats
    // failing: a few mojibake characters in one line is still readable, whereas an error throws the
    // whole file away and sends the lookup to the network.
    Some(
        String::from_utf8_lossy(&bytes)
            .trim_start_matches('\u{feff}')
            .to_string(),
    )
}

/// Read lyrics stored in the audio file's own tags.
///
/// This covers what taggers actually write: Vorbis `LYRICS`, MP4 `(c)lyr`, APE `Lyrics` and ID3v2 `USLT`,
/// any of which may hold plain text, line-stamped LRC, or enhanced per-word LRC. The frontend sniffs and
/// decides the sync level, so nothing here claims timing the tag does not have.
///
/// Strictly read-only. Noctra never writes tags: modifying the user's music files to store a lyrics cache
/// would be a far larger and more dangerous operation than writing one file under the app's own config
/// directory, which is where the cache lives.
///
/// One known limit, stated rather than worked around: ID3v2 `SYLT` (the synchronised-lyrics frame, which
/// does carry per-word timing) is unreachable through lofty 0.25's generic `Tag` — it surfaces as a raw
/// binary frame and unmapped frames are dropped on conversion, so reading it would mean writing an ID3v2
/// parser. `SYLT` is almost never produced by taggers, so the honest outcome is that those files fall back
/// to `USLT` or to the next source rather than that support pretends to exist.
#[tauri::command]
pub fn read_embedded_lyrics(path: String) -> Option<String> {
    let audio = std::path::Path::new(&path);
    if !audio.is_absolute() {
        return None;
    }
    let tagged = Probe::open(audio).ok()?.read().ok()?;

    for tag in tagged.tags() {
        // `Lyrics` first: on Vorbis and MP4 that is the key a synchronized (LRC-stamped) value is stored
        // under. `UnsyncLyrics` is the guaranteed-unsynchronised one, so it is only ever a static result.
        for key in [ItemKey::Lyrics, ItemKey::UnsyncLyrics] {
            if let Some(text) = tag.get_string(key) {
                let text = text.trim();
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
    }
    None
}

/// Open File Explorer with the given file selected.
///
/// `explorer.exe` exits non-zero even when it succeeds, so the status code is deliberately ignored
/// and only a failure to launch is reported. The path is passed as a single argument rather than
/// through a shell, so a filename containing spaces or quotes cannot break out into extra arguments.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = std::path::Path::new(&path);
    if !target.is_absolute() {
        return Err("refused a relative path".into());
    }
    if !target.exists() {
        return Err("that file is no longer on disk".into());
    }
    #[cfg(windows)]
    let spawned = std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .spawn();
    #[cfg(not(windows))]
    let spawned = Err(std::io::Error::other("not supported on this platform"));

    spawned.map(|_| ()).map_err(|e| e.to_string())
}

/// Open a link in the user's default browser.
///
/// `ShellExecuteW` rather than `cmd /c start`: the URL arrives as one wide string, so it can never
/// be re-split into extra arguments or read for shell metacharacters. `https` only, because the
/// same API handed a `file://` or UNC path launches Explorer or runs a program instead of showing a
/// page. No new crate or feature: `Win32_UI_Shell` is already on for the taskbar buttons.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.len() > 512 {
        return Err("only https links can be opened".into());
    }
    if url.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("refused a malformed link".into());
    }

    #[cfg(windows)]
    let opened = {
        use windows::core::{w, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        // ShellExecuteW wants null-terminated UTF-16; the trailing zero is the terminator.
        let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                w!("open"),
                PCWSTR(wide.as_ptr()),
                PCWSTR(std::ptr::null()),
                PCWSTR(std::ptr::null()),
                SW_SHOWNORMAL,
            )
        };
        // ShellExecute reports success as a handle-valued number above 32, and failure as a small
        // error code in the same slot.
        (result.0 as isize) > 32
    };
    #[cfg(not(windows))]
    let opened = false;

    if opened {
        Ok(())
    } else {
        Err("the system refused to open the link".into())
    }
}

/// Resolve a fingerprint to a cache file.
///
/// The fingerprint arrives from the webview, so it is treated as untrusted input: anything outside
/// a plain identifier set is refused rather than sanitised, because a sanitiser is one bug away
/// from a path traversal that writes outside the cache directory.
fn lyrics_path(app: &AppHandle, fingerprint: &str) -> Result<std::path::PathBuf, String> {
    if fingerprint.is_empty()
        || fingerprint.len() > 64
        || !fingerprint
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("rejected lyrics cache key".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("lyrics").join(format!("{fingerprint}.lrc")))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInfo {
    pub codec: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u8,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

/// Write a file's embedded picture out to `out_path`, returning true when artwork existed.
///
/// Returns a path rather than the bytes: a 500KB cover serialised through `invoke` as base64 is
/// both slow and memory-wasteful, and the asset protocol can serve the file directly from disk.
/// This is also the shape Phase 3's artwork cache will use.
#[tauri::command]
pub fn extract_artwork(path: String, out_path: String) -> Result<bool, String> {
    use std::io::Write;

    let tagged = Probe::open(&path)
        .map_err(|e| format!("could not open: {e}"))?
        .read()
        .map_err(|e| format!("could not parse: {e}"))?;

    for tag in tagged.tags() {
        for pic in tag.pictures() {
            let mut file = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            file.write_all(pic.data()).map_err(|e| e.to_string())?;
            return Ok(true);
        }
    }
    Ok(false)
}

/// Read tags and stream properties from one audio file with lofty.
///
/// Also serves as the authoritative check on whether a file is a well-formed container: a bad
/// file fails here rather than surfacing as an opaque media error in the webview.
#[tauri::command]
pub fn read_tags(path: String) -> Result<AudioInfo, String> {
    let tagged = Probe::open(&path)
        .map_err(|e| format!("could not open: {e}"))?
        .read()
        .map_err(|e| format!("could not parse: {e}"))?;

    let props = tagged.properties();

    let mut title = None;
    let mut artist = None;
    let mut album = None;
    for tag in tagged.tags() {
        if title.is_none() {
            title = tag.title().map(|s| s.to_string());
        }
        if artist.is_none() {
            artist = tag.artist().map(|s| s.to_string());
        }
        if album.is_none() {
            album = tag.album().map(|s| s.to_string());
        }
    }

    Ok(AudioInfo {
        codec: format!("{:?}", tagged.file_type()),
        duration_ms: props.duration().as_millis() as u64,
        sample_rate: props.sample_rate().unwrap_or(0),
        channels: props.channels().unwrap_or(0),
        title,
        artist,
        album,
    })
}
