//! Answers the browser extension through the native host. Status and
//! challenges are public; pairing needs your approval in this window; logins
//! need a paired browser's signature and an unlocked vault.
mod auth;
mod sites;

use crate::vault::{Store, run};
use cairn_protocol::{
    ErrorCode, LoginSummary, MAX_MESSAGE_BYTES, Request, Response, VERSION, signed_message,
};
use cairn_vault::{BrowserSummary, Vault, VaultError, VaultStatus};
use serde::Serialize;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use zeroize::Zeroizing;

const PAIRING_LIFETIME: Duration = Duration::from_secs(120);
const MAX_LOGINS: usize = 20;

struct Pending {
    client_id: String,
    public_key: String,
    request: PairingRequest,
    created: Instant,
}

#[derive(Clone, Serialize)]
pub struct PairingRequest {
    name: String,
    code: String,
}

#[derive(Default)]
pub(crate) struct Bridge {
    challenges: auth::Challenges,
    pending: Mutex<Option<Pending>>,
}

pub fn start(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Arc::new(Bridge::default()));
    let runtime = tauri::async_runtime::handle();
    // Pipe construction requires an entered Tokio reactor.
    let server = runtime.block_on(async { cairn_local_bridge::BridgeServer::bind() })?;
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let handler = move |request| {
            let handle = handle.clone();
            async move {
                tauri::async_runtime::spawn_blocking(move || answer(&handle, request))
                    .await
                    .unwrap_or_else(|_| Response::error(None, ErrorCode::AppUnavailable))
            }
        };
        if let Err(error) = server.run(handler).await {
            eprintln!("Cairn bridge stopped: {error}");
        }
    });
    Ok(())
}

fn answer(app: &AppHandle, request: Request) -> Response {
    let id = request.id().to_owned();
    let bridge = app.state::<Arc<Bridge>>();
    let result = match &request {
        Request::GetStatus { .. } => return Response::status(&request, env!("CARGO_PKG_VERSION")),
        Request::GetChallenge { .. } => bridge
            .challenges
            .issue()
            .map(|challenge| Response::Challenge {
                version: VERSION,
                request_id: id.clone(),
                challenge,
            })
            .ok_or(ErrorCode::AppUnavailable),
        Request::Pair {
            public_key, name, ..
        } => pair(app, &bridge, public_key, name).map(|()| Response::PairingRequested {
            version: VERSION,
            request_id: id.clone(),
        }),
        Request::ListLogins { .. } | Request::GetLogin { .. } => {
            authenticated(app, &bridge, &request)
        }
    };
    result.unwrap_or_else(|code| Response::error(Some(id), code))
}

/// Runs `operation` on the unlocked vault. The vault counts as locked while
/// Cairn is hidden in the tray.
fn with_vault<T>(
    app: &AppHandle,
    operation: impl FnOnce(&mut Vault) -> Result<T, ErrorCode>,
) -> Result<T, ErrorCode> {
    let store = app.state::<Store>();
    let mut vault = store.lock().map_err(|_| ErrorCode::AppUnavailable)?;
    if vault.expire() {
        let _ = app.emit_to("main", "vault-locked", ());
    }
    if app.state::<crate::tray::Hidden>().get()
        || !matches!(vault.status(), Ok(VaultStatus::Unlocked))
    {
        return Err(ErrorCode::VaultLocked);
    }
    operation(&mut vault)
}

fn pair(app: &AppHandle, bridge: &Bridge, public_key: &str, name: &str) -> Result<(), ErrorCode> {
    let (Some(client_id), Some(code)) =
        (auth::client_id(public_key), auth::pairing_code(public_key))
    else {
        return Err(ErrorCode::InvalidRequest);
    };
    with_vault(app, |_| Ok(()))?;
    let request = PairingRequest {
        name: name.trim().to_owned(),
        code,
    };
    // Only the latest request waits for an answer.
    *bridge
        .pending
        .lock()
        .map_err(|_| ErrorCode::AppUnavailable)? = Some(Pending {
        client_id,
        public_key: public_key.to_owned(),
        request: request.clone(),
        created: Instant::now(),
    });
    crate::tray::restore(app);
    let _ = app.emit_to("main", "pairing-requested", request);
    Ok(())
}

fn authenticated(
    app: &AppHandle,
    bridge: &Bridge,
    request: &Request,
) -> Result<Response, ErrorCode> {
    let (Some(auth), Some(message)) = (request.auth(), signed_message(request)) else {
        return Err(ErrorCode::InvalidRequest);
    };
    let (Request::ListLogins { origin, .. } | Request::GetLogin { origin, .. }) = request else {
        return Err(ErrorCode::InvalidRequest);
    };
    let origin = sites::parse_origin(origin).ok_or(ErrorCode::InvalidRequest)?;
    if !bridge.challenges.take(auth.challenge) {
        return Err(ErrorCode::Unauthorized);
    }
    with_vault(app, |vault| {
        let key = vault
            .browser_key(auth.client_id)
            .map_err(|_| ErrorCode::VaultLocked)?
            .ok_or(ErrorCode::NotPaired)?;
        if !auth::verify(&key, &message, auth.signature) {
            return Err(ErrorCode::Unauthorized);
        }
        match request {
            Request::ListLogins { request_id, .. } => {
                let mut logins: Vec<_> = vault
                    .list()
                    .map_err(|_| ErrorCode::VaultLocked)?
                    .into_iter()
                    .filter(|entry| sites::matches(&entry.site, &origin))
                    .map(|entry| LoginSummary {
                        id: entry.id,
                        name: entry.name,
                        username: entry.username,
                    })
                    .collect();
                logins.sort_by_key(|login| login.name.to_lowercase());
                logins.truncate(MAX_LOGINS);
                let mut response = Response::Logins {
                    version: VERSION,
                    request_id: request_id.clone(),
                    logins,
                };
                // Long names and usernames could overflow a frame; drop the last ones.
                while serde_json::to_vec(&response).map_or(true, |b| b.len() > MAX_MESSAGE_BYTES) {
                    let Response::Logins { logins, .. } = &mut response else {
                        break;
                    };
                    if logins.pop().is_none() {
                        break;
                    }
                }
                Ok(response)
            }
            Request::GetLogin {
                request_id,
                entry_id,
                ..
            } => {
                let login = vault.login(entry_id).map_err(|error| match error {
                    VaultError::InvalidInput => ErrorCode::NotFound,
                    _ => ErrorCode::VaultLocked,
                })?;
                // A login is released only to a page on its own site.
                if !sites::matches(&login.site, &origin) {
                    return Err(ErrorCode::NotFound);
                }
                Ok(Response::Login {
                    version: VERSION,
                    request_id: request_id.clone(),
                    username: login.username.clone(),
                    password: Zeroizing::new(login.password.clone()),
                })
            }
            _ => Err(ErrorCode::InvalidRequest),
        }
    })
}

#[tauri::command]
pub fn pairing_request(bridge: State<'_, Arc<Bridge>>) -> Option<PairingRequest> {
    let mut slot = bridge.pending.lock().ok()?;
    if slot
        .as_ref()
        .is_some_and(|pending| pending.created.elapsed() >= PAIRING_LIFETIME)
    {
        *slot = None;
    }
    slot.as_ref().map(|pending| pending.request.clone())
}

/// Approves or refuses the waiting request. `code` must still be the one on
/// screen, so a newer request can't be approved by accident.
#[tauri::command]
pub async fn answer_pairing(
    window: WebviewWindow,
    store: State<'_, Store>,
    bridge: State<'_, Arc<Bridge>>,
    code: String,
    accept: bool,
) -> Result<(), VaultError> {
    let pending = {
        let mut slot = bridge.pending.lock().map_err(|_| VaultError::Storage)?;
        if !slot.as_ref().is_some_and(|pending| {
            pending.request.code == code && pending.created.elapsed() < PAIRING_LIFETIME
        }) {
            return Err(VaultError::InvalidInput);
        }
        slot.take().ok_or(VaultError::InvalidInput)?
    };
    if !accept {
        return Ok(());
    }
    run(window, &store, move |vault| {
        vault.add_browser(
            &pending.client_id,
            &pending.request.name,
            &pending.public_key,
        )
    })
    .await
}

#[tauri::command]
pub async fn list_browsers(
    window: WebviewWindow,
    store: State<'_, Store>,
) -> Result<Vec<BrowserSummary>, VaultError> {
    run(window, &store, Vault::browsers).await
}

#[tauri::command]
pub async fn remove_browser(
    window: WebviewWindow,
    store: State<'_, Store>,
    id: String,
) -> Result<(), VaultError> {
    run(window, &store, move |vault| vault.remove_browser(&id)).await
}
