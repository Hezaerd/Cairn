use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Stable follows published releases; nightly follows the daily builds of `main`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Nightly,
}

impl Channel {
    // The webview picks a channel, never a URL. GitHub's `latest` release skips
    // prereleases, so the rolling nightly release never reaches stable installs.
    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => "https://github.com/Hezaerd/Cairn/releases/latest/download/latest.json",
            Self::Nightly => {
                "https://github.com/Hezaerd/Cairn/releases/download/nightly/latest.json"
            }
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Nightly => "nightly",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        [Self::Stable, Self::Nightly]
            .into_iter()
            .find(|channel| channel.name() == name)
    }
}

struct Inner {
    channel: Channel,
    pending: Option<Update>,
}

// The webview never talks to the updater plugin directly: it can only pick a
// channel, ask whether a signed release is waiting, and accept it.
pub(crate) struct Updates {
    file: PathBuf,
    state: Mutex<Inner>,
}

impl Updates {
    pub fn load(app: &AppHandle) -> tauri::Result<Self> {
        let file = crate::vault::data_directory(app)?.join("update-channel");
        // An installed nightly stays on nightly until the user picks a channel.
        let default = if app.package_info().version.pre.is_empty() {
            Channel::Stable
        } else {
            Channel::Nightly
        };
        let channel = std::fs::read_to_string(&file)
            .ok()
            .and_then(|name| Channel::parse(name.trim()))
            .unwrap_or(default);
        Ok(Self {
            file,
            state: Mutex::new(Inner {
                channel,
                pending: None,
            }),
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    version: String,
    channel: Channel,
    /// Debug builds back the end-to-end tests, which must stay offline.
    enabled: bool,
    /// A release found by an earlier check and not installed yet.
    available: Option<String>,
}

#[tauri::command]
pub fn update_status(
    app: AppHandle,
    window: WebviewWindow,
    updates: State<'_, Updates>,
) -> Result<UpdateStatus, String> {
    if window.label() != "main" {
        return Err("update refused".into());
    }
    let state = updates.state.lock().map_err(|_| "update state poisoned")?;
    Ok(UpdateStatus {
        version: app.package_info().version.to_string(),
        channel: state.channel,
        enabled: !cfg!(debug_assertions),
        available: state.pending.as_ref().map(|update| update.version.clone()),
    })
}

#[tauri::command]
pub fn update_set_channel(
    window: WebviewWindow,
    updates: State<'_, Updates>,
    channel: Channel,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("update refused".into());
    }
    let mut state = updates.state.lock().map_err(|_| "update state poisoned")?;
    if let Some(directory) = updates.file.parent() {
        std::fs::create_dir_all(directory).map_err(|_| "update channel not saved")?;
    }
    std::fs::write(&updates.file, channel.name()).map_err(|_| "update channel not saved")?;
    state.channel = channel;
    state.pending = None;
    Ok(())
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    window: WebviewWindow,
    updates: State<'_, Updates>,
) -> Result<Option<String>, String> {
    if cfg!(debug_assertions) || window.label() != "main" {
        return Ok(None);
    }
    let channel = updates
        .state
        .lock()
        .map_err(|_| "update state poisoned")?
        .channel;
    let endpoint = channel
        .endpoint()
        .parse()
        .map_err(|_| "updater unavailable")?;
    let update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .and_then(|builder| builder.build())
        .map_err(|_| "updater unavailable")?
        .check()
        .await
        .map_err(|_| "update check failed")?;
    let mut state = updates.state.lock().map_err(|_| "update state poisoned")?;
    // A channel switch during the request makes this answer stale.
    if state.channel != channel {
        return Err("update channel changed".into());
    }
    let version = update.as_ref().map(|update| update.version.clone());
    state.pending = update;
    Ok(version)
}

#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    window: WebviewWindow,
    updates: State<'_, Updates>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("update refused".into());
    }
    let update = updates
        .state
        .lock()
        .map_err(|_| "update state poisoned")?
        .pending
        .take()
        .ok_or("no pending update")?;
    // On Windows the installer takes over and closes Cairn before this returns.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| "update install failed")?;
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::Channel;

    #[test]
    fn channel_names_round_trip() {
        for channel in [Channel::Stable, Channel::Nightly] {
            assert_eq!(Channel::parse(channel.name()), Some(channel));
        }
        assert_eq!(Channel::parse("beta"), None);
    }
}
