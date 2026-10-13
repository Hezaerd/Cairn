use crate::vault::{Store, run};
use base64::{Engine, engine::general_purpose::STANDARD};
use cairn_vault::{FaviconLookup, VaultError};
use std::time::Duration;
use tauri::{Emitter, State, WebviewWindow};

// Serializing refreshes bounds network load and coalesces duplicate origins:
// each waiter checks the cache again after acquiring the gate.
#[derive(Default)]
pub(crate) struct Downloads(tokio::sync::Mutex<()>);

#[tauri::command]
pub async fn favicon_cached(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<Option<FaviconLookup>, VaultError> {
    run(window, &store, move |vault| vault.favicon_lookup(&id, None)).await
}

async fn until_locked(store: &Store, window: &WebviewWindow, session: &str) {
    loop {
        {
            if let Ok(mut vault) = store.try_lock() {
                if vault.expire() {
                    let _ = window.emit("vault-locked", ());
                }
                if !vault.favicon_session(session) {
                    return;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[tauri::command]
pub async fn favicon_refresh(
    window: WebviewWindow,
    store: State<'_, Store>,
    downloads: State<'_, Downloads>,
    id: String,
    session: String,
) -> Result<Option<String>, VaultError> {
    if window.label() != "main" {
        return Err(VaultError::Locked);
    }
    let work = async {
        let _permit = downloads.0.lock().await;
        let entry_id = id.clone();
        let token = session.clone();
        let Some(cached) = run(window.clone(), &store, move |vault| {
            vault.favicon_lookup(&entry_id, Some(&token))
        })
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
        run(window.clone(), &store, move |vault| {
            vault.favicon_store(&id, &cached.session, image)
        })
        .await
    };
    tokio::select! {
        biased;
        _ = until_locked(&store, &window, &session) => Err(VaultError::Locked),
        result = work => result,
    }
}
