use serde::Serialize;
use std::path::{Path, PathBuf};

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
fn installed_folder(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let folder = resource_dir?.join("extension");
    folder.is_dir().then_some(folder)
}

pub fn extension_folder(resource_dir: Option<&Path>) -> ExtensionFolder {
    if cfg!(debug_assertions) {
        return ExtensionFolder::Dev;
    }
    match installed_folder(resource_dir) {
        Some(folder) => ExtensionFolder::Installed {
            path: folder.display().to_string(),
        },
        None => ExtensionFolder::Missing,
    }
}

/// Opens only the bundled folder: the webview never passes a path.
pub fn open_extension_folder(resource_dir: Option<&Path>) -> Result<(), String> {
    let folder = installed_folder(resource_dir).ok_or("no extension folder")?;
    std::process::Command::new("explorer.exe")
        .arg(folder)
        .spawn()
        .map_err(|_| "folder not opened")?;
    Ok(())
}
