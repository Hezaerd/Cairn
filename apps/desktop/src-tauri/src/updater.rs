use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

// The webview never talks to the updater plugin directly: it can only ask
// whether a signed release is waiting and accept it.
#[derive(Default)]
pub(crate) struct Pending(Mutex<Option<Update>>);

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<'_, Pending>,
) -> Result<Option<String>, String> {
    // Debug builds back the end-to-end tests, which must stay offline.
    if cfg!(debug_assertions) || window.label() != "main" {
        return Ok(None);
    }
    let update = app
        .updater()
        .map_err(|_| "updater unavailable")?
        .check()
        .await
        .map_err(|_| "update check failed")?;
    let version = update.as_ref().map(|update| update.version.clone());
    *pending.0.lock().map_err(|_| "update state poisoned")? = update;
    Ok(version)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<'_, Pending>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("update refused".into());
    }
    let update = pending
        .0
        .lock()
        .map_err(|_| "update state poisoned")?
        .take()
        .ok_or("no pending update")?;
    // On Windows the installer takes over and closes Cairn before this returns.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "update install failed")?;
    app.restart()
}
