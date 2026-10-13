#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            vault::setup(app)?;
            bridge::start()
        })
        .invoke_handler(tauri::generate_handler![
            vault::vault_status,
            vault::create_vault,
            vault::unlock_vault,
            vault::lock_vault,
            vault::list_entries,
            vault::save_entry,
            vault::reveal_password,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
mod bridge;
mod vault;
