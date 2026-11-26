#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use cairn_app::{App, AppEvent, startup};
    use tauri::{Emitter, Manager};

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("error starting Cairn's runtime");
    let background = runtime.handle().clone();
    tauri::async_runtime::set(background.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::restore(app);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            let directory = data_directory(app.handle())?;
            let (cairn, mut events) = App::open(&directory, background.clone())?;
            app.manage(cairn);
            app.manage(updater::Updates::load(app.handle(), &directory));
            tray::setup(app)?;

            let hidden = startup::launched_at_sign_in();
            if hidden {
                app.state::<App>().set_hidden(true);
            } else {
                tray::restore(app.handle());
            }

            let handle = app.handle().clone();
            background.spawn(async move {
                while let Some(event) = events.recv().await {
                    let _ = match event {
                        AppEvent::VaultLocked => handle.emit_to("main", "vault-locked", ()),
                        AppEvent::VaultChanged => handle.emit_to("main", "vault-changed", ()),
                        AppEvent::PairingRequested(request) => {
                            tray::restore(&handle);
                            handle.emit_to("main", "pairing-requested", request)
                        }
                        AppEvent::PairingConflict => {
                            tray::restore(&handle);
                            handle.emit_to("main", "pairing-conflict", ())
                        }
                    };
                }
            });
            app.state::<App>().start_bridge(env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    tray::hide(window.app_handle());
                }
                tauri::WindowEvent::ThemeChanged(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    tray::refresh_icon(window.app_handle());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault_status,
            commands::create_vault,
            commands::unlock_vault,
            commands::lock_vault,
            commands::list_entries,
            commands::save_entry,
            commands::update_entry,
            commands::delete_entry,
            commands::reveal_password,
            commands::generate_password,
            commands::totp_code,
            commands::read_otp,
            commands::import_otp,
            commands::scan_qr,
            commands::pairing_request,
            commands::answer_pairing,
            commands::list_browsers,
            commands::rename_browser,
            commands::remove_browser,
            commands::favicon_cached,
            commands::favicon_refresh,
            commands::locale,
            commands::set_language,
            updater::update_status,
            updater::update_set_channel,
            updater::update_check,
            updater::update_install,
            commands::connector_extension_folder,
            commands::connector_open_extension_folder,
            commands::startup_status,
            commands::startup_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cairn");
}
mod commands;
mod tray;
mod updater;

fn data_directory(app: &tauri::AppHandle) -> tauri::Result<std::path::PathBuf> {
    use tauri::Manager;
    let directory = app.path().app_local_data_dir()?;
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("CAIRN_TEST_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(directory);
    Ok(directory)
}
