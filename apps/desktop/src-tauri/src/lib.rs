#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::restore(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            app.manage(locale::Languages::load(&vault::data_directory(app.handle())?));
            vault::setup(app)?;
            app.manage(favicon::Downloads::default());
            app.manage(updater::Updates::load(app.handle())?);
            tray::setup(app)?;
            bridge::start(app)
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
            bridge::pairing_request,
            bridge::answer_pairing,
            bridge::list_browsers,
            bridge::remove_browser,
            favicon::favicon_cached,
            favicon::favicon_refresh,
            locale::locale,
            locale::set_language,
            updater::update_status,
            updater::update_set_channel,
            updater::update_check,
            updater::update_install,
            connector::connector_extension_folder,
            connector::connector_open_extension_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
mod bridge;
mod connector;
mod favicon;
mod locale;
mod tray;
mod updater;
mod vault;
