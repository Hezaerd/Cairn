use std::{path::Path, sync::Arc, time::Duration};

use cairn_desktop::updater::{Channel, Updates as Updater};
use rune::{El, LiveRegion, Tx, col, row};
use rune_kit::{Button, ButtonVariant, Kit};
use tokio::{runtime::Handle, sync::oneshot};

use crate::{app::State, i18n::t};

use super::{card, choice, description, divider, heading, section};

enum Feedback {
    Idle,
    UpToDate,
    Unreachable,
    NotSaved,
    Failed,
}

enum Completion {
    Show(Feedback),
    Quit,
}

enum Action {
    Check,
    SetChannel(Channel),
    Install,
}

pub struct Updates {
    updater: Arc<Updater>,
    feedback: Option<Feedback>,
    pending: Option<(bool, oneshot::Receiver<Completion>)>,
}

impl Updates {
    pub fn new(directory: &Path) -> Self {
        Self {
            updater: Arc::new(Updater::load(directory)),
            feedback: None,
            pending: None,
        }
    }

    fn start(&mut self, action: Action, runtime: &Handle, tx: &mut Tx) {
        if self.pending.is_some() {
            return;
        }
        let updater = Arc::clone(&self.updater);
        let installing = matches!(action, Action::Install);
        let (sender, task) = oneshot::channel();
        runtime.spawn(async move {
            let result = match action {
                Action::Check => Completion::Show(check(&updater).await),
                Action::SetChannel(channel) => {
                    let result = tokio::task::spawn_blocking({
                        let updater = Arc::clone(&updater);
                        move || updater.set_channel(channel)
                    })
                    .await;
                    Completion::Show(match result {
                        Ok(Ok(())) if updater.status().enabled => check(&updater).await,
                        Ok(Ok(())) => Feedback::Idle,
                        _ => Feedback::NotSaved,
                    })
                }
                Action::Install => match updater.install().await {
                    Ok(()) => Completion::Quit,
                    Err(_) => Completion::Show(Feedback::Failed),
                },
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
            Ok(result) => result,
            Err(oneshot::error::TryRecvError::Empty) => {
                tx.wake_after(Duration::from_millis(30));
                return false;
            }
            Err(oneshot::error::TryRecvError::Closed) => Completion::Show(Feedback::Unreachable),
        };
        self.pending = None;
        match result {
            Completion::Show(feedback) => self.feedback = Some(feedback),
            Completion::Quit => tx.quit(),
        }
        true
    }
}

async fn check(updater: &Updater) -> Feedback {
    match updater.check().await {
        Ok(Some(_)) => Feedback::Idle,
        Ok(None) => Feedback::UpToDate,
        Err(_) => Feedback::Unreachable,
    }
}

pub fn view(updates: &Updates, compact: bool, kit: &Kit) -> El {
    let status = updates.updater.status();
    let version = status.version;
    let selected = status.channel;
    let enabled = status.enabled;
    let busy = updates.pending.is_some();
    let available = status.available;
    let message = if let Some((installing, _)) = &updates.pending {
        if *installing {
            t!("update.downloading")
        } else {
            t!("update.checking")
        }
        .into()
    } else if matches!(updates.feedback, Some(Feedback::Failed)) {
        t!("update.failed").into()
    } else if let Some(version) = &available {
        t!("update.available").replace("{version}", &version.to_string())
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
            let (label, hint) = match channel {
                Channel::Stable => (t!("update.stable"), t!("update.hints.stable")),
                Channel::Nightly => (t!("update.nightly"), t!("update.hints.nightly")),
            };
            let card = choice(
                label,
                channel == selected,
                col()
                    .gap(4.0)
                    .child(heading(label, kit))
                    .child(description(hint, kit)),
                busy,
                kit,
            );
            if busy {
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
