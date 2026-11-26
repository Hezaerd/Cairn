use crate::{App, AppEvent};
use cairn_vault::{
    EntrySecret, EntrySummary, EntryUpdate, NewEntry, Vault, VaultError, VaultStatus,
};
use std::sync::atomic::Ordering;
use std::time::Duration;
use zeroize::Zeroizing;

impl App {
    pub(crate) fn start_lock_timer(&self) {
        let app = self.clone();
        self.runtime.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                if let Ok(mut vault) = app.state.vault.try_lock() {
                    app.expire(&mut vault);
                }
            }
        });
    }

    pub(crate) fn expire(&self, vault: &mut Vault) {
        if vault.expire() {
            self.emit(AppEvent::VaultLocked);
        }
    }

    pub fn set_hidden(&self, hidden: bool) {
        self.state.hidden.store(hidden, Ordering::SeqCst);
    }

    pub(crate) fn hidden(&self) -> bool {
        self.state.hidden.load(Ordering::SeqCst)
    }

    pub fn lock_now(&self) {
        let mut vault = self
            .state
            .vault
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let expired = vault.expire();
        let unlocked = matches!(vault.status(), Ok(VaultStatus::Unlocked));
        vault.lock();
        if expired || unlocked {
            self.emit(AppEvent::VaultLocked);
        }
    }

    pub(crate) async fn with_vault<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut Vault) -> Result<T, VaultError> + Send + 'static,
    ) -> Result<T, VaultError> {
        let app = self.clone();
        self.runtime
            .spawn_blocking(move || {
                let mut vault = app.state.vault.lock().map_err(|_| VaultError::Storage)?;
                if app.hidden() {
                    return Err(VaultError::Locked);
                }
                let expired = vault.expire();
                let was_unlocked = vault.status()? == VaultStatus::Unlocked;
                let result = operation(&mut vault);
                if expired
                    || (result.is_ok() && was_unlocked && vault.status()? != VaultStatus::Unlocked)
                {
                    app.emit(AppEvent::VaultLocked);
                }
                result
            })
            .await
            .map_err(|_| VaultError::Storage)?
    }

    pub async fn vault_status(&self) -> Result<VaultStatus, VaultError> {
        self.with_vault(Vault::status).await
    }

    pub async fn create_vault(&self, password: Zeroizing<String>) -> Result<(), VaultError> {
        self.with_vault(move |vault| vault.create(password)).await
    }

    pub async fn unlock_vault(&self, password: Zeroizing<String>) -> Result<(), VaultError> {
        self.with_vault(move |vault| vault.unlock(password)).await
    }

    pub async fn lock_vault(&self) -> Result<(), VaultError> {
        self.with_vault(|vault| {
            vault.lock();
            Ok(())
        })
        .await
    }

    pub async fn list_entries(&self) -> Result<Vec<EntrySummary>, VaultError> {
        // Window commands come from a person using Cairn, so they count as activity.
        self.with_vault(|vault| {
            vault.touch()?;
            vault.list()
        })
        .await
    }

    pub async fn save_entry(&self, entry: NewEntry) -> Result<(), VaultError> {
        self.with_vault(move |vault| locking_on_error(vault, |vault| vault.save(entry)))
            .await
    }

    pub async fn update_entry(&self, id: String, entry: EntryUpdate) -> Result<(), VaultError> {
        self.with_vault(move |vault| locking_on_error(vault, |vault| vault.update(&id, entry)))
            .await
    }

    pub async fn delete_entry(&self, id: String) -> Result<(), VaultError> {
        self.with_vault(move |vault| locking_on_error(vault, |vault| vault.delete(&id)))
            .await
    }

    pub async fn reveal_password(&self, id: String) -> Result<EntrySecret, VaultError> {
        self.with_vault(move |vault| {
            vault.touch()?;
            vault.reveal(&id)
        })
        .await
    }
}

/// A failed change makes the desktop reload from disk, so the list never shows unsaved state.
/// Invalid input is refused before anything is written, and keeps the session: a mistyped
/// field shouldn't lock the vault. A failed write has already locked it.
pub(crate) fn locking_on_error(
    vault: &mut Vault,
    change: impl FnOnce(&mut Vault) -> Result<(), VaultError>,
) -> Result<(), VaultError> {
    let result = change(vault);
    if result.is_err_and(|error| error != VaultError::InvalidInput) {
        vault.lock();
    }
    result
}
