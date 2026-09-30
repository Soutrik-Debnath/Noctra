//! Library scanning: walk a folder, read tags and embedded artwork with lofty, and stream the
//! results back to the UI in batches so the window never freezes.
//!
//! Everything here runs on a worker thread. A 300-file library takes a few seconds to read tags
//! for, and doing that on the caller's thread would lock the UI — which the spec forbids outright.

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};

/// Persist the scanned library as JSON in the app config directory.
///
/// Deliberately a plain file behind a narrow interface rather than SQLite: the spec caps the
/// early phases at JSON, and at a few hundred tracks the whole file loads in milliseconds. The
/// frontend only ever talks to these two commands, so swapping in `tauri-plugin-sql` later is a
/// change here and in `services/library`, not across the app.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct LibraryFile {
    pub roots: Vec<String>,
    pub tracks: serde_json::Value,
}

#[tauri::command]
pub fn load_library(app: tauri::AppHandle) -> Result<Option<LibraryFile>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let file = dir.join("library.json");
    if !file.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let parsed = serde_json::from_str(&text).map_err(|e| format!("library.json is corrupt: {e}"))?;
    Ok(Some(parsed))
}

/// Read tags for individually named files, for drag-and-drop onto the window.
///
/// The folder scanner works root-first, but a dropped selection can be any handful of files that
/// are not necessarily under a scanned root. Reusing `read_one` keeps the two paths producing
/// identical records, so a dropped track is indistinguishable from a scanned one downstream.
#[tauri::command]
pub fn scan_paths(paths: Vec<String>, cache_dir: String) -> Vec<ScannedTrack> {
    let cache = PathBuf::from(&cache_dir);
    let _ = fs::create_dir_all(&cache);
    paths
        .iter()
        .map(Path::new)
        .filter(|p| p.is_file() && is_audio(p))
        .filter_map(|p| read_one(p, &cache))
        .collect()
}

#[tauri::command]
pub fn save_library(
    app: tauri::AppHandle,
    roots: Vec<String>,
    tracks: serde_json::Value,
) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let body = serde_json::json!({ "roots": roots, "tracks": tracks });
    // Write to a sibling then rename, so a crash mid-write cannot leave a half-written library
    // that fails to parse on next launch.
    let tmp = dir.join("library.json.tmp");
    fs::write(&tmp, body.to_string()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, dir.join("library.json")).map_err(|e| e.to_string())?;
    Ok(())
}


/// Extensions we attempt to read. Anything else is skipped without logging every miss.
const AUDIO_EXTS: [&str; 8] = ["mp3", "flac", "wav", "m4a", "mp4", "aac", "ogg", "oga"];

/// Tracks per batch sent to the UI. Small enough to feel live, large enough that the IPC overhead
/// stays irrelevant.
const BATCH: usize = 50;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTrack {
    /// Stable identifier: a hash of the absolute path. Doubles as the artwork cache key.
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    /// Album-level credit. Empty when untagged — the UI falls back to the track's lead artist,
    /// which is what keeps a various-artists soundtrack from fragmenting into one album per artist.
    pub album_artist: String,
    pub album: String,
    pub genre: String,
    /// Release year, 0 when untagged.
    pub year: u32,
    pub track_no: u32,
    pub disc_no: u32,
    pub duration: f64,
    /// Filesystem path to the extracted cover image, or None if the file embeds none.
    pub artwork_path: Option<String>,
    pub codec: String,
    /// Bits per second of the audio stream, 0 when the format cannot report it.
    pub bitrate: u32,
    /// Hertz, 0 when unavailable.
    pub sample_rate: u32,
    /// Bits per sample, 0 for lossy formats where the concept does not apply.
    pub bit_depth: u8,
}

/// FNV-1a. Not cryptographic — it just needs to be stable across runs so the artwork cache and
/// "did this track change" checks keep working.
fn path_key(path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in path.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn is_audio(entry: &Path) -> bool {
    entry
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Depth-first walk. Iterative rather than recursive so a deeply nested tree cannot overflow the
/// stack.
fn collect_files(root: &Path, out: &mut Vec<PathBuf>) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            // Unreadable directory (permissions, in-use). Skipping is correct; a single locked
            // folder must not abort a whole-library scan.
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.file_type() else { continue };
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() && is_audio(&path) {
                out.push(path);
            }
        }
    }
}

/// Pull the embedded picture out to `cache_dir/<key>.<ext>` so the webview can load it as a plain
/// file. Returns None when the file carries no artwork.
fn extract_artwork(tagged: &lofty::file::TaggedFile, key: &str, cache_dir: &Path) -> Option<String> {
    for tag in tagged.tags() {
        for pic in tag.pictures() {
            let mime = pic
                .mime_type()
                .map(|m| m.to_string())
                .unwrap_or_else(|| "image/jpeg".into());
            let ext = match mime.as_str() {
                "image/png" => "png",
                "image/gif" => "gif",
                "image/webp" => "webp",
                _ => "jpg",
            };
            let target = cache_dir.join(format!("{key}.{ext}"));
            // Already extracted on a previous scan — don't rewrite 500KB per track every launch.
            if target.exists() {
                return Some(target.to_string_lossy().replace('\\', "/"));
            }
            if let Ok(mut file) = fs::File::create(&target) {
                if file.write_all(pic.data()).is_ok() {
                    return Some(target.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    None
}

/// First four-digit run in a free-form date tag, e.g. "1997-04" or "Copyright 2003".
fn year_from(text: &str) -> Option<u32> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if bytes[i..i + 4].iter().all(|b| b.is_ascii_digit()) {
            // Reject a digit run embedded in a longer number so "19974" does not read as 1997.
            let standalone = (i == 0 || !bytes[i - 1].is_ascii_digit())
                && (i + 4 == bytes.len() || !bytes[i + 4].is_ascii_digit());
            if standalone {
                if let Ok(v) = text[i..i + 4].parse::<u32>() {
                    if (1000..3000).contains(&v) {
                        return Some(v);
                    }
                }
            }
        }
        i += 1;
    }
    None
}

fn read_one(path: &Path, cache_dir: &Path) -> Option<ScannedTrack> {
    let path_str = path.to_string_lossy().replace('\\', "/");
    let key = path_key(&path_str);

    let tagged = Probe::open(path).ok()?.read().ok()?;
    let props = tagged.properties();

    // First non-empty value wins, walking the tags in the order lofty found them. That precedence
    // is accidental rather than chosen — a file with both ID3v2 and APE blocks resolves on whichever
    // the probe yields first — but it is consistent, and picking a deliberate order needs a rule
    // about which format is authoritative that the tags themselves do not carry.
    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut album_artist = None;
    let mut genre = None;
    let mut year = 0u32;
    let mut track_no = 0u32;
    let mut disc_no = 0u32;
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
        if genre.is_none() {
            genre = tag.genre().map(|s| s.to_string());
        }
        if album_artist.is_none() {
            album_artist = tag.get_string(ItemKey::AlbumArtist).map(|s| s.to_string());
        }
        if track_no == 0 {
            track_no = tag.track().unwrap_or(0);
        }
        if disc_no == 0 {
            disc_no = tag.disk().unwrap_or(0);
        }
        if year == 0 {
            // `date()` covers formats that store a real timestamp; the string keys catch the ones
            // that only ever had a bare year, which is most MP3s in the wild.
            year = tag
                .date()
                .map(|ts| ts.year as u32)
                .or_else(|| tag.get_string(ItemKey::Year).and_then(year_from))
                .unwrap_or(0);
        }
    }

    let fallback = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();

    Some(ScannedTrack {
        id: key.clone(),
        path: path_str,
        title: title.unwrap_or_else(|| fallback.clone()),
        artist: artist.unwrap_or_else(|| "Unknown artist".into()),
        album_artist: album_artist.unwrap_or_default(),
        album: album.unwrap_or_default(),
        genre: genre.unwrap_or_default(),
        year,
        track_no,
        disc_no,
        duration: props.duration().as_secs_f64(),
        artwork_path: extract_artwork(&tagged, &key, cache_dir),
        codec: format!("{:?}", tagged.file_type()),
        bitrate: props.audio_bitrate().unwrap_or(0),
        sample_rate: props.sample_rate().unwrap_or(0),
        bit_depth: props.bit_depth().unwrap_or(0),
    })
}

/// Start a background scan. Returns immediately; progress arrives as events:
///   `library://batch` — a Vec<ScannedTrack> of up to BATCH entries
///   `library://done`  — total track count
///   `library://error` — a message, for a root we could not read at all
#[tauri::command]
pub async fn scan_folder(app: tauri::AppHandle, root: String, cache_dir: String) -> Result<(), String> {
    let handle = app.clone();
    std::thread::spawn(move || {
        let cache = PathBuf::from(&cache_dir);
        let _ = fs::create_dir_all(&cache);

        let root_path = PathBuf::from(&root);
        if !root_path.is_dir() {
            let _ = handle.emit("library://error", format!("Not a folder: {root}"));
            return;
        }

        let mut files = Vec::new();
        collect_files(&root_path, &mut files);
        files.sort();

        let mut batch: Vec<ScannedTrack> = Vec::with_capacity(BATCH);
        let mut total = 0usize;

        for file in &files {
            if let Some(track) = read_one(file, &cache) {
                batch.push(track);
                total += 1;
                if batch.len() >= BATCH {
                    let _ = handle.emit("library://batch", batch.clone());
                    batch.clear();
                }
            }
        }
        if !batch.is_empty() {
            let _ = handle.emit("library://batch", batch);
        }
        let _ = handle.emit("library://done", total);
    });

    Ok(())
}
