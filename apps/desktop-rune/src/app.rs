use std::{path::Path, time::Duration};

use cairn_app::{App as Core, AppEvent};
use cairn_vault::{VaultError, VaultStatus};
use rune::{App, AppSpec, Cx, El, Tx, col};
use tokio::{
    runtime::{Handle, Runtime},
    sync::{mpsc, oneshot},
};
use zeroize::Zeroizing;

use crate::{i18n::t, lock, theme, title_bar};

pub struct State {
    core: Option<Core>,
    events: Option<mpsc::UnboundedReceiver<AppEvent>>,
    runtime: Handle,
    pub status: Result<VaultStatus, VaultError>,
    pub form: lock::Form,
    pending: Option<Pending>,
    hidden: bool,
    pub caption_font: Option<&'static str>,
}

struct Pending {
    result: oneshot::Receiver<(Result<(), VaultError>, Result<VaultStatus, VaultError>)>,
    cancelled: bool,
}

impl State {
    pub fn new(
        directory: &Path,
        runtime: &Runtime,
        hidden: bool,
        caption_font: Option<&'static str>,
    ) -> Self {
        let (core, events, status) = match Core::open(directory, runtime.handle().clone()) {
            Ok((core, events)) => {
                let status = runtime.block_on(core.vault_status());
                core.set_hidden(hidden);
                (Some(core), Some(events), status)
            }
            Err(error) => (None, None, Err(error)),
        };
        Self {
            core,
            events,
            runtime: runtime.handle().clone(),
            status,
            form: lock::Form::default(),
            pending: None,
            hidden,
            caption_font,
        }
    }

    pub fn core(&self) -> Option<&Core> {
        self.core.as_ref()
    }

    pub fn busy(&self) -> bool {
        self.pending.is_some()
    }

    pub fn authenticate(&mut self, password: Zeroizing<String>, tx: &mut Tx) {
        let Some(core) = self.core.clone() else {
            return;
        };
        let create = self.status == Ok(VaultStatus::Missing);
        let (sender, result) = oneshot::channel();
        self.runtime.spawn(async move {
            let operation = if create {
                core.create_vault(password).await
            } else {
                core.unlock_vault(password).await
            };
            let status = core.vault_status().await;
            let _ = sender.send((operation, status));
        });
        self.pending = Some(Pending {
            result,
            cancelled: false,
        });
        tx.wake_after(Duration::from_millis(20));
    }

    pub fn retry(&mut self, tx: &mut Tx) {
        if let Some(core) = &self.core {
            self.status = self.runtime.block_on(core.vault_status());
            self.focus_master(tx);
        }
    }

    pub fn focus_master(&self, tx: &mut Tx) {
        if matches!(self.status, Ok(VaultStatus::Missing | VaultStatus::Locked)) && !self.busy() {
            if self.hidden {
                tx.focus_when_shown("master", false);
            } else {
                tx.focus("master", false);
            }
        }
    }

    pub fn lock(&mut self, tx: &mut Tx) {
        if let Some(core) = &self.core {
            if let Some(pending) = &mut self.pending {
                pending.cancelled = true;
                core.set_hidden(true);
            }
            core.lock_now();
        }
        if self.status == Ok(VaultStatus::Unlocked) {
            self.status = Ok(VaultStatus::Locked);
        }
        self.form = lock::Form::default();
        tx.clear_secret_clipboard();
        self.focus_master(tx);
    }

    pub fn close(&mut self, tx: &mut Tx) {
        self.hidden = true;
        if let Some(core) = &self.core {
            core.set_hidden(true);
        }
        self.lock(tx);
    }

    pub fn restore(&mut self, tx: &mut Tx) {
        if self.hidden {
            self.hidden = false;
            if !self.busy()
                && let Some(core) = &self.core
            {
                core.set_hidden(false);
                self.status = self.runtime.block_on(core.vault_status());
            }
            self.focus_master(tx);
        }
    }

    fn poll(&mut self, _: f64, tx: &mut Tx) -> bool {
        let mut changed = false;
        if let Some(events) = &mut self.events {
            while let Ok(event) = events.try_recv() {
                if matches!(event, AppEvent::VaultLocked)
                    && self.status == Ok(VaultStatus::Unlocked)
                {
                    self.status = Ok(VaultStatus::Locked);
                    self.form = lock::Form::default();
                    tx.clear_secret_clipboard();
                    changed = true;
                }
            }
        }
        if let Some(pending) = &mut self.pending {
            use oneshot::error::TryRecvError;
            match pending.result.try_recv() {
                Err(TryRecvError::Empty) => tx.wake_after(Duration::from_millis(20)),
                result => {
                    let cancelled = pending.cancelled;
                    self.pending = None;
                    if cancelled {
                        if let Some(core) = &self.core {
                            core.lock_now();
                            if !self.hidden {
                                core.set_hidden(false);
                                self.status = self.runtime.block_on(core.vault_status());
                            }
                        }
                    } else {
                        let (operation, status) =
                            result.unwrap_or((Err(VaultError::Storage), Err(VaultError::Storage)));
                        self.status = status;
                        self.form.error = operation.err().map(lock::AuthError::Vault);
                    }
                    changed = true;
                }
            }
        }
        if self.status == Ok(VaultStatus::Unlocked) {
            tx.wake_after(Duration::from_millis(250));
        }
        if changed {
            self.focus_master(tx);
        }
        changed
    }
}

pub fn build(state: State) -> App<State> {
    let custom_controls = state.caption_font.is_some();
    App::new(AppSpec {
        min_size: Some((600.0, 480.0)),
        families: ("Segoe UI Variable, Segoe UI", "Consolas"),
        poll: Some(State::poll),
        ..AppSpec::new(t!("app.name"), (920.0, 640.0), || unreachable!(), view)
    })
    .init(move || state)
    .titlebar(rune::Titlebar::new(title_bar::HEIGHT).controls(!custom_controls))
    .on_close(State::close)
    .on_quit(State::close)
    .on_reopen(|state, _, tx| {
        state.restore(tx);
        false
    })
    .on_focus(|state, focused, tx| {
        if focused {
            state.restore(tx);
        }
    })
}

fn view(state: &State, cx: &mut Cx<State>) -> El {
    let kit = theme::kit(cx.system_dark());
    let body = match state.status {
        Ok(VaultStatus::Unlocked) => lock::workspace(&kit).key("workspace"),
        Ok(VaultStatus::Recovery) => lock::recovery(&kit).key("recovery"),
        Ok(VaultStatus::Missing | VaultStatus::Locked) => {
            lock::view(state, &kit).key("lock-screen")
        }
        Err(error) => lock::unavailable(error, &kit).key("unavailable"),
    };
    col()
        .key("root")
        .w_full()
        .h_full()
        .fill(kit.c.page)
        .child(title_bar::view(state, cx, &kit))
        .child(body)
}
