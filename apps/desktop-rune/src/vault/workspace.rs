use std::borrow::Cow;

use cairn_vault::EntrySummary;
use rune::{El, Family, LiveRegion, ScrollSpec, TextStyle, col, el, icon, row, text};
use rune_kit::{
    Button, ButtonVariant, IconButton, IconButtonVariant, Kit, Sidebar, SidebarRow, TextInput,
};

use crate::{app::State, i18n::t};

use super::{Session, dialogs};

pub fn view(state: &State, kit: &Kit, compact: bool) -> El {
    let session = &state.vault.session;
    let details = match session.selected() {
        Some(entry) => details(session, entry, kit, compact),
        None => empty(session.search.text.is_empty(), kit),
    };
    col()
        .key("workspace")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .child(toolbar(session, kit))
        .children(
            session
                .error
                .filter(|_| session.dialog.is_none())
                .map(|error| {
                    text(error)
                        .color(kit.c.danger.fg)
                        .wrap()
                        .px(16.0)
                        .py(6.0)
                        .live_region(LiveRegion::Assertive)
                }),
        )
        .child(
            row()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .child(sidebar(session, kit).w(if compact { 210.0 } else { 270.0 }))
                .child(el().w(1.0).h_full().fill(kit.c.border_muted))
                .child(details.grow(1.0).min_w(0.0).h_full()),
        )
        .children(session.notice.map(|(notice, _)| {
            text(notice)
                .color(kit.c.text_base)
                .fill(kit.c.layer_01)
                .radius(kit.radius.md)
                .border(1.0, kit.c.border_muted)
                .padding(10.0)
                .absolute(12.0, 12.0)
                .live_region(LiveRegion::Polite)
        }))
        .children(dialogs::overlays(state, kit))
}

fn toolbar(session: &Session, kit: &Kit) -> El {
    row()
        .w_full()
        .h(48.0)
        .px(12.0)
        .gap(8.0)
        .center_y()
        .child(
            text(t!("credentials.title"))
                .font(TextStyle::new(14.0, 600.0))
                .color(kit.c.text_base),
        )
        .child(
            text(session.entries.len().to_string())
                .font(TextStyle::new(12.0, 400.0))
                .color(kit.c.text_muted),
        )
        .child(el().grow(1.0))
        .child(
            Button::new(t!("add.open"))
                .variant(ButtonVariant::Submit)
                .disabled(session.pending.is_some())
                .on_press_tx(|state: &mut State, tx| state.vault.open_editor(false, tx))
                .build(kit)
                .key("entry-add")
                .h(32.0),
        )
        .child(
            Button::new(t!("toolbar.lock"))
                .variant(ButtonVariant::Outline)
                .on_press_tx(State::lock)
                .build(kit)
                .key("lock")
                .h(32.0),
        )
}

fn sidebar(session: &Session, kit: &Kit) -> El {
    let search = TextInput::new(&session.search)
        .label(t!("credentials.search"))
        .placeholder(t!("credentials.searchPlaceholder"))
        .leading_icon(kit.glyph.search)
        .height(32.0)
        .on_edit(|state: &mut State| &mut state.vault.session.search)
        .on_change(|state: &mut State, tx| {
            let session = &mut state.vault.session;
            session.clear_reveal();
            session.filter();
            tx.scroll_to_instant("sidebar-scroll", 0.0, 0.0);
        })
        .build(kit)
        .key("login-search")
        .w_full();
    let header = col().w_full().gap(10.0).px(6.0).child(search).child(
        text(t!("credentials.all"))
            .font(TextStyle::new(11.0, 400.0))
            .color(kit.c.text_muted)
            .px(4.0),
    );
    let mut sidebar = Sidebar::new()
        .label(t!("credentials.list"))
        .header(header)
        .header_padding(14.0, 8.0)
        .inset(6.0)
        .row_height(46.0)
        .row_gap(2.0);
    if session.matches.is_empty() {
        sidebar = sidebar.child(
            text(if session.search.text.is_empty() {
                t!("credentials.empty")
            } else {
                t!("credentials.noResults")
            })
            .font(TextStyle::new(12.0, 400.0))
            .color(kit.c.text_muted)
            .padding(10.0),
        );
    } else {
        let row_kit = kit.clone();
        sidebar = sidebar.virtual_rows(
            session.matches.len(),
            |state: &State, index| Cow::Borrowed(&state.vault.session.entry(index).id),
            move |state: &State, index| login_row(&state.vault.session, index, &row_kit),
        );
    }
    sidebar
        .build(kit)
        .key("login-list")
        .fill(kit.c.layer_01)
        .h_full()
}

fn login_row(session: &Session, index: usize, kit: &Kit) -> El {
    let entry = session.entry(index);
    let id = entry.id.clone();
    let subtitle = if !entry.username.is_empty() {
        &entry.username
    } else {
        &entry.site
    };
    let selected = session.selected().is_some_and(|entry| entry.id == id);
    let mut entry_row = SidebarRow::new(&entry.name)
        .avatar(session.icons.view(entry, false, kit))
        .subtitle(or_else(subtitle, t!("credentials.noUsername")))
        .title_style(TextStyle::new(12.0, 600.0))
        .subtitle_style(TextStyle::new(11.0, 400.0))
        .height(46.0)
        .selected(selected)
        .on_select(move |state: &mut State, _| {
            state.vault.select_login(&id);
        });
    if entry.has_totp {
        entry_row = entry_row.trailing(
            text("◷")
                .color(kit.c.text_muted)
                .label(t!("credentials.hasCode")),
        );
    }
    let row = entry_row.build(kit);
    if selected {
        row.fill(rune::color::hex(if kit.dark { "#293e50" } else { "#e5eff9" }).unwrap())
            .child(
                el().absolute(0.0, 14.0)
                    .size(3.0, 18.0)
                    .radius(2.0)
                    .fill(kit.c.border_focus)
                    .a11y_hidden(),
            )
    } else {
        row
    }
}

fn or_else<'a>(value: &'a str, fallback: &'static str) -> &'a str {
    if value.is_empty() { fallback } else { value }
}

fn detail_field(label: &'static str, content: El, hint: Option<&'static str>, kit: &Kit) -> El {
    col()
        .w_full()
        .gap(6.0)
        .child(el().w_full().h(1.0).fill(kit.c.border_muted))
        .child(
            col()
                .w_full()
                .gap(6.0)
                .py(14.0)
                .child(
                    text(label)
                        .font(TextStyle::new(12.0, 400.0))
                        .color(kit.c.text_muted),
                )
                .child(content)
                .children(hint.map(|hint| {
                    text(hint)
                        .font(TextStyle::new(11.0, 400.0))
                        .color(kit.c.text_muted)
                        .wrap()
                })),
        )
}

fn body(value: &str, kit: &Kit) -> El {
    text(value)
        .font(TextStyle::new(13.0, 400.0))
        .color(kit.c.text_base)
        .wrap_anywhere()
}

fn details(session: &Session, entry: &EntrySummary, kit: &Kit, compact: bool) -> El {
    let reveal = session
        .revealed
        .as_ref()
        .filter(|reveal| reveal.id == entry.id);
    let (password, notes) = match reveal {
        Some(reveal) => (
            reveal.secret.password.as_str(),
            or_else(&reveal.secret.notes, t!("credentials.noNotes")),
        ),
        None => ("••••••••••••", t!("credentials.notesHidden")),
    };
    let (eye, eye_label) = if reveal.is_some() {
        (kit.glyph.eye_off, t!("credentials.hidePassword"))
    } else {
        (kit.glyph.eye, t!("credentials.showPassword"))
    };
    let busy = session.pending.is_some();
    let header = row()
        .w_full()
        .gap(10.0)
        .center_y()
        .pb(24.0)
        .child(session.icons.view(entry, true, kit))
        .child(
            col()
                .grow(1.0)
                .min_w(0.0)
                .gap(4.0)
                .child(
                    text(entry.name.as_str())
                        .font(TextStyle::new(20.0, 600.0))
                        .color(kit.c.text_base)
                        .wrap_anywhere()
                        .role("heading")
                        .key("entry-title"),
                )
                .child(
                    text(t!("credentials.kind"))
                        .font(TextStyle::new(12.0, 400.0))
                        .color(kit.c.text_muted),
                ),
        )
        .child(
            Button::new(t!("edit.open"))
                .variant(ButtonVariant::Outline)
                .disabled(busy)
                .on_press_tx(|state: &mut State, tx| state.vault.open_editor(true, tx))
                .build(kit)
                .key("entry-edit"),
        )
        .child(
            Button::new(t!("remove.confirm"))
                .variant(ButtonVariant::Ghost)
                .disabled(busy)
                .on_press_tx(|state: &mut State, tx| state.vault.open_delete(tx))
                .build(kit)
                .key("entry-delete")
                .label(t!("remove.open")),
        );
    let password = row()
        .w_full()
        .gap(6.0)
        .center_y()
        .child(
            text(password)
                .font(TextStyle::new(13.0, 400.0).family(Family::Mono))
                .color(kit.c.text_base)
                .wrap_anywhere()
                .grow(1.0)
                .min_w(0.0)
                .key("entry-secret"),
        )
        .child(
            IconButton::new(eye)
                .label(eye_label)
                .help(eye_label)
                .variant(IconButtonVariant::Ghost)
                .disabled(busy)
                .on_press_tx(|state: &mut State, tx| {
                    state
                        .vault
                        .reveal(state.core.clone(), &state.runtime, false, tx);
                })
                .build(kit)
                .key("toggle-reveal"),
        )
        .child(
            IconButton::new(kit.glyph.copy)
                .label(t!("credentials.copyPassword"))
                .help(t!("credentials.copyPassword"))
                .variant(IconButtonVariant::Ghost)
                .disabled(busy)
                .on_press_tx(|state: &mut State, tx| {
                    state
                        .vault
                        .reveal(state.core.clone(), &state.runtime, true, tx);
                })
                .build(kit)
                .key("copy-password"),
        );
    col()
        .label(t!("credentials.details"))
        .min_h(0.0)
        .scroll(ScrollSpec::default())
        .child(
            col()
                .w_full()
                .max_w(720.0)
                .padding(if compact { 22.0 } else { 32.0 })
                .child(header)
                .child(detail_field(
                    t!("entry.username"),
                    body(or_else(&entry.username, t!("common.notSet")), kit),
                    None,
                    kit,
                ))
                .child(detail_field(
                    t!("entry.password"),
                    password,
                    reveal.map(|_| t!("credentials.autoHide")),
                    kit,
                ))
                .child(detail_field(
                    t!("entry.site"),
                    body(or_else(&entry.site, t!("common.notSet")), kit),
                    None,
                    kit,
                ))
                .child(detail_field(
                    t!("entry.notes"),
                    body(notes, kit).key("entry-notes-value"),
                    None,
                    kit,
                )),
        )
}

fn empty(unfiltered: bool, kit: &Kit) -> El {
    let (title, hint) = if unfiltered {
        (t!("credentials.empty"), t!("credentials.emptyHint"))
    } else {
        (t!("credentials.notFound"), t!("credentials.notFoundHint"))
    };
    col()
        .center()
        .gap(6.0)
        .padding(16.0)
        .child(
            icon(kit.glyph.lock, 28.0)
                .color(kit.c.text_muted)
                .a11y_hidden(),
        )
        .child(
            text(title)
                .font(TextStyle::new(15.0, 600.0))
                .color(kit.c.text_base)
                .role("heading")
                .key("empty-logins"),
        )
        .child(
            text(hint)
                .font(TextStyle::new(13.0, 400.0))
                .color(kit.c.text_muted)
                .wrap(),
        )
}
