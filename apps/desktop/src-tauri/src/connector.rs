use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ExtensionFolder {
    /// Debug builds ship no extension: the dev scripts register the host for
    /// `apps/extension/dist`.
    Dev,
    Missing,
    Installed {
        path: String,
    },
}

/// The release extension the installer puts next to Cairn.
fn installed_folder(app: &AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let folder = app.path().resource_dir().ok()?.join("extension");
    folder.is_dir().then_some(folder)
}

#[tauri::command]
pub fn connector_extension_folder(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ExtensionFolder, String> {
    if window.label() != "main" {
        return Err("connector refused".into());
    }
    if cfg!(debug_assertions) {
        return Ok(ExtensionFolder::Dev);
    }
    Ok(match installed_folder(&app) {
        Some(folder) => ExtensionFolder::Installed {
            path: folder.display().to_string(),
        },
        None => ExtensionFolder::Missing,
    })
}

/// Opens only the bundled folder: the webview never passes a path.
#[tauri::command]
pub fn connector_open_extension_folder(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("connector refused".into());
    }
    let folder = installed_folder(&app).ok_or("no extension folder")?;
    std::process::Command::new("explorer.exe")
        .arg(folder)
        .spawn()
        .map_err(|_| "folder not opened")?;
    Ok(())
}
