use cairn_vault::{EntrySecret, EntrySummary, NewEntry, Vault, VaultError, VaultStatus};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewWindow};
use zeroize::Zeroizing;

pub(crate) type Store = Arc<Mutex<Vault>>;

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_local_data_dir()?;
    // Isolated native-app tests must never create or open the user's real vault.
    // Release builds always use Tauri's per-user application directory.
    #[cfg(debug_assertions)]
    let directory = std::env::var_os("CAIRN_TEST_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(directory);
    let store = Arc::new(Mutex::new(Vault::open(directory)?));
    app.manage(store.clone());
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            if let Ok(mut vault) = store.try_lock()
                && vault.expire()
            {
                let _ = handle.emit_to("main", "vault-locked", ());
            }
        }
    });
    Ok(())
}

pub(crate) async fn run<T: Send + 'static>(
    window: WebviewWindow,
    store: &Store,
    operation: impl FnOnce(&mut Vault) -> Result<T, VaultError> + Send + 'static,
) -> Result<T, VaultError> {
    if window.label() != "main" {
        return Err(VaultError::Locked);
    }
    let store = store.clone();
    let hidden = window.state::<crate::tray::Hidden>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut vault = store.lock().map_err(|_| VaultError::Storage)?;
        if hidden.get() {
            return Err(VaultError::Locked);
        }
        let expired = vault.expire();
        let was_unlocked = vault.status()? == VaultStatus::Unlocked;
        let result = operation(&mut vault);
        if expired || (result.is_ok() && was_unlocked && vault.status()? != VaultStatus::Unlocked) {
            let _ = window.emit("vault-locked", ());
        }
        result
    })
    .await
    .map_err(|_| VaultError::Storage)?
}

#[tauri::command]
pub async fn vault_status(
    window: WebviewWindow,
    store: State<'_, Store>,
) -> Result<VaultStatus, VaultError> {
    run(window, &store, Vault::status).await
}

#[tauri::command]
pub async fn create_vault(
    window: WebviewWindow,
    store: State<'_, Store>,
    password: String,
) -> Result<(), VaultError> {
    let password = Zeroizing::new(password);
    run(window, &store, move |vault| vault.create(password)).await
}

#[tauri::command]
pub async fn unlock_vault(
    window: WebviewWindow,
    store: State<'_, Store>,
    password: String,
) -> Result<(), VaultError> {
    let password = Zeroizing::new(password);
    run(window, &store, move |vault| vault.unlock(password)).await
}

#[tauri::command]
pub async fn lock_vault(window: WebviewWindow, store: State<'_, Store>) -> Result<(), VaultError> {
    run(window, &store, |vault| {
        vault.lock();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_entries(
    window: WebviewWindow,
    store: State<'_, Store>,
) -> Result<Vec<EntrySummary>, VaultError> {
    run(window, &store, Vault::list).await
}

#[tauri::command]
pub async fn save_entry(
    window: WebviewWindow,
    store: State<'_, Store>,
    entry: NewEntry,
) -> Result<(), VaultError> {
    run(window, &store, move |vault| {
        let result = vault.save(entry);
        if result.is_err() {
            vault.lock();
        }
        result
    })
    .await
}

#[tauri::command]
pub async fn reveal_password(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<EntrySecret, VaultError> {
    run(window, &store, move |vault| vault.reveal(&id)).await
}
