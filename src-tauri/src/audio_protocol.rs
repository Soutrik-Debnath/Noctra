//! `noctra-audio://` — streams local audio files to the webview.
//!
//! Replaces the stock asset protocol for audio. Two reasons it exists:
//!
//! 1. **FLAC repair (BUG-008).** Some taggers write a PICTURE metadata block with an *empty* MIME
//!    type string. Chromium's FLAC demuxer treats that as fatal and rejects the whole file before
//!    reading any audio; lofty and most desktop players ignore it. We fill that string in on the
//!    bytes we serve. The file on disk is never modified — this is the entire point of doing it
//!    here rather than rewriting tags during a scan.
//! 2. **Correct response headers.** The asset protocol reports `audio/x-flac`, which
//!    `canPlayType` does not recognise, and we want explicit `Accept-Ranges` for seeking.
//!
//! Because patching changes the metadata length, logical byte offsets no longer match physical
//! ones. `delta` is that shift, and range requests are translated through it.
//!
//! Performance: Chromium probes a media URL with several small range requests before it plays
//! anything. Header analysis is therefore cached per path, the probe read starts at 64KB and only
//! grows for files that are genuinely FLAC, and responses are capped so one request cannot force a
//! whole-file allocation. Without this, every probe re-read and re-walked megabytes and first play
//! stalled for seconds.

use percent_encoding::percent_decode_str;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::UriSchemeResponder;

/// MIME we substitute when a FLAC PICTURE block declares an empty one.
const FILL_MIME: &[u8] = b"image/jpeg";

/// Initial probe. Tag blocks in this library run to ~110KB, so this grows at most once.
const FIRST_PROBE: usize = 64 * 1024;
/// Ceiling on the probe; beyond this we serve the file untouched rather than hunting.
const MAX_PROBE: usize = 8 * 1024 * 1024;
/// Largest single response body, keeping memory flat regardless of file size.
///
/// Was 2MB. Measured throughput is roughly 2MB per 500–1000ms, and Chromium's FLAC path keeps
/// requesting until it has most of the file in hand before it reports HAVE_ENOUGH_DATA — so a 30MB
/// album took 8.7–13.7s to start. Each response costs one round trip through the URI-scheme bridge,
/// so the chunk size is the multiplier on that cost: 2MB needed ~15 trips, 8MB needs ~4.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;

struct Plan {
    /// Patched bytes covering logical offsets `0..prefix.len()`. Empty when nothing needed changing.
    prefix: Vec<u8>,
    /// `prefix.len() - audio_start`: how far logical offsets sit above physical ones.
    delta: i64,
    file_len: u64,
    path: String,
}

fn plans() -> &'static Mutex<HashMap<String, Arc<Plan>>> {
    static PLANS: OnceLock<Mutex<HashMap<String, Arc<Plan>>>> = OnceLock::new();
    PLANS.get_or_init(Default::default)
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "m4a" | "mp4" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" | "oga" => "audio/ogg",
        "wav" => "audio/wav",
        // Extracted cover art is served through the same protocol, so it needs image types too.
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

/// Pull the absolute file path back out of the request URI.
///
/// Windows rewrites custom schemes to `http://noctra-audio.localhost/play/<encoded>`, while other
/// platforms hand over `noctra-audio://play/<encoded>` as-is. Both reduce to the percent encoded
/// path by dropping the host and the `play/` route segment.
fn resolve_path(uri: &str) -> Option<String> {
    let after_scheme = uri.split_once("://")?.1;
    let mut rest = match after_scheme.find('/') {
        Some(i) => &after_scheme[i + 1..],
        None => "",
    };
    rest = rest.strip_prefix("play/").unwrap_or(rest);
    let path = percent_decode_str(rest).decode_utf8().ok()?.into_owned();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

enum Scan {
    /// `(audio_data_start, patched_prefix)`; an empty prefix means nothing had to change.
    Done(u64, Vec<u8>),
    /// The probe window ended mid-block; retry with more bytes.
    NeedMore,
    /// Not a FLAC file, or too unusual to touch.
    Skip,
}

/// Walk FLAC metadata blocks and rebuild the header with any empty PICTURE MIME filled in.
fn scan_flac(head: &[u8]) -> Scan {
    if head.len() < 4 || &head[0..4] != b"fLaC" {
        return Scan::Skip;
    }

    let mut off: usize = 4;
    // The prefix reproduces the whole physical header, magic signature included, because logical
    // offsets 0..audio_start are served straight from it.
    let mut out: Vec<u8> = Vec::with_capacity(head.len() + 16);
    out.extend_from_slice(b"fLaC");
    let mut patched = false;

    loop {
        if off + 4 > head.len() {
            return Scan::NeedMore;
        }
        let flags = head[off];
        let is_last = flags & 0x80 != 0;
        let block_type = flags & 0x7f;
        let len =
            ((head[off + 1] as u64) << 16) | ((head[off + 2] as u64) << 8) | head[off + 3] as u64;
        let body = off + 4;
        let end = body + len as usize;
        if end > head.len() {
            return Scan::NeedMore;
        }

        let mut block_body = head[body..end].to_vec();

        // PICTURE layout: u32 picture type, u32 mime length, mime, u32 desc length, ...
        if block_type == 6 && block_body.len() >= 8 {
            let mime_len =
                u32::from_be_bytes([block_body[4], block_body[5], block_body[6], block_body[7]])
                    as usize;
            if mime_len == 0 {
                block_body.splice(8..8, FILL_MIME.iter().copied());
                block_body[4..8].copy_from_slice(&(FILL_MIME.len() as u32).to_be_bytes());
                patched = true;
            }
        }

        let new_len = block_body.len() as u64;
        let mut hdr = [0u8; 4];
        hdr[0] = if is_last { 0x80 | block_type } else { block_type };
        hdr[1] = ((new_len >> 16) & 0xff) as u8;
        hdr[2] = ((new_len >> 8) & 0xff) as u8;
        hdr[3] = (new_len & 0xff) as u8;
        out.extend_from_slice(&hdr);
        out.extend_from_slice(&block_body);

        if is_last {
            return Scan::Done(end as u64, if patched { out } else { Vec::new() });
        }
        off = end;
    }
}

fn passthrough(path: &str, file_len: u64) -> Plan {
    Plan { prefix: Vec::new(), delta: 0, file_len, path: path.to_string() }
}

fn build_plan(path: &str) -> Result<Plan, String> {
    let mut file = File::open(path).map_err(|e| format!("cannot open {path}: {e}"))?;
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();

    // Cheap rejection first: anything that does not start with fLaC never allocates a probe.
    let mut magic = [0u8; 4];
    if file_len < 4 || file.read_exact(&mut magic).is_err() || magic != *b"fLaC" {
        return Ok(passthrough(path, file_len));
    }

    let mut size = std::cmp::min(file_len as usize, FIRST_PROBE);
    loop {
        let mut head = vec![0u8; size];
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        file.read_exact(&mut head).map_err(|e| e.to_string())?;

        match scan_flac(&head) {
            Scan::Done(audio_start, prefix) if !prefix.is_empty() => {
                let delta = prefix.len() as i64 - audio_start as i64;
                return Ok(Plan { prefix, delta, file_len, path: path.to_string() });
            }
            Scan::Done(_, _) | Scan::Skip => return Ok(passthrough(path, file_len)),
            Scan::NeedMore => {
                if size >= MAX_PROBE || size >= file_len as usize {
                    return Ok(passthrough(path, file_len));
                }
                size = std::cmp::min(size * 8, std::cmp::min(MAX_PROBE, file_len as usize));
            }
        }
    }
}

/// Cached plan lookup. Chromium issues several range requests per playback, and re-deriving the
/// header for each one was the bulk of the startup stall.
fn get_plan(path: &str) -> Result<Arc<Plan>, String> {
    if let Some(hit) = plans().lock().ok().and_then(|m| m.get(path).cloned()) {
        return Ok(hit);
    }
    let plan = Arc::new(build_plan(path)?);
    if let Ok(mut m) = plans().lock() {
        m.insert(path.to_string(), plan.clone());
    }
    Ok(plan)
}

/// Read `len` bytes starting at a *logical* offset, translating through `delta`.
fn read_logical(plan: &Plan, start: u64, len: u64) -> Result<Vec<u8>, String> {
    let prefix_len = plan.prefix.len() as u64;
    let mut out: Vec<u8> = Vec::with_capacity(std::cmp::min(len, MAX_CHUNK) as usize);
    let mut pos = start;
    let end = start + len;

    if pos < prefix_len {
        let take = std::cmp::min(len, prefix_len - pos) as usize;
        out.extend_from_slice(&plan.prefix[pos as usize..pos as usize + take]);
        pos += take as u64;
    }
    if pos < end {
        let phys = (pos as i64 - plan.delta).max(0) as u64;
        let want = (end - pos) as usize;
        let mut file = OpenOptions::new()
            .read(true)
            .open(&plan.path)
            .map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(phys)).map_err(|e| e.to_string())?;
        // Read straight into the response buffer. This used to go through a fresh 256KB scratch
        // vector per step and `extend_from_slice` out of it, which allocated and copied the whole
        // body a second time on every request — the cost showed up directly in the per-chunk time.
        let base = out.len();
        out.resize(base + want, 0);
        let mut filled = 0usize;
        {
            let slice = &mut out[base..];
            while filled < slice.len() {
                match file.read(&mut slice[filled..]) {
                    Ok(0) => break,
                    Ok(n) => filled += n,
                    Err(ref e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
        out.truncate(base + filled);
    }
    Ok(out)
}

fn response(status: u16, headers: Vec<(&str, String)>, body: Vec<u8>) -> http::Response<Vec<u8>> {
    let mut res = http::Response::new(body);
    *res.status_mut() = http::StatusCode::from_u16(status).unwrap_or(http::StatusCode::OK);
    {
        let map = res.headers_mut();
        map.insert(
            http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
            http::HeaderValue::from_static("*"),
        );
        map.insert(
            http::header::ACCEPT_RANGES,
            http::HeaderValue::from_static("bytes"),
        );
        for (k, v) in headers {
            if let (Ok(name), Ok(value)) = (
                http::header::HeaderName::from_bytes(k.as_bytes()),
                http::HeaderValue::from_str(&v),
            ) {
                map.insert(name, value);
            }
        }
    }
    res
}

/// Parse `bytes=a-b`, `bytes=a-` or `bytes=-n` into an inclusive logical range.
fn parse_range(spec: &str, logical_len: u64) -> Option<(u64, u64)> {
    let spec = spec.strip_prefix("bytes=")?.trim();
    let (start_s, end_s) = spec.split_once('-')?;
    let last = logical_len.checked_sub(1)?;
    if start_s.is_empty() {
        let n: u64 = end_s.trim().parse().ok()?;
        return Some((logical_len.saturating_sub(n), last));
    }
    let start: u64 = start_s.trim().parse().ok()?;
    let end: u64 = if end_s.trim().is_empty() {
        last
    } else {
        end_s.trim().parse::<u64>().ok()?.min(last)
    };
    Some((start, end))
}

pub fn handle(request: http::Request<Vec<u8>>, responder: UriSchemeResponder) {
    let uri = request.uri().to_string();
    let range = request
        .headers()
        .get(http::header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    std::thread::spawn(move || {
        let path = match resolve_path(&uri) {
            Some(p) => p,
            None => return responder.respond(response(400, vec![], Vec::new())),
        };
        let plan = match get_plan(&path) {
            Ok(p) => p,
            Err(e) => return responder.respond(response(404, vec![("content-type", e)], Vec::new())),
        };

        let logical_len = (plan.file_len as i64 + plan.delta) as u64;
        let ctype = content_type(&path).to_string();

        // Cover art is fetched repeatedly — the blur pass, the palette pass, and every time a
        // track is scrolled back to. It never changes under a fixed hash filename, so telling
        // the webview to cache it removes a pile of full-file reads from the same disk that the
        // audio is trying to stream from. Audio deliberately does NOT get this: a 30 MB range
        // stream is exactly what the media cache is for already, and caching it again would just
        // trade one limit for another.
        let cache_header: Option<(&str, String)> = if ctype.starts_with("image/") {
            Some(("cache-control", "public, max-age=31536000, immutable".to_string()))
        } else {
            None
        };

        if let Some(spec) = range.as_deref() {
            if let Some((req_start, req_end)) = parse_range(spec, logical_len) {
                if req_start >= logical_len || req_end < req_start {
                    return responder.respond(response(
                        416,
                        vec![("content-range", format!("bytes */{logical_len}"))],
                        Vec::new(),
                    ));
                }
                // A short 206 is legal: the client simply asks for the next piece, which keeps
                // memory flat no matter how large the file is.
                let end = std::cmp::min(req_end, req_start + MAX_CHUNK - 1);
                let len = end - req_start + 1;
                return match read_logical(&plan, req_start, len) {
                    Ok(body) => {
                        let mut headers = vec![
                            ("content-type", ctype.clone()),
                            ("content-length", body.len().to_string()),
                            ("content-range", format!("bytes {req_start}-{end}/{logical_len}")),
                        ];
                        if let Some((k, v)) = &cache_header {
                            headers.push((k, v.clone()));
                        }
                        responder.respond(response(206, headers, body))
                    }
                    Err(e) => {
                        responder.respond(response(500, vec![("content-type", e)], Vec::new()))
                    }
                };
            }
        }

        match read_logical(&plan, 0, logical_len) {
            Ok(body) => {
                let mut headers = vec![
                    ("content-type", ctype),
                    ("content-length", body.len().to_string()),
                ];
                if let Some((k, v)) = &cache_header {
                    headers.push((k, v.clone()));
                }
                responder.respond(response(200, headers, body))
            }
            Err(e) => responder.respond(response(500, vec![("content-type", e)], Vec::new())),
        }
    });
}
