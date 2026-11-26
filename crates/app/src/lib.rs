pub mod authenticator;
mod bridge;
pub mod connector;
mod favicon;
pub mod locale;
pub mod startup;
mod vault;

pub use bridge::PairingRequest;

use bridge::Bridge;
use cairn_vault::{Vault, VaultError};
use locale::Languages;
use std::{
    path::Path,
    sync::{Arc, Mutex, atomic::AtomicBool},
};
use tokio::{runtime::Handle, sync::mpsc};

pub enum AppEvent {
    VaultLocked,
    VaultChanged,
    PairingRequested(PairingRequest),
    PairingConflict,
}

#[derive(Clone)]
pub struct App {
    state: Arc<State>,
    runtime: Handle,
}

struct State {
    vault: Mutex<Vault>,
    hidden: AtomicBool,
    bridge: Bridge,
    languages: Languages,
    downloads: tokio::sync::Mutex<()>,
    events: mpsc::UnboundedSender<AppEvent>,
}

impl App {
    /// The caller enables Tokio time and I/O and shuts down the runtime when the app exits.
    pub fn open(
        directory: &Path,
        runtime: Handle,
    ) -> Result<(Self, mpsc::UnboundedReceiver<AppEvent>), VaultError> {
        let languages = Languages::load(directory);
        let vault = Vault::open(directory)?;
        let (events, receiver) = mpsc::unbounded_channel();
        let app = Self {
            state: Arc::new(State {
                vault: Mutex::new(vault),
                hidden: AtomicBool::new(false),
                bridge: Bridge::default(),
                languages,
                downloads: tokio::sync::Mutex::new(()),
                events,
            }),
            runtime,
        };
        app.start_lock_timer();
        Ok((app, receiver))
    }

    fn emit(&self, event: AppEvent) {
        let _ = self.state.events.send(event);
    }
}
