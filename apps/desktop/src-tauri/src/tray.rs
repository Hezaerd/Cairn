use crate::locale::{Languages, Locale};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{
    Emitter, Manager,
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

#[derive(Default, Clone)]
pub(crate) struct Hidden(Arc<AtomicBool>);

impl Hidden {
    pub fn get(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

pub fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.show().is_err() {
            return;
        }
        app.state::<Hidden>().0.store(false, Ordering::SeqCst);
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn lock(app: &tauri::AppHandle) {
    let store = app.state::<crate::vault::Store>();
    // Even a poisoned store must drop its session before the window is hidden.
    let mut vault = store.lock().unwrap_or_else(|error| error.into_inner());
    let expired = vault.expire();
    let unlocked = matches!(vault.status(), Ok(cairn_vault::VaultStatus::Unlocked));
    vault.lock();
    if expired || unlocked {
        let _ = app.emit_to("main", "vault-locked", ());
    }
}

pub fn hide(app: &tauri::AppHandle) {
    // Reject queued vault IPC before waiting for any active operation to finish.
    app.state::<Hidden>().0.store(true, Ordering::SeqCst);
    lock(app);
    if let Some(window) = app.get_webview_window("main") {
        if window.hide().is_err() {
            app.state::<Hidden>().0.store(false, Ordering::SeqCst);
        }
    }
}

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(Hidden::default());
    let [open, lock, quit] = labels(app.state::<Languages>().language().locale);
    let open = MenuItem::with_id(app, "open", open, true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", lock, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &quit])?;
    app.manage(Items([open, lock, quit]));
    let mut tray = TrayIconBuilder::with_id("cairn")
        .tooltip("Cairn")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => restore(app),
            "lock" => self::lock(app),
            "quit" => {
                self::lock(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}
