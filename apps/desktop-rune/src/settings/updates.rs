use std::{sync::Arc, time::Duration};

use rune::{El, LiveRegion, Tx, col, row};
use rune_kit::{Button, ButtonVariant, Kit};
use tokio::{runtime::Handle, sync::oneshot};

use crate::{app::State, i18n::t};

use super::{card, choice, description, divider, heading, section};

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum Channel {
    #[default]
    Stable,
    Nightly,
}

impl Channel {
    fn label(self) -> &'static str {
        match self {
            Self::Stable => t!("update.stable"),
            Self::Nightly => t!("update.nightly"),
        }
    }

    fn hint(self) -> &'static str {
        match self {
            Self::Stable => t!("update.hints.stable"),
            Self::Nightly => t!("update.hints.nightly"),
        }
    }
}

pub struct Status {
    pub version: String,
    pub channel: Channel,
    pub enabled: bool,
    pub available: Option<String>,
}

#[derive(Debug)]
pub struct UpdateError;

pub trait Backend: Send + Sync + 'static {
    fn status(&self) -> Result<Status, UpdateError>;
    fn set_channel(&self, channel: Channel) -> Result<(), UpdateError>;
    fn check(&self) -> Result<Option<String>, UpdateError>;
    fn install(&self) -> Result<(), UpdateError>;
}

enum Feedback {
    Idle,
    UpToDate,
    Unreachable,
    NotSaved,
    Failed,
}

enum Completion {
    Status(Result<Status, UpdateError>),
    Checked(Result<Option<String>, UpdateError>),
    ChannelChanged(
        Channel,
        Result<Option<Result<Option<String>, UpdateError>>, UpdateError>,
    ),
    Installed(Result<(), UpdateError>),
}

enum Action {
    Load,
    Check,
    SetChannel(Channel),
    Install,
}

#[derive(Default)]
pub struct Updates {
    backend: Option<Arc<dyn Backend>>,
    status: Option<Status>,
    feedback: Option<Feedback>,
    pending: Option<(bool, oneshot::Receiver<Completion>)>,
}

impl Updates {
    pub fn new(backend: Option<Arc<dyn Backend>>) -> Self {
        Self {
            backend,
            ..Self::default()
        }
    }

    pub fn load(&mut self, runtime: &Handle, tx: &mut Tx) {
        if self.status.is_none() {
            self.start(Action::Load, runtime, tx);
        }
    }

    fn start(&mut self, action: Action, runtime: &Handle, tx: &mut Tx) {
        let Some(backend) = self.backend.clone() else {
            return;
        };
        if self.pending.is_some() {
            return;
        }
        let installing = matches!(action, Action::Install);
        let enabled = self.status.as_ref().is_some_and(|status| status.enabled);
        let (sender, task) = oneshot::channel();
        runtime.spawn_blocking(move || {
            let result = match action {
                Action::Load => Completion::Status(backend.status()),
                Action::Check => Completion::Checked(backend.check()),
                Action::SetChannel(channel) => Completion::ChannelChanged(
                    channel,
                    backend
                        .set_channel(channel)
                        .map(|()| enabled.then(|| backend.check())),
                ),
                Action::Install => Completion::Installed(backend.install()),
            };
            let _ = sender.send(result);
        });
        self.pending = Some((installing, task));
        tx.wake_after(Duration::from_millis(30));
    }

    pub fn poll(&mut self, tx: &mut Tx) -> bool {
        let Some((_, task)) = &mut self.pending else {
            return false;
        };
        let result = match task.try_recv() {
            Ok(result) => Some(result),
            Err(oneshot::error::TryRecvError::Empty) => {
                tx.wake_after(Duration::from_millis(30));
                return false;
            }
            Err(oneshot::error::TryRecvError::Closed) => None,
        };
        self.pending = None;
        match result {
            Some(Completion::Status(Ok(status))) => {
                self.status = Some(status);
                self.feedback = None;
            }
            Some(Completion::Checked(result)) => self.checked(result),
            Some(Completion::ChannelChanged(channel, Ok(result))) => {
                if let Some(status) = &mut self.status {
                    status.channel = channel;
                    status.available = None;
                }
                if let Some(result) = result {
                    self.checked(result);
                } else {
                    self.feedback = Some(Feedback::Idle);
                }
            }
            Some(Completion::ChannelChanged(_, Err(_))) => self.feedback = Some(Feedback::NotSaved),
            Some(Completion::Installed(Ok(()))) => tx.quit(),
            Some(Completion::Installed(Err(_))) => self.feedback = Some(Feedback::Failed),
            _ => self.feedback = Some(Feedback::Unreachable),
        }
        true
    }

    fn checked(&mut self, result: Result<Option<String>, UpdateError>) {
        if let Some(status) = &mut self.status {
            status.available = result.as_ref().ok().and_then(Clone::clone);
        }
        self.feedback = Some(match result {
            Ok(Some(_)) => Feedback::Idle,
            Ok(None) => Feedback::UpToDate,
            Err(_) => Feedback::Unreachable,
        });
    }
}

pub fn view(updates: &Updates, compact: bool, kit: &Kit) -> El {
    let status = updates.status.as_ref();
    let version = status.map_or(env!("CARGO_PKG_VERSION"), |s| s.version.as_str());
    let selected = status.map_or(Channel::Stable, |s| s.channel);
    let enabled = status.is_some_and(|s| s.enabled);
    let busy = updates.pending.is_some();
    let available = status.and_then(|s| s.available.as_deref());
    let message = if let Some((installing, _)) = &updates.pending {
        if *installing {
            t!("update.downloading")
        } else {
            t!("update.checking")
        }
        .into()
    } else if matches!(updates.feedback, Some(Feedback::Failed)) {
        t!("update.failed").into()
    } else if let Some(version) = available {
        t!("update.available").replace("{version}", version)
    } else {
        match updates.feedback {
            Some(Feedback::UpToDate) => t!("update.upToDate"),
            Some(Feedback::Unreachable) => t!("update.unreachable"),
            Some(Feedback::NotSaved) => t!("update.notSaved"),
            _ if !enabled && cfg!(debug_assertions) => t!("update.disabled"),
            _ if !enabled => t!("update.unavailable"),
            _ => "",
        }
        .into()
    };
    let channels = row()
        .gap(12.0)
        .children([Channel::Stable, Channel::Nightly].map(|channel| {
            let label = channel.label();
            let disabled = status.is_none() || busy;
            let card = choice(
                label,
                channel == selected,
                col()
                    .gap(4.0)
                    .child(heading(label, kit))
                    .child(description(channel.hint(), kit)),
                disabled,
                kit,
            );
            if disabled {
                card
            } else {
                card.on_press_tx(move |state: &mut State, tx| {
                    if channel != selected {
                        state.settings.updates.start(
                            Action::SetChannel(channel),
                            &state.runtime,
                            tx,
                        );
                    }
                })
            }
        }));
    let show_install = available.is_some()
        || updates
            .pending
            .as_ref()
            .is_some_and(|(installing, _)| *installing);
    let button = if show_install {
        Button::new(t!("update.install"))
            .variant(ButtonVariant::Submit)
            .disabled(!enabled || busy)
            .on_press_tx(|state: &mut State, tx| {
                state
                    .settings
                    .updates
                    .start(Action::Install, &state.runtime, tx)
            })
    } else {
        Button::new(t!("update.check"))
            .variant(ButtonVariant::Outline)
            .disabled(!enabled || busy)
            .on_press_tx(|state: &mut State, tx| {
                state
                    .settings
                    .updates
                    .start(Action::Check, &state.runtime, tx);
            })
    };
    let version_row = if compact {
        col().items_start()
    } else {
        row().center_y()
    };
    section(
        t!("settings.updates"),
        [card(kit)
            .child(heading(t!("update.channel"), kit))
            .child(channels)
            .children(
                (selected == Channel::Stable && version.contains('-'))
                    .then(|| description(t!("update.leaveNightly"), kit)),
            )
            .child(divider(kit))
            .child(
                version_row
                    .gap(12.0)
                    .child(
                        col()
                            .grow(1.0)
                            .shrink()
                            .min_w(0.0)
                            .gap(4.0)
                            .child(heading(
                                t!("update.current").replace("{version}", version),
                                kit,
                            ))
                            .children((!message.is_empty()).then(|| {
                                description(message, kit).live_region(LiveRegion::Polite)
                            })),
                    )
                    .child(button.build(kit)),
            )],
        kit,
    )
}
