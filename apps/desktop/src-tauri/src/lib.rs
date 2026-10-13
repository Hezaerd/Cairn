#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::restore(app);
        }))
        .setup(|app| {
            app.manage(locale::Locale::detect());
            vault::setup(app)?;
            app.manage(favicon::Downloads::default());
            tray::setup(app)?;
            bridge::start()
        })
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                tray::hide(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            vault::vault_status,
            vault::create_vault,
            vault::unlock_vault,
            vault::lock_vault,
            vault::list_entries,
            vault::save_entry,
            vault::update_entry,
            vault::delete_entry,
            vault::reveal_password,
            favicon::favicon_cached,
            favicon::favicon_refresh,
            locale::locale,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
mod bridge;
mod favicon;
mod locale;
mod tray;
mod vault;
