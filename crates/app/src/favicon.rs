use crate::App;
use base64::{Engine, engine::general_purpose::STANDARD};
use cairn_vault::{FaviconLookup, VaultError};
use std::time::Duration;

impl App {
    pub async fn favicon_cached(&self, id: String) -> Result<Option<FaviconLookup>, VaultError> {
        self.with_vault(move |vault| vault.favicon_lookup(&id, None))
            .await
    }

    async fn until_locked(&self, session: &str) {
        loop {
            {
                if let Ok(mut vault) = self.state.vault.try_lock() {
                    self.expire(&mut vault);
                    if !vault.favicon_session(session) {
                        return;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Run on a Tokio runtime with time and I/O enabled.
    pub async fn favicon_refresh(
        &self,
        id: String,
        session: String,
    ) -> Result<Option<String>, VaultError> {
        let work = async {
            let _permit = self.state.downloads.lock().await;
            let entry_id = id.clone();
            let token = session.clone();
            let Some(cached) = self
                .with_vault(move |vault| vault.favicon_lookup(&entry_id, Some(&token)))
                .await?
            else {
                return Ok(None);
            };
            if !cached.stale {
                return Ok(cached.image);
            }
            let image = cairn_favicon::fetch(&cached.origin)
                .await
                .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)));
            self.with_vault(move |vault| vault.favicon_store(&id, &cached.session, image))
                .await
        };
        tokio::select! {
            biased;
            _ = self.until_locked(&session) => Err(VaultError::Locked),
            result = work => result,
        }
    }
}
