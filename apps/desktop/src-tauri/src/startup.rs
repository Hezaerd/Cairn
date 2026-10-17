use serde::Serialize;
use tauri::WebviewWindow;

/// Windows passes this to the copy it starts at sign-in, which stays in the tray.
pub const FLAG: &str = "--autostart";

pub fn launched_at_sign_in() -> bool {
    std::env::args().skip(1).any(|argument| argument == FLAG)
}

// The uninstaller removes a `Run` value named after the product, so the
// entry has to keep that name.
#[cfg(windows)]
const NAME: &str = "Cairn";
#[cfg(windows)]
const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// Where Task Manager and the Startup apps settings record a turned-off entry.
#[cfg(windows)]
const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

#[cfg(windows)]
fn registered() -> bool {
    use windows_registry::CURRENT_USER;
    let present = CURRENT_USER
        .open(RUN)
        .and_then(|key| key.get_string(NAME))
        .is_ok();
    // An odd first byte means the user turned the entry off outside Cairn.
    let turned_off = CURRENT_USER
        .open(APPROVED)
        .and_then(|key| key.get_value(NAME))
        .is_ok_and(|value| value.first().is_some_and(|flags| flags & 1 == 1));
    present && !turned_off
}

#[cfg(windows)]
fn register(enabled: bool) -> Result<(), String> {
    use windows_registry::CURRENT_USER;
    let failed = |_| "startup not saved".to_string();
    let run = CURRENT_USER.create(RUN).map_err(failed)?;
    if enabled {
        let executable = std::env::current_exe().map_err(|_| "startup not saved")?;
        run.set_string(NAME, format!("\"{}\" {FLAG}", executable.display()))
            .map_err(failed)?;
    } else if run.get_string(NAME).is_ok() {
        run.remove_value(NAME).map_err(failed)?;
    }
    // Clear a choice made in Task Manager so the two places agree.
    if let Ok(approved) = CURRENT_USER.open(APPROVED)
        && approved.get_value(NAME).is_ok()
    {
        approved.remove_value(NAME).map_err(failed)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn registered() -> bool {
    false
}

#[cfg(not(windows))]
fn register(_: bool) -> Result<(), String> {
    Err("startup unavailable".into())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// Debug builds back the end-to-end tests, which must not register themselves.
    available: bool,
    enabled: bool,
}

#[tauri::command]
pub fn startup_status(window: WebviewWindow) -> Result<StartupStatus, String> {
    if window.label() != "main" {
        return Err("startup refused".into());
    }
    let available = cfg!(windows) && !cfg!(debug_assertions);
    Ok(StartupStatus {
        available,
        enabled: available && registered(),
    })
}

#[tauri::command]
pub fn startup_set(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    if window.label() != "main" || cfg!(debug_assertions) {
        return Err("startup refused".into());
    }
    register(enabled)
}
