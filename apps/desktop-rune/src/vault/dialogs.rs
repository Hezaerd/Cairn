use cairn_vault::{EntrySecret, EntrySummary, EntryUpdate, NewEntry};
use rune::{El, LiveRegion, ScrollSpec, TextEdit, TextStyle, Tx, col, row, text};
use rune_kit::{Button, ButtonVariant, Checkbox, Dialog, IconButton, Kit, TextArea, TextInput};
use zeroize::Zeroize;

use crate::{
    app::State,
    generator::{self, Preview},
    i18n::t,
};

pub enum Active {
    Editor(Box<Editor>),
    Delete { id: String, name: String },
}

pub struct Editor {
    pub target: Option<Target>,
    name: TextEdit,
    site: TextEdit,
    username: TextEdit,
    pub password: TextEdit,
    totp: TextEdit,
    notes: Option<TextEdit>,
    remove_totp: bool,
    pub generator: Option<Preview>,
}

pub struct Target {
    pub id: String,
    has_totp: bool,
}

pub enum Change {
    Add(NewEntry),
    Update(String, EntryUpdate),
    Delete(String),
}

impl Editor {
    pub fn new(entry: Option<&EntrySummary>, revealed: Option<EntrySecret>) -> Self {
        let notes = match revealed {
            Some(mut secret) => Some(TextEdit::new(std::mem::take(&mut secret.notes))),
            None if entry.is_none() => Some(TextEdit::new("")),
            None => None,
        };
        Self {
            target: entry.map(|entry| Target {
                id: entry.id.clone(),
                has_totp: entry.has_totp,
            }),
            name: TextEdit::new(entry.map_or("", |entry| &entry.name)),
            site: TextEdit::new(entry.map_or("", |entry| &entry.site)),
            username: TextEdit::new(entry.map_or("", |entry| &entry.username)),
            password: TextEdit::new("").secure(),
            totp: TextEdit::new("").secure(),
            notes,
            remove_totp: false,
            generator: None,
        }
    }

    fn change(&self) -> Result<Change, &'static str> {
        let name = self.name.text.clone();
        let site = self.site.text.clone();
        let username = self.username.text.clone();
        if name.trim().is_empty() {
            return Err(t!("entry.invalid"));
        }
        if let Some(target) = &self.target {
            Ok(Change::Update(
                target.id.clone(),
                EntryUpdate {
                    name,
                    site,
                    username,
                    password: (!self.password.text.is_empty()).then(|| self.password.text.clone()),
                    totp: if self.remove_totp {
                        Some(String::new())
                    } else {
                        (!self.totp.text.is_empty()).then(|| self.totp.text.clone())
                    },
                    notes: self.notes.as_ref().map(|notes| notes.text.clone()),
                },
            ))
        } else {
            if self.password.text.is_empty() && self.totp.text.trim().is_empty() {
                return Err(t!("entry.needsSecret"));
            }
            Ok(Change::Add(NewEntry {
                name,
                site,
                username,
                password: self.password.text.clone(),
                totp: self.totp.text.clone(),
                notes: self
                    .notes
                    .as_ref()
                    .map_or_else(String::new, |notes| notes.text.clone()),
            }))
        }
    }
}

impl Drop for Editor {
    fn drop(&mut self) {
        self.password.text.zeroize();
        self.totp.text.zeroize();
        if let Some(notes) = &mut self.notes {
            notes.text.zeroize();
        }
    }
}

impl Active {
    pub fn change(&self) -> Result<Change, &'static str> {
        match self {
            Self::Editor(editor) => editor.change(),
            Self::Delete { id, .. } => Ok(Change::Delete(id.clone())),
        }
    }
}

fn submit(state: &mut State, tx: &mut Tx) {
    let Some(dialog) = &state.vault.session.dialog else {
        return;
    };
    match dialog.change() {
        Ok(change) => state
            .vault
            .submit(change, state.core.clone(), &state.runtime, tx),
        Err(message) => state.vault.session.error = Some(message),
    }
}

fn field(label: &'static str, hint: Option<&'static str>, input: El, kit: &Kit) -> El {
    col()
        .w_full()
        .gap(4.0)
        .child(
            row()
                .w_full()
                .justify_between()
                .child(
                    text(label)
                        .font(TextStyle::new(13.0, 500.0))
                        .color(kit.c.text_base),
                )
                .children(hint.map(|hint| muted(hint, kit))),
        )
        .child(input)
}

fn muted(value: &'static str, kit: &Kit) -> El {
    text(value)
        .font(TextStyle::new(11.0, 400.0))
        .color(kit.c.text_muted)
        .wrap()
}

fn input(
    label: &'static str,
    value: &TextEdit,
    edit: fn(&mut Editor) -> &mut TextEdit,
) -> TextInput {
    TextInput::new(value)
        .label(label)
        .height(32.0)
        .width(None)
        .on_edit(move |state: &mut State| state.vault.edit_field(|editor| Some(edit(editor))))
        .on_submit(submit)
        .on_change(|state: &mut State, _| state.vault.session.error = None)
}

fn editor(editor: &Editor, kit: &Kit) -> El {
    let existing = editor.target.is_some();
    let has_totp = editor.target.as_ref().is_some_and(|target| target.has_totp);
    let name = input(t!("entry.name"), &editor.name, |e| &mut e.name)
        .placeholder(t!("entry.namePlaceholder"))
        .build(kit)
        .key("entry-name")
        .w_full();
    let site = input(t!("entry.site"), &editor.site, |e| &mut e.site)
        .placeholder(t!("entry.sitePlaceholder"))
        .build(kit)
        .key("entry-site")
        .w_full();
    let username = input(t!("entry.username"), &editor.username, |e| &mut e.username)
        .build(kit)
        .key("entry-username")
        .w_full();
    let password = input(t!("entry.password"), &editor.password, |e| &mut e.password)
        .secure()
        .build(kit)
        .key("entry-password")
        .grow(1.0)
        .min_w(0.0);
    let totp = input(t!("entry.totp"), &editor.totp, |e| &mut e.totp)
        .secure()
        .build(kit)
        .key("entry-totp")
        .w_full();

    col()
        .w_full()
        .gap(12.0)
        .child(field(t!("entry.name"), None, name, kit))
        .child(field(
            t!("entry.site"),
            None,
            col()
                .gap(4.0)
                .child(site)
                .child(muted(t!("entry.siteHint"), kit)),
            kit,
        ))
        .child(field(t!("entry.username"), None, username, kit))
        .child(field(
            t!("entry.password"),
            existing.then(|| t!("entry.keepPassword")),
            row().w_full().gap(8.0).center_y().child(password).child(
                IconButton::new(&rune_kit::glyphs::SPARKLE)
                    .label(t!("generator.open"))
                    .help(t!("generator.open"))
                    .on_press_tx(|state: &mut State, tx| state.vault.open_generator(tx))
                    .build(kit)
                    .key("open-generator"),
            ),
            kit,
        ))
        .child(field(
            t!("entry.totp"),
            Some(if has_totp {
                t!("entry.keepTotp")
            } else {
                t!("entry.optional")
            }),
            col()
                .w_full()
                .gap(4.0)
                .child(totp)
                .child(muted(t!("entry.totpHint"), kit))
                .children(has_totp.then(|| {
                    Checkbox::new(editor.remove_totp)
                        .label(t!("entry.removeTotp"))
                        .on_toggle(|state: &mut State| {
                            if let Some(editor) = state.vault.editor_mut() {
                                editor.remove_totp = !editor.remove_totp;
                            }
                        })
                        .build(kit)
                        .key("remove-totp")
                })),
            kit,
        ))
        .child(field(
            t!("entry.notes"),
            Some(t!("entry.optional")),
            match &editor.notes {
                Some(notes) => TextArea::new(notes)
                    .label(t!("entry.notes"))
                    .rows(3)
                    .wrap_anywhere()
                    .spellcheck(false)
                    .on_edit(|state: &mut State| {
                        state.vault.edit_field(|editor| editor.notes.as_mut())
                    })
                    .build(kit)
                    .key("entry-notes")
                    .w_full(),
                None => muted(t!("entry.notesUnchanged"), kit),
            },
            kit,
        ))
}

pub fn overlays(state: &State, kit: &Kit) -> Vec<El> {
    let session = &state.vault.session;
    let Some(dialog) = &session.dialog else {
        return Vec::new();
    };
    let busy = session.pending.is_some();
    let mut overlays = Vec::new();
    let (title, description, body, action, variant) = match dialog {
        Active::Editor(draft) => {
            let adding = draft.target.is_none();
            let form = col()
                .w_full()
                .shrink()
                .min_h(0.0)
                .scroll(ScrollSpec::default())
                .child(editor(draft, kit).px(20.0).py(4.0));
            (
                if adding {
                    t!("add.title")
                } else {
                    t!("edit.title")
                }
                .to_owned(),
                if adding {
                    t!("add.description")
                } else {
                    t!("edit.description")
                },
                Some(form),
                t!("common.save"),
                ButtonVariant::Submit,
            )
        }
        Active::Delete { name, .. } => (
            t!("remove.title").replace("{name}", name),
            t!("remove.description"),
            None,
            t!("remove.confirm"),
            ButtonVariant::Danger,
        ),
    };
    let generator = match dialog {
        Active::Editor(draft) => draft.generator.as_ref(),
        _ => None,
    };
    Dialog::new("entry", title)
        .description(description)
        .width(520.0)
        .fit()
        .open(true)
        .close_label(t!("common.close"))
        .close_disabled(busy || generator.is_some())
        .on_close(|state: &mut State| state.vault.close_dialog())
        .child(
            col()
                .w_full()
                .shrink()
                .min_h(0.0)
                .children(body)
                .children(session.error.map(|error| {
                    text(error)
                        .color(kit.c.danger.fg)
                        .wrap()
                        .live_region(LiveRegion::Assertive)
                        .px(20.0)
                        .pt(8.0)
                }))
                .child(
                    row()
                        .w_full()
                        .px(20.0)
                        .py(16.0)
                        .gap(8.0)
                        .justify_end()
                        .child(
                            Button::new(t!("common.cancel"))
                                .variant(ButtonVariant::Outline)
                                .disabled(busy)
                                .on_press_tx(|state: &mut State, _| state.vault.close_dialog())
                                .build(kit)
                                .key("entry-cancel"),
                        )
                        .child(
                            Button::new(action)
                                .variant(variant)
                                .disabled(busy)
                                .on_press_tx(submit)
                                .build(kit)
                                .key("entry-submit"),
                        ),
                ),
        )
        .build(kit, &mut overlays);
    if let Some(preview) = generator {
        overlays.push(
            col()
                .key("generator-layer")
                .absolute(0.0, 0.0)
                .w_full()
                .h_full()
                .center()
                .child(
                    generator::view(&state.vault.preferences, preview, kit)
                        .key("generator-popup")
                        .modal(true, |state: &mut State| state.vault.close_generator())
                        .role("dialog")
                        .label(t!("generator.title")),
                ),
        );
    }
    overlays
}
