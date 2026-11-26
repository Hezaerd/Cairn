use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

use cairn_app::authenticator::read_otp;
use cairn_vault::{EntrySummary, EntryUpdate, OtpPreview, VaultError};
use rune::{ClipboardContent, El, FileDialogOptions, LiveRegion, TextEdit, Tx, col, row};
use rune_kit::{
    Button, ButtonVariant, Checkbox, Kit, Select, SelectAppearance, TextArea, TextInput,
};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

use super::{Screen, task, view::label};
use crate::{app::State, i18n::t};

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

pub(super) enum Dialog {
    Add(Add),
    Edit(Box<Edit>),
    Remove(String),
}

pub(super) enum Add {
    Draft(Draft),
    Choosing(Draft),
    Scanning(
        Draft,
        oneshot::Receiver<Result<Zeroizing<String>, VaultError>>,
    ),
    Review(Review),
}

#[derive(Default)]
pub(super) struct Draft {
    links: TextEdit,
    error: Option<&'static str>,
}

pub(super) struct Review {
    text: Zeroizing<String>,
    accounts: Vec<Account>,
    choosing_target: Option<usize>,
}

struct Account {
    preview: OtpPreview,
    target: Option<String>,
}

pub(super) struct Edit {
    id: String,
    has_password: bool,
    has_totp: bool,
    name: TextEdit,
    site: TextEdit,
    username: TextEdit,
    password: TextEdit,
    key: TextEdit,
    remove_key: bool,
    error: bool,
}

enum Picture {
    File(PathBuf),
    Clipboard(Zeroizing<Vec<u8>>),
}

pub(super) fn open(state: &mut State, tx: &mut Tx) {
    state.authenticator.dialog = Some(Dialog::Add(Add::Draft(Draft {
        links: TextEdit::new("").secure(),
        error: None,
    })));
    tx.focus("choose-qr", true);
}

fn cancel(state: &mut State, _: &mut Tx) {
    state.authenticator.dialog = None;
}

fn drop_files(state: &mut State, files: &[PathBuf], tx: &mut Tx) {
    let file = files.iter().find(|path| {
        path.extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                IMAGE_EXTENSIONS
                    .iter()
                    .any(|image| image.eq_ignore_ascii_case(ext))
            })
    });
    if let Some(file) = file {
        scan(state, Picture::File(file.clone()), tx);
    }
}

fn paste(state: &mut State, content: &ClipboardContent, tx: &mut Tx) -> bool {
    if !matches!(state.authenticator.dialog, Some(Dialog::Add(Add::Draft(_)))) {
        return false;
    }
    let Some(image) = content.image() else {
        return false;
    };
    scan(
        state,
        Picture::Clipboard(Zeroizing::new(image.png().to_vec())),
        tx,
    );
    true
}

fn choose_file(state: &mut State, tx: &mut Tx) {
    let Some(Dialog::Add(add @ Add::Draft(_))) = &mut state.authenticator.dialog else {
        return;
    };
    let Add::Draft(draft) = std::mem::replace(add, Add::Draft(Draft::default())) else {
        unreachable!();
    };
    *add = Add::Choosing(draft);
    tx.open_file(
        FileDialogOptions::default().filter(t!("authenticator.choose"), IMAGE_EXTENSIONS),
        |state: &mut State, result, tx| {
            if !matches!(
                state.authenticator.dialog,
                Some(Dialog::Add(Add::Choosing(_)))
            ) {
                return;
            }
            let Some(Dialog::Add(Add::Choosing(mut draft))) = state.authenticator.dialog.take()
            else {
                unreachable!();
            };
            if result.is_err() {
                draft.error = Some(t!("authenticator.noCode"));
            }
            state.authenticator.dialog = Some(Dialog::Add(Add::Draft(draft)));
            if let Ok(Some(path)) = result {
                scan(state, Picture::File(path), tx);
            }
        },
    );
}

fn read_image(path: &Path) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    let file = File::open(path).map_err(|_| VaultError::InvalidInput)?;
    if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return Err(VaultError::InvalidInput);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| VaultError::InvalidInput)?;
    Ok(bytes)
}

fn scan(state: &mut State, picture: Picture, tx: &mut Tx) {
    let Some(core) = state.core().cloned() else {
        return;
    };
    let Some(Dialog::Add(Add::Draft(draft))) = &mut state.authenticator.dialog else {
        return;
    };
    let draft = std::mem::take(draft);
    let result = task(
        &state.runtime,
        async move {
            let bytes = match picture {
                Picture::File(path) => tokio::task::spawn_blocking(move || read_image(&path))
                    .await
                    .map_err(|_| VaultError::Storage)??,
                Picture::Clipboard(bytes) => bytes,
            };
            core.scan_qr(&bytes).await.map(Zeroizing::new)
        },
        tx,
    );
    state.authenticator.dialog = Some(Dialog::Add(Add::Scanning(draft, result)));
}

pub(super) fn poll(screen: &mut Screen, tx: &mut Tx) -> bool {
    let Some(Dialog::Add(Add::Scanning(_, result))) = &mut screen.dialog else {
        return false;
    };
    let result = match result.try_recv() {
        Err(oneshot::error::TryRecvError::Empty) => {
            tx.wake_after(Duration::from_millis(20));
            return false;
        }
        result => result.unwrap_or(Err(VaultError::Storage)),
    };
    let Some(Dialog::Add(Add::Scanning(mut draft, _))) = screen.dialog.take() else {
        unreachable!();
    };
    screen.dialog = Some(Dialog::Add(match result {
        Ok(text) => review(text, draft, &screen.entries),
        Err(_) => {
            draft.error = Some(t!("authenticator.noCode"));
            Add::Draft(draft)
        }
    }));
    true
}

fn read_links(state: &mut State, _: &mut Tx) {
    let Some(Dialog::Add(Add::Draft(draft))) = &mut state.authenticator.dialog else {
        return;
    };
    let mut draft = std::mem::take(draft);
    let raw = draft.links.text.trim();
    let text = if raw.contains("://") {
        Zeroizing::new(raw.to_owned())
    } else {
        let mut link = url::Url::parse("otpauth://totp/").expect("valid TOTP URI base");
        link.path_segments_mut()
            .unwrap()
            .push(t!("credentials.codeOnly"));
        link.query_pairs_mut().append_pair("secret", raw);
        Zeroizing::new(String::from(link))
    };
    draft.error = None;
    state.authenticator.dialog = Some(Dialog::Add(review(
        text,
        draft,
        &state.authenticator.entries,
    )));
}

fn review(text: Zeroizing<String>, mut draft: Draft, entries: &[EntrySummary]) -> Add {
    let Ok(previews) = read_otp(text.to_string()) else {
        draft.error = Some(t!("authenticator.invalid"));
        return Add::Draft(draft);
    };
    let mut taken = HashSet::new();
    let accounts = previews
        .into_iter()
        .map(|preview| {
            let issuer = preview.issuer.trim().to_lowercase();
            let target = entries
                .iter()
                .find(|entry| {
                    !issuer.is_empty()
                        && !entry.has_totp
                        && !taken.contains(&entry.id)
                        && (entry.name.to_lowercase().contains(&issuer)
                            || host(&entry.site).contains(&issuer))
                })
                .map(|entry| {
                    taken.insert(entry.id.clone());
                    entry.id.clone()
                });
            Account { preview, target }
        })
        .collect();
    Add::Review(Review {
        text,
        accounts,
        choosing_target: None,
    })
}

fn host(site: &str) -> String {
    let url = if site.contains("://") {
        url::Url::parse(site)
    } else {
        url::Url::parse(&format!("https://{}", site.trim_start_matches("*.")))
    };
    url.ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .unwrap_or_else(|| site.to_lowercase())
}

fn import(state: &mut State, tx: &mut Tx) {
    let Some(core) = state.core().cloned() else {
        return;
    };
    if let Some(Dialog::Add(Add::Review(review))) = state.authenticator.dialog.take() {
        let count = review.accounts.len();
        let targets = review
            .accounts
            .into_iter()
            .map(|account| account.target)
            .collect();
        state.authenticator.saving = Some(task(
            &state.runtime,
            async move {
                core.import_otp(review.text, targets).await?;
                Ok(Some(count))
            },
            tx,
        ));
    }
}

pub(super) fn edit(state: &mut State, tx: &mut Tx) {
    let Some(entry) = state.authenticator.selected_entry() else {
        return;
    };
    state.authenticator.dialog = Some(Dialog::Edit(Box::new(Edit {
        id: entry.id.clone(),
        has_password: entry.has_password,
        has_totp: entry.has_totp,
        name: TextEdit::new(&entry.name),
        site: TextEdit::new(&entry.site),
        username: TextEdit::new(&entry.username),
        password: TextEdit::new("").secure(),
        key: TextEdit::new("").secure(),
        remove_key: false,
        error: false,
    })));
    tx.focus("code-name", false);
}

fn save_edit(state: &mut State, tx: &mut Tx) {
    let Some(core) = state.core().cloned() else {
        return;
    };
    let Some(Dialog::Edit(edit)) = &mut state.authenticator.dialog else {
        return;
    };
    edit.error = edit.remove_key && !edit.has_password && edit.password.text.is_empty();
    if edit.name.text.trim().is_empty() || edit.error {
        return;
    }
    let id = edit.id.clone();
    let update = EntryUpdate {
        name: edit.name.text.clone(),
        site: edit.site.text.clone(),
        username: edit.username.text.clone(),
        password: take_value(&mut edit.password),
        notes: None,
        totp: if edit.remove_key {
            Some(String::new())
        } else {
            take_value(&mut edit.key)
        },
    };
    cancel(state, tx);
    state.authenticator.saving = Some(task(
        &state.runtime,
        async move {
            core.update_entry(id, update).await?;
            Ok(None)
        },
        tx,
    ));
}

fn take_value(edit: &mut TextEdit) -> Option<String> {
    (!edit.text.is_empty()).then(|| std::mem::take(&mut edit.text))
}

pub(super) fn remove(state: &mut State) {
    if let Some(entry) = state.authenticator.selected_entry() {
        state.authenticator.dialog = Some(Dialog::Remove(entry.id.clone()));
    }
}

fn confirm_remove(state: &mut State, tx: &mut Tx) {
    let Some(core) = state.core().cloned() else {
        return;
    };
    let Some(Dialog::Remove(id)) = state.authenticator.dialog.take() else {
        return;
    };
    let Some(entry) = state
        .authenticator
        .entries
        .iter()
        .find(|entry| entry.id == id)
    else {
        return;
    };
    let remaining_login = entry.has_password.then(|| EntryUpdate {
        name: entry.name.clone(),
        site: entry.site.clone(),
        username: entry.username.clone(),
        password: None,
        notes: None,
        totp: Some(String::new()),
    });
    state.authenticator.saving = Some(task(
        &state.runtime,
        async move {
            if let Some(update) = remaining_login {
                core.update_entry(id, update).await?;
            } else {
                core.delete_entry(id).await?;
            }
            Ok(None)
        },
        tx,
    ));
}

pub(super) fn build(screen: &Screen, kit: &Kit, layer: &mut Vec<El>) {
    let mut menus = Vec::new();
    let dialog = match &screen.dialog {
        Some(Dialog::Add(add)) => add_dialog(add, &screen.entries, kit, &mut menus),
        Some(Dialog::Edit(edit)) => edit_dialog(edit, kit),
        Some(Dialog::Remove(id)) => {
            let Some(entry) = screen.entries.iter().find(|entry| &entry.id == id) else {
                return;
            };
            rune_kit::Dialog::new(
                "remove-code",
                t!("authenticator.removeTitle").replace("{name}", &entry.name),
            )
            .description(if entry.has_password {
                t!("authenticator.removeKeepsLogin")
            } else {
                t!("authenticator.removeDeletesEntry")
            })
            .child(
                footer(
                    t!("common.cancel"),
                    cancel,
                    Button::new(t!("authenticator.removeConfirm"))
                        .variant(ButtonVariant::Danger)
                        .on_press_tx(confirm_remove),
                    kit,
                )
                .padding(16.0),
            )
        }
        None => return,
    };
    dialog
        .open(true)
        .fit()
        .close_label(t!("common.close"))
        .on_close(|state: &mut State| state.authenticator.dialog = None)
        .build(kit, layer);
    layer.extend(menus);
}

fn add_dialog(
    add: &Add,
    entries: &[EntrySummary],
    kit: &Kit,
    menus: &mut Vec<El>,
) -> rune_kit::Dialog {
    let dialog = rune_kit::Dialog::new("add-codes", t!("authenticator.title"));
    if let Add::Review(review) = add {
        let count = review.accounts.len();
        let options = targets(entries);
        let review_rows = review.accounts.iter().enumerate().map(|(index, account)| {
            account_row(index, account, review, &options, entries, kit, menus)
        });
        return dialog
            .description(count_text(
                count,
                t!("authenticator.foundOne"),
                t!("authenticator.found"),
            ))
            .child(
                col()
                    .gap(8.0)
                    .w_full()
                    .max_h(192.0)
                    .min_h(0.0)
                    .scroll(Default::default())
                    .px(16.0)
                    .children(review_rows),
            )
            .child(
                footer(
                    t!("authenticator.back"),
                    open,
                    Button::new(count_text(
                        count,
                        t!("authenticator.addOne"),
                        t!("authenticator.add"),
                    ))
                    .variant(ButtonVariant::Submit)
                    .on_press_tx(import),
                    kit,
                )
                .padding(16.0),
            );
    }

    let (draft, message, busy) = match add {
        Add::Draft(draft) => (draft, draft.error, false),
        Add::Choosing(draft) => (draft, None, true),
        Add::Scanning(draft, _) => (draft, Some(t!("authenticator.scanning")), true),
        Add::Review(_) => unreachable!(),
    };
    dialog
        .description(t!("authenticator.description"))
        .close_disabled(matches!(add, Add::Choosing(_)))
        .child(
            col()
                .px(16.0)
                .pb(16.0)
                .gap(14.0)
                .on_drop_files(drop_files)
                .on_key_preview(|_: &mut State, event, tx| {
                    if event.edit_command() != Some('v') {
                        return false;
                    }
                    tx.read_clipboard(|state: &mut State, content, tx| {
                        if !paste(state, content, tx)
                            && matches!(
                                state.authenticator.dialog,
                                Some(Dialog::Add(Add::Draft(_)))
                            )
                        {
                            tx.request_paste();
                        }
                    });
                    true
                })
                .child(
                    Button::new(t!("authenticator.choose"))
                        .variant(ButtonVariant::Ghost)
                        .disabled(busy)
                        .on_press_tx(choose_file)
                        .build(kit)
                        .key("choose-qr")
                        .w_full()
                        .h(56.0)
                        .border(1.0, kit.c.border_base)
                        .border_dash(4.0, 4.0),
                )
                .child(
                    col()
                        .gap(4.0)
                        .child(label(t!("authenticator.links"), 12.0, kit.c.text_base))
                        .child(
                            TextArea::new(&draft.links)
                                .label(t!("authenticator.links"))
                                .secure()
                                .rows(3)
                                .disabled(busy)
                                .placeholder("otpauth://totp/…")
                                .on_edit(|state: &mut State| {
                                    let Some(Dialog::Add(Add::Draft(draft))) =
                                        &mut state.authenticator.dialog
                                    else {
                                        unreachable!();
                                    };
                                    &mut draft.links
                                })
                                .build(kit)
                                .key("otp-links")
                                .w_full(),
                        )
                        .child(label(t!("entry.totpHint"), 11.0, kit.c.text_muted).wrap()),
                )
                .children(message.map(|message| {
                    label(
                        message,
                        12.0,
                        if busy {
                            kit.c.text_muted
                        } else {
                            kit.c.danger.fg
                        },
                    )
                    .wrap()
                    .live_region(LiveRegion::Polite)
                }))
                .child(footer(
                    t!("common.cancel"),
                    cancel,
                    Button::new(t!("authenticator.read"))
                        .variant(ButtonVariant::Submit)
                        .disabled(busy || draft.links.text.trim().is_empty())
                        .on_press_tx(read_links),
                    kit,
                )),
        )
}

fn targets(entries: &[EntrySummary]) -> Vec<String> {
    let mut used = HashSet::from([t!("authenticator.newEntry").to_owned()]);
    let mut options = vec![t!("authenticator.newEntry").to_owned()];
    for entry in entries {
        let mut label = entry.name.clone();
        if used.contains(&label) && !entry.username.is_empty() {
            label = format!("{label} · {}", entry.username);
        }
        let base = label.clone();
        let mut ordinal = 2;
        while !used.insert(label.clone()) {
            label = format!("{base} ({ordinal})");
            ordinal += 1;
        }
        options.push(label);
    }
    options
}

fn account_row(
    index: usize,
    account: &Account,
    review: &Review,
    options: &[String],
    entries: &[EntrySummary],
    kit: &Kit,
    menus: &mut Vec<El>,
) -> El {
    let issuer = if account.preview.issuer.is_empty() {
        t!("authenticator.noIssuer")
    } else {
        &account.preview.issuer
    };
    let username = if account.preview.account.is_empty() {
        t!("common.notSet")
    } else {
        &account.preview.account
    };
    let target = account
        .target
        .as_ref()
        .and_then(|id| entries.iter().position(|entry| &entry.id == id));
    let replaces = target.is_some_and(|i| entries[i].has_totp);
    let detail = if replaces {
        format!("{username} · {}", t!("authenticator.replaces"))
    } else {
        username.to_owned()
    };
    let choices = options
        .iter()
        .skip(1)
        .cloned()
        .zip(entries.iter().map(|entry| entry.id.clone()))
        .collect::<Vec<_>>();
    let select = Select::new(format!("code-target-{index}"), options)
        .appearance(SelectAppearance::Field)
        .width(172.0)
        .current(Some(&options[target.map_or(0, |i| i + 1)]))
        .label(format!("{} · {issuer}", t!("authenticator.target")))
        .open(review.choosing_target == Some(index))
        .on_toggle(move |state: &mut State| {
            if let Some(Dialog::Add(Add::Review(review))) = &mut state.authenticator.dialog {
                review.choosing_target = (review.choosing_target != Some(index)).then_some(index);
            }
        })
        .on_close(|state: &mut State| {
            if let Some(Dialog::Add(Add::Review(review))) = &mut state.authenticator.dialog {
                review.choosing_target = None;
            }
        })
        .on_choose(move |state: &mut State, label, _| {
            if let Some(Dialog::Add(Add::Review(review))) = &mut state.authenticator.dialog {
                review.accounts[index].target = choices
                    .iter()
                    .find(|(choice, _)| choice == label)
                    .map(|(_, id)| id.clone());
                review.choosing_target = None;
            }
        })
        .build(kit, menus);
    row()
        .key(format!("account-{index}"))
        .w_full()
        .center_y()
        .gap(8.0)
        .padding(8.0)
        .border(1.0, kit.c.border_muted)
        .radius(kit.radius.md)
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(2.0)
                .child(label(issuer, 13.0, kit.c.text_base).truncate())
                .child(label(detail, 11.0, kit.c.text_muted).truncate()),
        )
        .child(select)
}

fn edit_dialog(edit: &Edit, kit: &Kit) -> rune_kit::Dialog {
    let field = |key: &'static str,
                 title,
                 value: &TextEdit,
                 picker: fn(&mut Edit) -> &mut TextEdit,
                 secure,
                 placeholder,
                 disabled| {
        let input = TextInput::new(value)
            .label(title)
            .disabled(disabled)
            .placeholder(placeholder)
            .on_edit(move |state: &mut State| {
                let Some(Dialog::Edit(edit)) = &mut state.authenticator.dialog else {
                    unreachable!();
                };
                picker(edit)
            })
            .on_submit(save_edit);
        let input = if secure { input.secure() } else { input };
        col()
            .gap(4.0)
            .child(label(title, 12.0, kit.c.text_base))
            .child(input.build(kit).key(key).w_full())
    };
    rune_kit::Dialog::new("edit-code", t!("edit.title"))
        .description(t!("edit.description"))
        .child(
            col()
                .gap(8.0)
                .w_full()
                .min_h(0.0)
                .px(16.0)
                .pb(4.0)
                .scroll(Default::default())
                .child(field(
                    "code-name",
                    t!("entry.name"),
                    &edit.name,
                    |e| &mut e.name,
                    false,
                    "",
                    false,
                ))
                .child(field(
                    "code-site",
                    t!("entry.site"),
                    &edit.site,
                    |e| &mut e.site,
                    false,
                    "",
                    false,
                ))
                .child(field(
                    "code-username",
                    t!("entry.username"),
                    &edit.username,
                    |e| &mut e.username,
                    false,
                    "",
                    false,
                ))
                .child(field(
                    "code-password",
                    t!("entry.password"),
                    &edit.password,
                    |e| &mut e.password,
                    true,
                    if edit.has_password {
                        t!("entry.keepPassword")
                    } else {
                        ""
                    },
                    false,
                ))
                .child(field(
                    "code-key",
                    t!("entry.totp"),
                    &edit.key,
                    |e| &mut e.key,
                    true,
                    t!("entry.keepTotp"),
                    edit.remove_key,
                ))
                .children(edit.has_totp.then(|| {
                    Checkbox::new(edit.remove_key)
                        .label(t!("entry.removeTotp"))
                        .on_toggle(|state: &mut State| {
                            if let Some(Dialog::Edit(edit)) = &mut state.authenticator.dialog {
                                edit.remove_key = !edit.remove_key;
                            }
                        })
                        .build(kit)
                        .key("remove-code-key")
                }))
                .children(
                    edit.error
                        .then(|| label(t!("entry.needsSecret"), 12.0, kit.c.danger.fg).wrap()),
                ),
        )
        .child(
            footer(
                t!("common.cancel"),
                cancel,
                Button::new(t!("common.save"))
                    .variant(ButtonVariant::Submit)
                    .disabled(edit.name.text.trim().is_empty())
                    .on_press_tx(save_edit),
                kit,
            )
            .padding(16.0),
        )
}

fn footer(secondary: &str, action: fn(&mut State, &mut Tx), primary: Button, kit: &Kit) -> El {
    row()
        .gap(8.0)
        .justify_end()
        .w_full()
        .child(
            Button::new(secondary)
                .variant(ButtonVariant::Outline)
                .on_press_tx(action)
                .build(kit),
        )
        .child(primary.build(kit).key("confirm-add-codes"))
}

fn count_text(count: usize, one: &str, plural: &str) -> String {
    if count == 1 {
        one.to_owned()
    } else {
        plural.replace("{count}", &count.to_string())
    }
}

pub(super) fn added(count: usize) -> String {
    count_text(
        count,
        t!("authenticator.addedOne"),
        t!("authenticator.added"),
    )
}
