use std::f32::consts::{FRAC_PI_2, TAU};

use rune::{Color, El, Shape, TextStyle, canvas, col, el, row, text};
use rune_kit::{Button, ButtonVariant, Kit, TextInput, Toast};

use super::{Current, Screen, copy, dialog};
use crate::{app::State, i18n::t, site_icon::SiteIcons};

pub fn view(state: &State, kit: &Kit, compact: bool) -> El {
    let screen = &state.authenticator;
    let icons = state.vault.icons();
    let mut layers = Vec::new();
    dialog::build(screen, kit, &mut layers);
    col()
        .key("authenticator-workspace")
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .child(
            row()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .child(sidebar(screen, icons, kit).w(if compact { 210.0 } else { 270.0 }))
                .child(details(screen, icons, kit)),
        )
        .children(screen.notice.as_ref().map(|(message, _)| {
            Toast::new("code-notice", message)
                .build(kit)
                .pin(None, None, Some(16.0), Some(16.0))
        }))
        .children(layers)
}

pub fn add_button(state: &State, kit: &Kit) -> El {
    Button::new(t!("authenticator.open"))
        .variant(ButtonVariant::Submit)
        .disabled(state.authenticator.saving.is_some())
        .on_press_tx(dialog::open)
        .build(kit)
        .key("open-add-codes")
        .h(32.0)
}

fn sidebar(screen: &Screen, icons: &SiteIcons, kit: &Kit) -> El {
    let selected = screen.selected_entry();
    let rows = screen.visible_entries().map(|entry| {
        let active = selected.is_some_and(|selected| selected.id == entry.id);
        let secondary = [&entry.username, &entry.site]
            .into_iter()
            .find(|value| !value.is_empty())
            .map_or(t!("credentials.noUsername"), String::as_str);
        let id = entry.id.clone();
        let item = row()
            .key(format!("code-row-{id}"))
            .w_full()
            .h(42.0)
            .role("option")
            .label(&entry.name)
            .description(secondary)
            .center_y()
            .px(10.0)
            .gap(10.0)
            .radius(kit.radius.md)
            .focusable(true)
            .focus_selected(active)
            .hover(kit.c.hover)
            .on_press(move |state: &mut State| state.authenticator.selected = Some(id.clone()))
            .child(icons.view(entry, false, kit))
            .child(
                col()
                    .grow(1.0)
                    .min_w(0.0)
                    .gap(2.0)
                    .a11y_hidden()
                    .child(
                        text(&entry.name)
                            .font(TextStyle::new(12.0, 600.0))
                            .color(kit.c.text_base)
                            .truncate(),
                    )
                    .child(label(secondary, 11.0, kit.c.text_muted).truncate()),
            );
        let item = if active {
            item.fill(kit.selection()).child(
                el().w(3.0)
                    .h(18.0)
                    .radius(kit.radius.sm)
                    .fill(kit.c.border_focus)
                    .pin(Some(0.0), Some(12.0), None, None)
                    .a11y_hidden(),
            )
        } else {
            item
        };
        item.focus_ring(2.0, 0.0, kit.c.border_focus)
            .focus_ring_radius(kit.radius.md)
    });
    col()
        .key("code-list")
        .h_full()
        .min_h(0.0)
        .role("group")
        .label(t!("authenticator.list"))
        .fill(kit.c.surface_raised)
        .border_sides([0.0, 1.0, 0.0, 0.0], kit.c.border_muted)
        .child(
            col()
                .px(12.0)
                .pt(16.0)
                .pb(10.0)
                .gap(10.0)
                .child(
                    TextInput::new(&screen.query)
                        .label(t!("authenticator.search"))
                        .placeholder(t!("credentials.searchPlaceholder"))
                        .on_edit(|state: &mut State| &mut state.authenticator.query)
                        .build(kit)
                        .key("code-search")
                        .w_full(),
                )
                .child(label(t!("authenticator.all"), 11.0, kit.c.text_muted)),
        )
        .child(
            col()
                .key("code-list-scroll")
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .role("listbox")
                .focus_group()
                .scroll(Default::default())
                .child(
                    col()
                        .w_full()
                        .gap(2.0)
                        .px(6.0)
                        .pb(6.0)
                        .children(rows)
                        .children(selected.is_none().then(|| {
                            let message = if screen.query.text.is_empty() {
                                t!("authenticator.empty")
                            } else {
                                t!("credentials.noResults")
                            };
                            label(message, 12.0, kit.c.text_muted)
                                .px(10.0)
                                .py(8.0)
                                .wrap()
                        })),
                ),
        )
}

fn details(screen: &Screen, icons: &SiteIcons, kit: &Kit) -> El {
    let pane = col()
        .key("code-details")
        .role("group")
        .label(t!("authenticator.details"))
        .grow(1.0)
        .min_w(0.0)
        .h_full()
        .min_h(0.0);
    let Some(entry) = screen.selected_entry() else {
        let searching = !screen.query.text.is_empty();
        let title = if searching {
            t!("authenticator.notFound")
        } else {
            t!("authenticator.empty")
        };
        let hint = if searching {
            t!("credentials.notFoundHint")
        } else {
            t!("authenticator.emptyHint")
        };
        return pane
            .center()
            .padding(24.0)
            .gap(8.0)
            .child(label(title, 15.0, kit.c.text_base))
            .child(label(hint, 12.0, kit.c.text_muted).wrap());
    };
    let busy = screen.saving.is_some();
    let current = screen.current.as_ref().filter(|code| entry.id == code.id);
    pane.scroll(Default::default()).child(
        col()
            .w_full()
            .max_w(720.0)
            .padding(24.0)
            .child(
                row()
                    .w_full()
                    .center_y()
                    .gap(12.0)
                    .pb(24.0)
                    .child(icons.view(entry, true, kit))
                    .child(
                        col()
                            .grow(1.0)
                            .min_w(0.0)
                            .gap(4.0)
                            .child(
                                text(&entry.name)
                                    .font(TextStyle::new(20.0, 600.0))
                                    .color(kit.c.text_base)
                                    .wrap(),
                            )
                            .child(
                                label(
                                    if entry.has_password {
                                        t!("authenticator.withLogin")
                                    } else {
                                        t!("credentials.codeOnly")
                                    },
                                    12.0,
                                    kit.c.text_muted,
                                )
                                .wrap(),
                            ),
                    )
                    .child(
                        Button::new(t!("edit.open"))
                            .variant(ButtonVariant::Outline)
                            .disabled(busy)
                            .on_press_tx(dialog::edit)
                            .build(kit)
                            .key("edit-selected-code"),
                    )
                    .child(
                        Button::new(t!("authenticator.remove"))
                            .variant(ButtonVariant::Ghost)
                            .disabled(busy)
                            .on_press(dialog::remove)
                            .build(kit)
                            .key("remove-selected-code"),
                    ),
            )
            .child(field(
                t!("credentials.code"),
                code_row(current, busy, kit),
                kit,
            ))
            .child(field(
                t!("entry.username"),
                detail_value(&entry.username, kit),
                kit,
            ))
            .child(field(t!("entry.site"), detail_value(&entry.site, kit), kit)),
    )
}

fn code_row(current: Option<&Current>, busy: bool, kit: &Kit) -> El {
    let Some(current) = current else {
        return label(t!("common.notSet"), 13.0, kit.c.text_muted);
    };
    let code = &current.value.code;
    let (left, right) = code.split_at(code.len().div_ceil(2));
    let seconds = current.seconds;
    let countdown = t!("credentials.codeChanges").replace("{seconds}", &seconds.to_string());
    row()
        .w_full()
        .center_y()
        .gap(10.0)
        .child(
            text(format!("{left} {right}"))
                .key("totp-value")
                .font(TextStyle::new(20.0, 400.0).mono())
                .color(kit.c.text_base),
        )
        .child(
            row()
                .key("totp-countdown")
                .center_y()
                .gap(5.0)
                .role("group")
                .label(countdown)
                .child(ring(seconds as f32 / current.value.period as f32, kit))
                .child(label(format!("{seconds} s"), 11.0, kit.c.text_muted).a11y_hidden()),
        )
        .child(el().grow(1.0))
        .child(
            Button::new(t!("credentials.copyCode"))
                .variant(ButtonVariant::Outline)
                .icon(kit.glyph.copy)
                .disabled(busy)
                .on_press_tx(copy)
                .build(kit)
                .key("copy-code"),
        )
}

fn ring(progress: f32, kit: &Kit) -> El {
    let points = |fraction: f32| {
        (0..=32)
            .map(|step| {
                let radians = TAU * (step as f32 / 32.0) * fraction - FRAC_PI_2;
                [8.0 + 6.5 * radians.cos(), 8.0 + 6.5 * radians.sin()]
            })
            .collect::<Vec<_>>()
    };
    canvas(
        Shape::new()
            .stroke(points(1.0), 1.5, kit.c.border_base)
            .stroke(points(progress.clamp(0.0, 1.0)), 1.5, kit.c.border_focus),
    )
    .size(16.0, 16.0)
    .a11y_hidden()
}

fn field(title: &str, value: El, kit: &Kit) -> El {
    col()
        .w_full()
        .py(12.0)
        .gap(6.0)
        .border_sides([1.0, 0.0, 0.0, 0.0], kit.c.border_muted)
        .child(label(title, 12.0, kit.c.text_muted))
        .child(value)
}

fn detail_value(value: &str, kit: &Kit) -> El {
    label(
        if value.is_empty() {
            t!("common.notSet")
        } else {
            value
        },
        13.0,
        kit.c.text_base,
    )
    .wrap()
}

pub(super) fn label(value: impl Into<String>, size: f32, ink: Color) -> El {
    text(value).font(TextStyle::new(size, 400.0)).color(ink)
}
