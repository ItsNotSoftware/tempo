mod store;

use tauri::tray::TrayIconBuilder;
use tauri::WindowEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // A link in a rendered note has to leave for the browser. Opened in the
        // webview it would navigate the app away, with no way back.
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            store::load_state,
            store::save_state,
            store::notes_root,
            store::set_notes_root,
            store::load_vault,
            store::write_note,
            store::write_index,
            store::delete_note,
            store::move_path,
            store::make_dir,
            store::delete_dir,
        ])
        .setup(|app| {
            TrayIconBuilder::with_id("main")
                .icon(tauri::include_image!("icons/tray.png"))
                .icon_as_template(true)
                .tooltip("Tempo")
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
