use std::{env, path::PathBuf};

use cairn_app::{
    connector::{self, ExtensionFolder},
    locale::Locale,
};
use cairn_vault::BrowserSummary;
use chrono::{Local, TimeZone};
use rune::{El, Key, TextEdit, Tx, col, icon, row, text};
use rune_kit::{Button, ButtonVariant, Dialog, IconButton, IconButtonVariant, Kit, TextInput};

use crate::{app::State, i18n::t};

use super::{Notice, Page, card, description, heading, icons, named, section};

#[derive(Default)]
pub struct Browsers {
    entries: Vec<BrowserSummary>,
    pub(super) editing: Option<Rename>,
}

pub struct Rename {
    id: String,
    original: String,
    edit: TextEdit,
}

fn display_name(browser: &BrowserSummary) -> &str {
    browser.label.as_deref().unwrap_or(&browser.name)
}

pub fn refresh(state: &mut State) {
    let Some(core) = state.core() else { return };
    match state.runtime.block_on(core.list_browsers()) {
        Ok(entries) => state.settings.browsers.entries = entries,
        Err(error) => state.settings.notify(Notice::Vault(error)),
    }
}

fn answer(state: &mut State, code: &str, accept: bool) {
    if state
        .settings
        .pairing
        .as_ref()
        .is_none_or(|request| request.code != code)
    {
        return;
    }
    let Some(request) = state.settings.pairing.take() else {
        return;
    };
    let Some(core) = state.core() else { return };
    match state
        .runtime
        .block_on(core.answer_pairing(request.code, accept))
    {
        Ok(()) if accept => {
            if state.settings.page == Some(Page::Extension) {
                refresh(state);
            }
            state.settings.notify(Notice::Paired(request.name));
        }
        Ok(()) => {}
        Err(error) => state.settings.notify(Notice::Vault(error)),
    }
}

pub fn pairing_dialog(state: &State, kit: &Kit, layer: &mut Vec<El>) {
    let Some(request) = &state.settings.pairing else {
        return;
    };
    let approve = request.code.clone();
    let refuse = request.code.clone();
    let dismiss = request.code.clone();
    Dialog::new("pairing", t!("browsers.requestTitle"))
        .open(true)
        .description(named(t!("browsers.requestDescription"), &request.name))
        .close_label(t!("common.close"))
        .on_close(move |state: &mut State| answer(state, &dismiss, false))
        .width(460.0)
        .fit()
        .child(
            col()
                .px(20.0)
                .pb(20.0)
                .gap(16.0)
                .child(
                    row().justify_center().child(
                        text(request.code.clone())
                            .font(rune::TextStyle {
                                size: 28.0,
                                weight: 600.0,
                                tracking: 2.0,
                                ..kit.ty.mono
                            })
                            .color(kit.c.text_base),
                    ),
                )
                .child(description(t!("browsers.requestHint"), kit))
                .child(
                    row()
                        .gap(8.0)
                        .justify_end()
                        .child(
                            Button::new(t!("browsers.refuse"))
                                .variant(ButtonVariant::Outline)
                                .on_press(move |state: &mut State| answer(state, &refuse, false))
                                .build(kit)
                                .key("pairing-refuse"),
                        )
                        .child(
                            Button::new(t!("browsers.approve"))
                                .variant(ButtonVariant::Submit)
                                .on_press(move |state: &mut State| answer(state, &approve, true))
                                .build(kit)
                                .key("pairing-approve"),
                        ),
                ),
        )
        .build(kit, layer);
}

fn resource_dir() -> Option<PathBuf> {
    env::current_exe().ok()?.parent().map(PathBuf::from)
}

fn folder(compact: bool, kit: &Kit) -> El {
    match connector::extension_folder(resource_dir().as_deref()) {
        ExtensionFolder::Dev => card(kit).child(description(t!("extension.dev"), kit)),
        ExtensionFolder::Missing => card(kit).child(description(t!("extension.missing"), kit)),
        ExtensionFolder::Installed { path } => {
            let layout = if compact {
                col().items_start()
            } else {
                row().center_y()
            };
            card(kit)
                .child(
                    layout
                        .gap(12.0)
                        .child(
                            col()
                                .grow(1.0)
                                .shrink()
                                .min_w(0.0)
                                .gap(4.0)
                                .child(heading(t!("extension.folder"), kit))
                                .child(text(path).font(kit.ty.mono).color(kit.c.text_muted).wrap()),
                        )
                        .child(
                            Button::new(t!("extension.open"))
                                .variant(ButtonVariant::Outline)
                                .icon(&icons::FOLDER_OPEN)
                                .on_press(|state: &mut State| {
                                    if connector::open_extension_folder(resource_dir().as_deref())
                                        .is_err()
                                    {
                                        state.settings.notify(Notice::FolderFailed);
                                    }
                                })
                                .build(kit),
                        ),
                )
                .child(
                    col().gap(4.0).children(
                        [
                            t!("extension.steps.0"),
                            t!("extension.steps.1"),
                            t!("extension.steps.2"),
                        ]
                        .into_iter()
                        .enumerate()
                        .map(|(i, step)| {
                            text(format!("{}. {step}", i + 1))
                                .font(kit.ty.ui)
                                .color(kit.c.text_base)
                                .wrap()
                        }),
                    ),
                )
                .child(description(t!("extension.once"), kit))
        }
    }
}

fn edit_field(state: &mut State) -> &mut TextEdit {
    &mut state
        .settings
        .browsers
        .editing
        .as_mut()
        .expect("rename field mounted")
        .edit
}

fn cancel(state: &mut State, tx: &mut Tx) {
    if let Some(editing) = state.settings.browsers.editing.take() {
        tx.return_focus(format!("rename-{}", editing.id), false);
    }
}

fn rename(state: &mut State, tx: &mut Tx) {
    let Some(mut editing) = state.settings.browsers.editing.take() else {
        return;
    };
    tx.return_focus(format!("rename-{}", editing.id), false);
    let label = std::mem::take(&mut editing.edit.text);
    if label.trim() == editing.original {
        return;
    }
    let Some(core) = state.core() else { return };
    match state
        .runtime
        .block_on(core.rename_browser(editing.id, label))
    {
        Ok(()) => {
            refresh(state);
            state.settings.notify(Notice::BrowserRenamed);
        }
        Err(error) => state.settings.notify(Notice::Vault(error)),
    }
}

fn remove(state: &mut State, id: &str, name: &str) {
    let Some(core) = state.core() else { return };
    match state.runtime.block_on(core.remove_browser(id.to_owned())) {
        Ok(()) => {
            refresh(state);
            state.settings.notify(Notice::BrowserRemoved(name.into()));
        }
        Err(error) => state.settings.notify(Notice::Vault(error)),
    }
}

fn entry(browser: &BrowserSummary, state: &State, kit: &Kit) -> El {
    let line = row()
        .key(format!("browser-{}", browser.id))
        .w_full()
        .px(10.0)
        .py(6.0)
        .gap(8.0)
        .center_y()
        .border(1.0, kit.c.border_muted)
        .radius(kit.radius.md)
        .child(
            icon(&icons::GLOBE, 16.0)
                .color(kit.c.text_muted)
                .a11y_hidden(),
        );
    if let Some(editing) = &state.settings.browsers.editing
        && editing.id == browser.id
    {
        return line
            .child(
                TextInput::new(&editing.edit)
                    .label(t!("browsers.renameLabel"))
                    .placeholder(&browser.name)
                    .on_edit(edit_field)
                    .on_submit(rename)
                    .build(kit)
                    .key("browser-name")
                    .grow(1.0)
                    .shrink()
                    .min_w(0.0)
                    .on_key_preview(|state: &mut State, event, tx| {
                        if event.key == Key::Escape {
                            cancel(state, tx);
                            true
                        } else {
                            false
                        }
                    }),
            )
            .child(
                IconButton::new(kit.glyph.close)
                    .variant(IconButtonVariant::Ghost)
                    .label(t!("browsers.cancelRename"))
                    .help(t!("browsers.cancelRename"))
                    .on_press_tx(cancel)
                    .build(kit),
            )
            .child(
                IconButton::new(kit.glyph.check)
                    .variant(IconButtonVariant::Ghost)
                    .label(t!("browsers.saveName"))
                    .help(t!("browsers.saveName"))
                    .on_press_tx(rename)
                    .build(kit),
            );
    }

    let name = display_name(browser);
    let locale = state
        .core()
        .map_or_else(Locale::detect, |core| core.language().locale);
    let date = Local
        .timestamp_opt(browser.paired_at.try_into().unwrap_or(i64::MAX), 0)
        .single()
        .map(|date| {
            date.format(match locale {
                Locale::EnUs => "%-m/%-d/%Y",
                Locale::FrFr => "%d/%m/%Y",
            })
            .to_string()
        });
    let details = match (browser.label.is_some(), date) {
        (true, Some(date)) => format!(
            "{} · {}",
            browser.name,
            t!("browsers.pairedOn").replace("{date}", &date)
        ),
        (false, Some(date)) => t!("browsers.pairedOn").replace("{date}", &date),
        (_, None) => browser.name.clone(),
    };
    let id = browser.id.clone();
    let original = name.to_owned();
    let remove_id = id.clone();
    let remove_name = original.clone();
    line.child(
        col()
            .grow(1.0)
            .shrink()
            .min_w(0.0)
            .gap(2.0)
            .child(heading(name, kit))
            .child(description(details, kit)),
    )
    .child(
        IconButton::new(&icons::PENCIL)
            .variant(IconButtonVariant::Ghost)
            .label(named(t!("browsers.rename"), name))
            .help(named(t!("browsers.rename"), name))
            .on_press_tx(move |state: &mut State, tx| {
                state.settings.browsers.editing = Some(Rename {
                    id: id.clone(),
                    original: original.clone(),
                    edit: TextEdit::new(&original),
                });
                tx.focus("browser-name", true);
                tx.select_text("browser-name", 0..original.len());
            })
            .build(kit)
            .key(format!("rename-{}", browser.id)),
    )
    .child(
        IconButton::new(&icons::TRASH)
            .variant(IconButtonVariant::Ghost)
            .label(named(t!("browsers.remove"), name))
            .help(named(t!("browsers.remove"), name))
            .on_press_tx(move |state: &mut State, tx| {
                remove(state, &remove_id, &remove_name);
                tx.return_focus("settings-extension", false);
            })
            .build(kit),
    )
}

pub fn view(state: &State, compact: bool, kit: &Kit) -> El {
    let entries = &state.settings.browsers.entries;
    col()
        .gap(16.0)
        .child(section(
            t!("settings.extension"),
            [folder(compact, kit)],
            kit,
        ))
        .child(section(
            t!("browsers.title"),
            [card(kit)
                .child(description(t!("browsers.description"), kit))
                .children(
                    entries
                        .is_empty()
                        .then(|| description(t!("browsers.empty"), kit)),
                )
                .children((!entries.is_empty()).then(|| {
                    col()
                        .gap(4.0)
                        .children(entries.iter().map(|browser| entry(browser, state, kit)))
                }))],
            kit,
        ))
}
