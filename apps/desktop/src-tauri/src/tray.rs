use cairn_app::{App, locale::Locale};
use std::sync::Mutex;
use tauri::{
    Manager,
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// The menu items whose labels follow the language chosen in the settings.
struct Items([MenuItem<tauri::Wry>; 3]);

fn labels(locale: Locale) -> [&'static str; 3] {
    match locale {
        Locale::EnUs => ["Open Cairn", "Lock vault", "Quit"],
        Locale::FrFr => ["Ouvrir Cairn", "Verrouiller le coffre", "Quitter"],
    }
}

pub fn translate(app: &tauri::AppHandle, locale: Locale) {
    if let Some(items) = app.try_state::<Items>() {
        for (item, label) in items.0.iter().zip(labels(locale)) {
            let _ = item.set_text(label);
        }
    }
}

/// The bare mark at each tray size, black for a light taskbar and white for a dark one.
const MARKS: [(u32, &[u8], &[u8]); 3] = [
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
];

/// The taskbar theme and size of the mark the tray shows.
#[derive(Default)]
struct Mark(Mutex<Option<(bool, u32)>>);

/// The taskbar follows the Windows mode, which can differ from the app mode.
fn light_taskbar() -> bool {
    #[cfg(windows)]
    {
        windows_registry::CURRENT_USER
            .open(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
            .and_then(|key| key.get_u32("SystemUsesLightTheme"))
            .is_ok_and(|value| value != 0)
    }
    #[cfg(not(windows))]
    false
}

fn mark(app: &tauri::AppHandle) -> ((bool, u32), &'static [u8]) {
    let scale = app
        .get_webview_window("main")
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let (size, black, white) = MARKS
        .iter()
        .find(|(size, ..)| f64::from(*size) >= 16.0 * scale)
        .unwrap_or(&MARKS[MARKS.len() - 1]);
    let light = light_taskbar();
    ((light, *size), if light { black } else { white })
}

/// Swaps the tray mark when the taskbar theme or the display scale changed.
pub fn refresh_icon(app: &tauri::AppHandle) {
    let (key, bytes) = mark(app);
    let state = app.state::<Mark>();
    let mut current = state.0.lock().unwrap_or_else(|error| error.into_inner());
    if *current == Some(key) {
        return;
    }
    if let (Some(tray), Ok(icon)) = (app.tray_by_id("cairn"), Image::from_bytes(bytes))
        && tray.set_icon(Some(icon)).is_ok()
    {
        *current = Some(key);
    }
}

pub fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.show().is_err() {
            return;
        }
        app.state::<App>().set_hidden(false);
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide(app: &tauri::AppHandle) {
    // Reject queued vault IPC before waiting for any active operation to finish.
    let cairn = app.state::<App>();
    cairn.set_hidden(true);
    cairn.lock_now();
    if let Some(window) = app.get_webview_window("main") {
        if window.hide().is_err() {
            cairn.set_hidden(false);
        }
    }
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let (key, bytes) = mark(app.handle());
    app.manage(Mark(Mutex::new(Some(key))));
    let [open, lock, quit] = labels(app.state::<App>().language().locale);
    let open = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", lock, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &quit])?;
    app.manage(Items([open, lock, quit]));
    TrayIconBuilder::with_id("cairn")
        .icon(Image::from_bytes(bytes)?)
        .tooltip("Cairn")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => restore(app),
            "lock" => app.state::<App>().lock_now(),
            "quit" => {
                app.state::<App>().lock_now();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => restore(tray.app_handle()),
            // The taskbar mode can change without a theme event to the window.
            TrayIconEvent::Enter { .. } => refresh_icon(tray.app_handle()),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
