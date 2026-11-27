use serde::Serialize;

/// Windows passes this to the copy it starts at sign-in, which stays in the tray.
pub const FLAG: &str = "--autostart";

pub fn launched_at_sign_in() -> bool {
    std::env::args().skip(1).any(|argument| argument == FLAG)
}

// The uninstaller removes the Run value named Cairn.
#[cfg(windows)]
const AUTOSTART: winshell::Autostart = winshell::Autostart::new("Cairn").args(FLAG);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupStatus {
    /// Debug builds back the end-to-end tests, which must not register themselves.
    pub available: bool,
    pub enabled: bool,
}

pub fn startup_status() -> StartupStatus {
    let available = cfg!(windows) && !cfg!(debug_assertions);
    #[cfg(windows)]
    let enabled = available && AUTOSTART.enabled();
    #[cfg(not(windows))]
    let enabled = false;
    StartupStatus { available, enabled }
}

pub fn startup_set(enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("startup refused".into());
    }
    #[cfg(windows)]
    {
        AUTOSTART
            .set(enabled)
            .map_err(|_| "startup not saved".into())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("startup unavailable".into())
    }
}
