use std::{sync::Arc, time::Duration};

use rune::{AppHandle, Tray, TrayError, TrayEvent, TrayIcon, TrayItem, TraySpec};
use tokio::runtime::Handle;

use crate::{app::State, i18n::t};

const WHITE_16: &[u8] = include_bytes!("../icons/mark/white-16.png");

#[cfg(windows)]
const MARKS: &[winshell::Mark] = &[
    winshell::Mark {
        px: 16,
        black: include_bytes!("../icons/mark/black-16.png"),
        white: WHITE_16,
    },
    winshell::Mark {
        px: 24,
        black: include_bytes!("../icons/mark/black-24.png"),
        white: include_bytes!("../icons/mark/white-24.png"),
    },
    winshell::Mark {
        px: 32,
        black: include_bytes!("../icons/mark/black-32.png"),
        white: include_bytes!("../icons/mark/white-32.png"),
    },
    winshell::Mark {
        px: 64,
        black: include_bytes!("../icons/mark/black-64.png"),
        white: include_bytes!("../icons/mark/white-64.png"),
    },
];

fn current_mark() -> (u32, &'static [u8]) {
    #[cfg(windows)]
    {
        winshell::Taskbar::current().mark(MARKS)
    }
    #[cfg(not(windows))]
    {
        (16, WHITE_16)
    }
}

fn icon((size, bytes): (u32, &[u8])) -> TrayIcon {
    let rgba = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
        .expect("Cairn tray mark is a PNG")
        .into_rgba8();
    TrayIcon::rgba(size, size, rgba.into_raw())
}

pub struct ShellTray {
    _tray: Arc<Tray>,
    refresh: tokio::task::JoinHandle<()>,
}

impl Drop for ShellTray {
    fn drop(&mut self) {
        self.refresh.abort();
    }
}

fn menu_labels() -> [&'static str; 3] {
    [t!("tray.open"), t!("tray.lock"), t!("tray.quit")]
}

fn menu([open, lock, quit]: [&str; 3]) -> Vec<TrayItem> {
    vec![
        TrayItem::action("open", open),
        TrayItem::action("lock", lock),
        TrayItem::action("quit", quit),
    ]
}

pub fn install(handle: AppHandle<State>, runtime: &Handle) -> Result<ShellTray, TrayError> {
    let mut current = current_mark();
    let mut labels = menu_labels();
    let spec = TraySpec::new("com.hezaerd.cairn", t!("app.name"), icon(current))
        .tooltip(t!("app.name"))
        .menu(menu(labels));
    let tray = Arc::new(Tray::new(spec, move |event| match event {
        TrayEvent::Activate { .. } => open(&handle),
        TrayEvent::Menu(id) => match id.as_str() {
            "open" => open(&handle),
            "lock" => handle.update(State::lock),
            "quit" => handle.quit(),
            _ => {}
        },
        _ => {}
    })?);
    let refresh_tray = Arc::downgrade(&tray);
    let refresh = runtime.spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            let Some(tray) = refresh_tray.upgrade() else {
                break;
            };
            let next = current_mark();
            if next != current && tray.set_icon(icon(next)).is_ok() {
                current = next;
            }
            let next_labels = menu_labels();
            if next_labels != labels {
                tray.set_menu(menu(next_labels));
                labels = next_labels;
            }
        }
    });
    Ok(ShellTray {
        _tray: tray,
        refresh,
    })
}

fn open(handle: &AppHandle<State>) {
    handle.update(State::restore);
    handle.open();
}
