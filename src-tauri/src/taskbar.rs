//! Windows taskbar thumbnail toolbar — the button row in the hover preview.
//!
//! This is `ITaskbarList3::ThumbBarAddButtons`. Windows 11 does render it (see the reference
//! captures in `docs/references/06..08`), so the row is native rather than a fake window.
//!
//! All of the `unsafe` Win32 lives in this file on purpose: a mistake here takes down the shell's
//! hover preview or the window procedure, so it is kept away from the rest of the codebase.

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THB_FLAGS, THB_ICON, THB_TOOLTIP, THBN_CLICKED, THBF_ENABLED,
    THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallWindowProcW, CreateIcon, GetWindowLongPtrW, RegisterWindowMessageW, SetWindowLongPtrW,
    GWLP_WNDPROC, HICON, WM_COMMAND,
};

const BTN_PREV: u32 = 1;
const BTN_PLAY: u32 = 2;
const BTN_NEXT: u32 = 3;
const BTN_FAV: u32 = 4;

/// Event the frontend listens on; payload is `prev` / `toggle` / `next` / `favorite`.
const COMMAND_EVENT: &str = "taskbar-command";

type WndProcFn = unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT;

static APP: OnceLock<AppHandle> = OnceLock::new();
static PREV_PROC: OnceLock<Option<WndProcFn>> = OnceLock::new();
static TASKBAR_RESTARTED: OnceLock<u32> = OnceLock::new();
/// `HICON`s as raw handles. The shell owns nothing here that Rust can describe safely, and
/// `OnceLock` needs `Sync`, so the handles stay `isize` and are wrapped at the two use sites.
static ICONS: OnceLock<[isize; GLYPH_COUNT]> = OnceLock::new();
static BUTTONS: Mutex<Option<Buttons>> = Mutex::new(None);
/// Last requested glyph for the two stateful buttons. Explorer rebuilds its taskbar after a crash
/// or a settings change, `install_buttons` runs again, and without this the row silently resets to
/// "outline heart / pause" regardless of what is actually playing or liked.
static STATE: [std::sync::atomic::AtomicUsize; 2] = [
    std::sync::atomic::AtomicUsize::new(GLYPH_PAUSE),
    std::sync::atomic::AtomicUsize::new(GLYPH_HEART),
];
const STATE_PLAY: usize = 0;
const STATE_FAV: usize = 1;

struct Buttons {
    hwnd: HWND,
    list: ITaskbarList3,
    items: Vec<THUMBBUTTON>,
}

// `ITaskbarList3` is an STA COM pointer and `HWND` a raw handle, so neither is `Send` on its own.
// Both are only ever touched on the window's thread: `init` runs in Tauri's setup hook and the
// state setters are marshalled there with `run_on_main_thread` before they reach this.
unsafe impl Send for Buttons {}

/// Add the toolbar and subclass the window so clicks can be routed.
///
/// Must be called on the window's thread, which is where Tauri runs its `setup` hook.
pub fn init(app: AppHandle, hwnd: HWND) -> Result<(), String> {
    let _ = APP.set(app);

    let _ = TASKBAR_RESTARTED.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) });

    // A failure here is expected and ignored: WebView2 usually has the thread already, and only a
    // thread with no COM at all would break `CoCreateInstance` below.
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    }

    install_buttons(hwnd)?;

    let prev = unsafe { GetWindowLongPtrW(hwnd, GWLP_WNDPROC) };
    // `Option<fn>` rather than a bare fn pointer: the niche makes the 0 that `GetWindowLongPtrW`
    // returns on failure a valid value instead of undefined behaviour.
    PREV_PROC
        .set(unsafe { std::mem::transmute::<isize, Option<WndProcFn>>(prev) })
        .map_err(|_| "toolbar subclass is already installed".to_string())?;

    unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, wndproc as WndProcFn as isize) };
    Ok(())
}

fn install_buttons(hwnd: HWND) -> Result<(), String> {
    let list: ITaskbarList3 = unsafe {
        CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?
    };
    unsafe { list.HrInit().map_err(|e| e.to_string())? };

    let icons = ICONS.get_or_init(create_icons);
    let items = vec![
        button(BTN_PREV, "Previous", icons[GLYPH_PREV]),
        button(
            BTN_PLAY,
            "Play / pause",
            icons[STATE[STATE_PLAY].load(std::sync::atomic::Ordering::SeqCst)],
        ),
        button(BTN_NEXT, "Next", icons[GLYPH_NEXT]),
        button(
            BTN_FAV,
            "Favourite",
            icons[STATE[STATE_FAV].load(std::sync::atomic::Ordering::SeqCst)],
        ),
    ];

    unsafe { list.ThumbBarAddButtons(hwnd, &items) }
        .map_err(|e| format!("ThumbBarAddButtons failed: {e}"))?;

    *BUTTONS.lock().unwrap() = Some(Buttons { hwnd, list, items });
    Ok(())
}

fn button(id: u32, tip: &str, icon: isize) -> THUMBBUTTON {
    let mut b = THUMBBUTTON::default();
    b.iId = id;
    b.dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
    b.hIcon = HICON(icon as *mut _);
    b.dwFlags = THBF_ENABLED;
    for (i, c) in tip.encode_utf16().take(259).enumerate() {
        b.szTip[i] = c;
    }
    b
}

/// Swap one button's glyph. The stored array is updated as well, because
/// `ThumbBarUpdateButtons` is given the whole row rather than a single entry.
fn set_glyph(index: usize, slot: usize, glyph: usize) {
    STATE[slot].store(glyph, std::sync::atomic::Ordering::SeqCst);
    let mut guard = BUTTONS.lock().unwrap();
    let (Some(state), Some(icons)) = (guard.as_mut(), ICONS.get()) else {
        return;
    };
    state.items[index].hIcon = HICON(icons[glyph] as *mut _);
    let _ = unsafe { state.list.ThumbBarUpdateButtons(state.hwnd, &state.items) };
}

pub fn set_playing(playing: bool) {
    set_glyph(1, STATE_PLAY, if playing { GLYPH_PAUSE } else { GLYPH_PLAY });
}

pub fn set_favorite(favorite: bool) {
    set_glyph(
        3,
        STATE_FAV,
        if favorite {
            GLYPH_HEART_FILLED
        } else {
            GLYPH_HEART
        },
    );
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
        if let (Some(app), Some(payload)) =
            (APP.get(), command_for((wparam.0 & 0xffff) as u32))
        {
            let _ = app.emit(COMMAND_EVENT, payload);
        }
        return LRESULT(0);
    }

    // Explorer rebuilds its taskbar after a crash or a settings change and the buttons go with it.
    if Some(msg) == TASKBAR_RESTARTED.get().copied() {
        let _ = install_buttons(hwnd);
    }

    match PREV_PROC.get().copied().flatten() {
        Some(prev) => unsafe { CallWindowProcW(Some(prev), hwnd, msg, wparam, lparam) },
        // Only reachable if the previous procedure came back null. There is nothing to forward to,
        // and dropping the message beats calling through a null pointer.
        None => LRESULT(0),
    }
}

fn command_for(id: u32) -> Option<&'static str> {
    match id {
        BTN_PREV => Some("prev"),
        BTN_PLAY => Some("toggle"),
        BTN_NEXT => Some("next"),
        BTN_FAV => Some("favorite"),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Glyph rasterisation
//
// The toolbar wants `HICON`s. Shipping .ico assets for four glyphs would be a maintenance burden
// for shapes that are a dozen lines of maths, so each one is drawn white on transparent and handed
// to `CreateIcon` as a premultiplied BGRA bitmap plus a 1-bit AND mask. Premultiplying over black
// is deliberate: the hover preview is dark, so the anti-aliased edge reads correctly whether or not
// the shell composites the alpha channel.
//
// The shapes are authored in a 32-unit space but rendered at 64px. The shell scales thumbnail
// buttons to the system small-icon size, which at high DPI can be larger than 32 — and upscaling a
// hand-drawn bitmap is exactly the "blurry and pixelated" the row used to read as. Rendering twice
// as large means the shell only ever downscales.
// ---------------------------------------------------------------------------

const UNIT: f32 = 32.0;
const OUT: usize = 64;
/** Samples per output pixel axis. 3 gives 9 alpha levels on top of the 2x geometric density. */
const SS: usize = 3;

const GLYPH_PREV: usize = 0;
const GLYPH_PLAY: usize = 1;
const GLYPH_PAUSE: usize = 2;
const GLYPH_NEXT: usize = 3;
const GLYPH_HEART: usize = 4;
const GLYPH_HEART_FILLED: usize = 5;
const GLYPH_COUNT: usize = 6;

fn create_icons() -> [isize; GLYPH_COUNT] {
    let glyphs = [
        Glyph::Prev,
        Glyph::Play,
        Glyph::Pause,
        Glyph::Next,
        Glyph::Heart,
        Glyph::HeartFilled,
    ];
    std::array::from_fn(|i| {
        let (color, mask) = rasterize(glyphs[i]);
        unsafe {
            CreateIcon(
                None,
                OUT as i32,
                OUT as i32,
                1,
                32,
                mask.as_ptr(),
                color.as_ptr(),
            )
        }
        .map(|h| h.0 as isize)
        .unwrap_or(0)
    })
}

#[derive(Clone, Copy)]
enum Glyph {
    Prev,
    Play,
    Pause,
    Next,
    Heart,
    HeartFilled,
}

/// The shapes were authored to sit inside a ring that the reference row does not have, so they are
/// scaled about the icon centre to fill the box instead of floating small in the middle of it.
const GLYPH_SCALE: f32 = 1.75;

fn rect(x: f32, y: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> bool {
    (x0..=x1).contains(&x) && (y0..=y1).contains(&y)
}

fn triangle(x: f32, y: f32, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32) -> bool {
    let sign = |px: f32, py: f32, x1: f32, y1: f32, x2: f32, y2: f32| {
        (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)
    };
    let d1 = sign(x, y, ax, ay, bx, by);
    let d2 = sign(x, y, bx, by, cx, cy);
    let d3 = sign(x, y, cx, cy, ax, ay);
    !((d1 < 0.0 || d2 < 0.0 || d3 < 0.0) && (d1 > 0.0 || d2 > 0.0 || d3 > 0.0))
}

/// The heart, as a polygon rather than the classic implicit curve.
///
/// The implicit form `(u²+v²−1)³ − u²v³ ≤ 0` was the original approach, and its "outline" was the
/// region between the curve and a copy of itself scaled down. That scale is not an offset curve, so
/// the band width varied with local curvature: measured, the top row came out a solid 14px while the
/// rows below it were 2-4px, which is why the liked and unliked glyphs looked like different,
/// wrongly-oriented shapes rather than one heart toggled. A polygon gives a genuinely even stroke via
/// distance-to-edge, and point-in-polygon gives a filled variant with the identical silhouette.
fn heart_polygon() -> Vec<(f32, f32)> {
    const N: usize = 96;
    const WIDTH: f32 = 11.6;
    const CX: f32 = 16.0;
    const CY: f32 = 16.6;

    let mut raw = Vec::with_capacity(N);
    for i in 0..N {
        let t = (i as f32 / N as f32) * std::f32::consts::TAU;
        raw.push((
            16.0 * t.sin().powi(3),
            13.0 * t.cos() - 5.0 * (2.0 * t).cos() - 2.0 * (3.0 * t).cos() - (4.0 * t).cos(),
        ));
    }
    let xs: Vec<f32> = raw.iter().map(|p| p.0).collect();
    let ys: Vec<f32> = raw.iter().map(|p| p.1).collect();
    let (min_x, max_x) = (xs.iter().cloned().fold(f32::INFINITY, f32::min), xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max));
    let (min_y, max_y) = (ys.iter().cloned().fold(f32::INFINITY, f32::min), ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max));
    // Uniform scale keeps the aspect ratio; y is negated because the curve is y-up and the icon is
    // y-down.
    let s = WIDTH / (max_x - min_x).max(max_y - min_y);
    let (cxr, cyr) = ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0);
    raw.into_iter()
        .map(|(x, y)| (CX + (x - cxr) * s, CY - (y - cyr) * s))
        .collect()
}

/// Cached once: the polygon and the bbox used to reject the ~87% of pixels that cannot be on the
/// outline, which keeps the rasterise at startup cheap.
fn heart_shape() -> &'static (Vec<(f32, f32)>, (f32, f32, f32, f32)) {
    static HEART: std::sync::OnceLock<(Vec<(f32, f32)>, (f32, f32, f32, f32))> = std::sync::OnceLock::new();
    HEART.get_or_init(|| {
        let poly = heart_polygon();
        let xs: Vec<f32> = poly.iter().map(|p| p.0).collect();
        let ys: Vec<f32> = poly.iter().map(|p| p.1).collect();
        let box_ = (
            xs.iter().cloned().fold(f32::INFINITY, f32::min),
            ys.iter().cloned().fold(f32::INFINITY, f32::min),
            xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max),
            ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max),
        );
        (poly, box_)
    })
}

/// Half-width of the outline band, in design units.
const HEART_STROKE: f32 = 0.62;

fn point_in_poly(px: f32, py: f32, poly: &[(f32, f32)]) -> bool {
    let mut inside = false;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        if (yi > py) != (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn dist_sq_to_segment(px: f32, py: f32, x1: f32, y1: f32, x2: f32, y2: f32) -> f32 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { (((px - x1) * dx + (py - y1) * dy) / len2).clamp(0.0, 1.0) };
    let cx = x1 + t * dx;
    let cy = y1 + t * dy;
    (px - cx) * (px - cx) + (py - cy) * (py - cy)
}

fn heart(x: f32, y: f32, filled: bool) -> bool {
    let (poly, (min_x, min_y, max_x, max_y)) = heart_shape();
    let pad = if filled { 0.0 } else { HEART_STROKE };
    if x < min_x - pad || x > max_x + pad || y < min_y - pad || y > max_y + pad {
        return false;
    }
    if filled {
        return point_in_poly(x, y, poly);
    }
    let limit = HEART_STROKE * HEART_STROKE;
    let mut j = poly.len() - 1;
    for i in 0..poly.len() {
        let (x1, y1) = poly[j];
        let (x2, y2) = poly[i];
        if dist_sq_to_segment(x, y, x1, y1, x2, y2) <= limit {
            return true;
        }
        j = i;
    }
    false
}

fn inside(g: Glyph, x: f32, y: f32) -> bool {
    let (x, y) = (
        16.0 + (x - 16.0) / GLYPH_SCALE,
        16.0 + (y - 16.0) / GLYPH_SCALE,
    );
    match g {
        Glyph::Prev => {
            rect(x, y, 10.8, 10.4, 12.4, 21.6)
                || triangle(x, y, 21.4, 10.4, 21.4, 21.6, 13.0, 16.0)
        }
        Glyph::Next => {
            rect(x, y, 19.6, 10.4, 21.2, 21.6)
                || triangle(x, y, 10.6, 10.4, 10.6, 21.6, 19.0, 16.0)
        }
        Glyph::Play => triangle(x, y, 12.6, 10.2, 12.6, 21.8, 22.4, 16.0),
        Glyph::Pause => {
            rect(x, y, 11.7, 10.4, 14.1, 21.6) || rect(x, y, 17.9, 10.4, 20.3, 21.6)
        }
        Glyph::Heart => heart(x, y, false),
        Glyph::HeartFilled => heart(x, y, true),
    }
}

fn rasterize(g: Glyph) -> (Vec<u8>, Vec<u8>) {
    // Rows are stored top-down, because that is the order the shell draws them: the first row of
    // both bitmaps lands at the top of the button. The previous version pre-flipped them on the
    // theory that `CreateIcon` wanted a bottom-up DIB, which inverted every glyph. It went unnoticed
    // because Prev/Play/Pause/Next are all symmetric about y=16 and a vertical flip leaves them
    // pixel-identical — the heart is the only asymmetric shape in the set, so it is the only glyph
    // that could show the bug. See BUG-054.
    let mut color = vec![0u8; OUT * OUT * 4];
    let mut mask = vec![0u8; OUT * 8];

    let step = 1.0 / SS as f32;
    for row in 0..OUT {
        for col in 0..OUT {
            let mut hits = 0u32;
            for sy in 0..SS {
                for sx in 0..SS {
                    // Output pixel (col,row) maps to unit coordinate col/2, and the sub-samples
                    // stay inside that output pixel.
                    let x = (col as f32 + (sx as f32 + 0.5) * step) * UNIT / OUT as f32;
                    let y = (row as f32 + (sy as f32 + 0.5) * step) * UNIT / OUT as f32;
                    if inside(g, x, y) {
                        hits += 1;
                    }
                }
            }
            let a = (hits * 255 / (SS * SS) as u32) as u8;
            let i = (row * OUT + col) * 4;
            // White, premultiplied, so r = g = b = a.
            color[i] = a;
            color[i + 1] = a;
            color[i + 2] = a;
            color[i + 3] = a;
            if a == 0 {
                mask[row * 8 + col / 8] |= 0x80 >> (col % 8);
            }
        }
    }
    (color, mask)
}
