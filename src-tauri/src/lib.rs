mod audio_protocol;
mod commands;
#[cfg(windows)]
mod taskbar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("noctra-audio", |_ctx, request, responder| {
            audio_protocol::handle(request, responder)
        })
        .setup(|app| {
            use tauri::Manager;
            // The thumbnail toolbar subclasses the window procedure, so it has to be installed on
            // the window's own thread — which is exactly where `setup` runs.
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                match window.hwnd() {
                    Ok(hwnd) => {
                        if let Err(e) = taskbar::init(app.handle().clone(), hwnd) {
                            eprintln!("[noctra] taskbar buttons unavailable: {e}");
                        }
                    }
                    Err(e) => eprintln!("[noctra] no window handle for the taskbar: {e}"),
                }
            }
            // The mini-player window is declared in tauri.conf.json (hidden) rather than built at
            // runtime: on Windows a runtime-built webview gets a WebView2 environment whose browser
            // args differ from the main window's, and it never finishes initialising (BUG-011).
            Ok(())
        })
        // The card is frameless but still `closable`, so Alt+F4 or any OS-level close request used to
        // destroy it outright. Nothing rebuilds it — `toggle_mini` only looks the label up — so one
        // accidental close bricked the feature until the whole app restarted, and the command reported
        // it as "not declared in tauri.conf.json", which points at the config rather than at reality.
        // Hiding instead keeps the window registered, which is what every other path already assumes.
        .on_window_event(|window, event| {
            if window.label() != "mini" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::read_tags,
            commands::extract_artwork,
            commands::toggle_mini,
            commands::mini_visible,
            commands::hide_mini,
            commands::taskbar_set_playing,
            commands::taskbar_set_favorite,
            commands::save_lyrics,
            commands::load_lyrics,
            commands::delete_lyrics,
            commands::read_sidecar_lyrics,
            commands::read_embedded_lyrics,
            commands::reveal_in_explorer,
            commands::open_url,
            commands::scan::scan_folder,
            commands::scan::scan_paths,
            commands::scan::load_library,
            commands::scan::save_library
        ])
        .run(tauri::generate_context!())
        .expect("error while running Noctra");
}
