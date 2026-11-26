use std::{sync::Arc, time::Duration};

use rune::{AppHandle, Tray, TrayError, TrayEvent, TrayIcon, TrayItem, TraySpec};
use tokio::runtime::Handle;

use crate::{app::State, i18n::t};

const MARKS: [(u32, &[u8], &[u8]); 4] = [
    (
        16,
        include_bytes!("../icons/mark/black-16.png"),
        include_bytes!("../icons/mark/white-16.png"),
    ),
    (
        24,
        include_bytes!("../icons/mark/black-24.png"),
        include_bytes!("../icons/mark/white-24.png"),
    ),
    (
        32,
        include_bytes!("../icons/mark/black-32.png"),
        include_bytes!("../icons/mark/white-32.png"),
    ),
    (
        64,
        include_bytes!("../icons/mark/black-64.png"),
        include_bytes!("../icons/mark/white-64.png"),
    ),
];

fn appearance() -> (bool, usize) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::{
            HiDpi::{GetDpiForSystem, GetDpiForWindow},
            WindowsAndMessaging::FindWindowW,
        };
        let dpi = unsafe {
            let taskbar = FindWindowW(windows_sys::w!("Shell_TrayWnd"), std::ptr::null());
            if taskbar.is_null() {
                GetDpiForSystem()
            } else {
                GetDpiForWindow(taskbar)
            }
        };
        let light = windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
            .and_then(|key| key.get_u32("SystemUsesLightTheme"))
            .is_ok_and(|value| value != 0);
        let size = (16 * dpi).div_ceil(96);
        let mark = MARKS
            .iter()
            .position(|(width, ..)| *width >= size)
            .unwrap_or(MARKS.len() - 1);
        (light, mark)
    }
    #[cfg(not(windows))]
    {
        (false, 0)
    }
}

fn icon((light, index): (bool, usize)) -> TrayIcon {
    let (size, black, white) = MARKS[index];
    let bytes = if light { black } else { white };
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
    let mut current = appearance();
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
            let next = appearance();
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
