#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

mod app;
mod generator;
mod i18n;
mod lock;
mod site_icon;
mod theme;
mod title_bar;
mod tray;
mod vault;

#[cfg(test)]
mod verify;

use std::{io, path::PathBuf};

use cairn_app::{locale::Locale, startup};

fn data_directory() -> io::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(directory) = std::env::var_os("CAIRN_TEST_DATA_DIR") {
        return Ok(PathBuf::from(directory));
    }
    dirs::data_local_dir()
        .map(|directory| directory.join("com.hezaerd.cairn"))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Windows local app data"))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let headless = cfg!(debug_assertions)
        && std::env::args().skip(1).any(|arg| {
            matches!(
                arg.as_str(),
                "--snap" | "--tree" | "--script" | "--list-scenes"
            )
        });
    if !headless && !rune::single_instance("com.hezaerd.cairn") {
        return Ok(());
    }
    let hidden = !headless && startup::launched_at_sign_in();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()?;
    let directory = data_directory()?;
    let state = app::State::new(&directory, &runtime, hidden, title_bar::load_font());
    i18n::set_locale(
        state
            .core()
            .map_or_else(Locale::detect, |app| app.language().locale),
    );
    if !headless && let Some(app) = state.core() {
        app.start_bridge(env!("CARGO_PKG_VERSION"));
    }
    let mut shell = app::build(state);
    let _tray = if headless {
        None
    } else {
        shell = if hidden {
            shell.windowless()
        } else {
            shell.keep_running()
        };
        let handle = shell.handle();
        let tray = tray::install(handle.clone(), runtime.handle())?;
        shell = shell.on_ready(move |_| handle.update(|state, tx| state.focus_master(tx)));
        Some(tray)
    };
    shell.try_run()?;
    Ok(())
}
