use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{
    Emitter, Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

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
    let open = MenuItem::with_id(app, "open", "Ouvrir Cairn", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "Verrouiller le coffre", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &lock, &quit])?;
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
