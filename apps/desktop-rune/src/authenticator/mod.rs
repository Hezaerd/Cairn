mod dialog;
mod view;

#[cfg(test)]
mod tests;

use std::{
    future::Future,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use cairn_app::App;
use cairn_vault::{EntrySummary, TotpCode, VaultError};
use rune::{SecretCopy, SecretState, TextEdit, Tx};
use tokio::{runtime::Handle, sync::oneshot};

use crate::{
    app::State,
    i18n::{t, vault_error},
};

pub use view::{add_button, view};

#[derive(Default)]
pub struct Screen {
    open: bool,
    entries: Vec<EntrySummary>,
    loaded: bool,
    query: TextEdit,
    selected: Option<String>,
    current: Option<Current>,
    dialog: Option<dialog::Dialog>,
    saving: Option<oneshot::Receiver<Result<Option<usize>, VaultError>>>,
    copying: Option<SecretCopy>,
    notice: Option<(String, f64)>,
}

struct Current {
    id: String,
    value: TotpCode,
    expires: f64,
    seconds: u32,
}

impl Screen {
    pub fn is_open(&self) -> bool {
        self.open
    }

    pub fn set_open(&mut self, open: bool) {
        self.open = open;
        self.invalidate();
        self.notice = None;
    }

    pub fn invalidate(&mut self) {
        self.loaded = false;
        self.current = None;
    }

    fn visible_entries(&self) -> impl Iterator<Item = &EntrySummary> {
        let query = self.query.text.to_lowercase();
        self.entries.iter().filter(move |entry| {
            entry.has_totp
                && [&entry.name, &entry.username, &entry.site]
                    .iter()
                    .any(|value| value.to_lowercase().contains(&query))
        })
    }

    fn selected_entry(&self) -> Option<&EntrySummary> {
        self.visible_entries()
            .find(|entry| Some(&entry.id) == self.selected.as_ref())
            .or_else(|| self.visible_entries().next())
    }

    pub fn poll(&mut self, core: &App, runtime: &Handle, clock: f64, tx: &mut Tx) -> bool {
        if !self.open {
            return false;
        }

        let mut changed = false;
        if let Some(saving) = &mut self.saving {
            match saving.try_recv() {
                Err(oneshot::error::TryRecvError::Empty) => {
                    tx.wake_after(Duration::from_millis(20));
                    return false;
                }
                result => {
                    self.saving = None;
                    match result.unwrap_or(Err(VaultError::Storage)) {
                        Ok(count) => {
                            self.invalidate();
                            if let Some(count) = count {
                                self.query.clear();
                                self.notice = Some((dialog::added(count), clock + 3.0));
                            }
                        }
                        Err(error) => self.notice = Some((vault_error(error).into(), clock + 4.0)),
                    }
                    changed = true;
                }
            }
        }
        if !self.loaded {
            match runtime.block_on(core.list_entries()) {
                Ok(mut entries) => {
                    entries.sort_by_cached_key(|entry| entry.name.to_lowercase());
                    self.entries = entries;
                }
                Err(error) => self.notice = Some((vault_error(error).into(), clock + 4.0)),
            }
            self.loaded = true;
            changed = true;
        }
        changed |= dialog::poll(self, tx);

        if let Some(copy) = &self.copying {
            let message = match copy.state() {
                SecretState::Pending => {
                    tx.wake_after(Duration::from_millis(20));
                    None
                }
                SecretState::Holding => Some(t!("credentials.codeCopied")),
                _ => Some(t!("credentials.copyFailed")),
            };
            if let Some(message) = message {
                self.copying = None;
                self.notice = Some((message.into(), clock + 3.0));
                changed = true;
            }
        }
        if self
            .notice
            .as_ref()
            .is_some_and(|(_, until)| clock >= *until)
        {
            self.notice = None;
            changed = true;
        }

        changed | self.tick(core, runtime, clock)
    }

    fn tick(&mut self, core: &App, runtime: &Handle, clock: f64) -> bool {
        let Some(id) = self.selected_entry().map(|entry| entry.id.clone()) else {
            return self.current.take().is_some();
        };
        if let Some(current) = &mut self.current
            && current.id == id
            && current.expires > clock
        {
            let seconds = (current.expires - clock).ceil() as u32;
            return std::mem::replace(&mut current.seconds, seconds) != seconds;
        }

        self.current = runtime
            .block_on(core.totp_code(id.clone()))
            .ok()
            .map(|value| {
                let within_second = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0.0, |time| f64::from(time.subsec_nanos()) / 1e9);
                Current {
                    id,
                    seconds: value.remaining,
                    expires: clock + f64::from(value.remaining) - within_second,
                    value,
                }
            });
        self.current.is_some()
    }
}

fn copy(state: &mut State, tx: &mut Tx) {
    let Some(entry) = state.authenticator.selected_entry() else {
        return;
    };
    if let Some(core) = state.core()
        && let Ok(mut value) = state.runtime.block_on(core.totp_code(entry.id.clone()))
    {
        state.authenticator.copying =
            Some(tx.copy_secret(std::mem::take(&mut value.code), Duration::from_secs(30)));
        tx.wake_after(Duration::from_millis(20));
    } else {
        state.authenticator.invalidate();
    }
}

fn task<T: Send + 'static>(
    runtime: &Handle,
    work: impl Future<Output = T> + Send + 'static,
    tx: &mut Tx,
) -> oneshot::Receiver<T> {
    let (sender, receiver) = oneshot::channel();
    runtime.spawn(async move {
        let _ = sender.send(work.await);
    });
    tx.wake_after(Duration::from_millis(20));
    receiver
}
