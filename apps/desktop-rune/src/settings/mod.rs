mod appearance;
mod browsers;
mod icons;
pub mod updates;

#[cfg(test)]
mod verify;

use std::{path::Path, time::Duration};

use cairn_app::{
    PairingRequest,
    locale::Locale,
    startup::{self, StartupStatus},
};
use rune::{Color, El, Icon, LiveRegion, ScrollSpec, Tx, col, el, icon, row, text};
use rune_kit::{Checkbox, IconButton, IconButtonVariant, Kit, Select, SelectAppearance};

use crate::{
    app::State,
    i18n::{self, t},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Page {
    General,
    Appearance,
    Extension,
    Updates,
}

impl Page {
    const ALL: [Self; 4] = [
        Self::General,
        Self::Appearance,
        Self::Extension,
        Self::Updates,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::General => t!("settings.general"),
            Self::Appearance => t!("settings.appearance"),
            Self::Extension => t!("settings.extension"),
            Self::Updates => t!("settings.updates"),
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::General => "settings-general",
            Self::Appearance => "settings-appearance",
            Self::Extension => "settings-extension",
            Self::Updates => "settings-updates",
        }
    }

    fn icon(self) -> &'static Icon {
        match self {
            Self::General => &icons::SLIDERS_HORIZONTAL,
            Self::Appearance => &icons::PALETTE,
            Self::Extension => &icons::PUZZLE,
            Self::Updates => &icons::REFRESH_CW,
        }
    }
}

enum Notice {
    LanguageFailed,
    ThemeFailed,
    FolderFailed,
    PairingConflict,
    Paired(String),
    BrowserRenamed,
    BrowserRemoved(String),
    Vault(cairn_vault::VaultError),
}

impl Notice {
    fn message(&self) -> String {
        match self {
            Self::LanguageFailed => t!("settings.languageFailed").into(),
            Self::ThemeFailed => t!("theme.failed").into(),
            Self::FolderFailed => t!("extension.notOpened").into(),
            Self::PairingConflict => t!("browsers.conflict").into(),
            Self::Paired(name) => named(t!("browsers.paired"), name),
            Self::BrowserRenamed => t!("browsers.renamed").into(),
            Self::BrowserRemoved(name) => named(t!("browsers.removed"), name),
            Self::Vault(error) => i18n::vault_error(*error).into(),
        }
    }

    fn is_error(&self) -> bool {
        !matches!(
            self,
            Self::Paired(_) | Self::BrowserRenamed | Self::BrowserRemoved(_)
        )
    }
}

pub struct Settings {
    pub page: Option<Page>,
    pub theme: appearance::Preference,
    pub updates: updates::Updates,
    pairing: Option<PairingRequest>,
    browsers: browsers::Browsers,
    startup: StartupStatus,
    startup_failed: bool,
    language_open: bool,
    notice: Option<(Notice, f64)>,
    now: f64,
}

impl Settings {
    pub fn new(directory: &Path) -> Self {
        Self {
            page: None,
            theme: appearance::Preference::load(directory),
            updates: updates::Updates::new(directory),
            pairing: None,
            browsers: browsers::Browsers::default(),
            startup: startup::startup_status(),
            startup_failed: false,
            language_open: false,
            notice: None,
            now: 0.0,
        }
    }

    pub fn lock(&mut self) {
        self.close();
        self.pairing = None;
    }

    fn close(&mut self) {
        self.page = None;
        self.language_open = false;
        self.browsers = browsers::Browsers::default();
        self.notice = None;
    }

    fn notify(&mut self, notice: Notice) {
        let duration = if matches!(notice, Notice::PairingConflict) {
            16.0
        } else {
            6.0
        };
        self.notice = Some((notice, self.now + duration));
    }

    pub fn pairing_requested(&mut self, request: PairingRequest) {
        self.language_open = false;
        self.pairing = Some(request);
    }

    pub fn pairing_conflict(&mut self) {
        self.pairing = None;
        self.notify(Notice::PairingConflict);
    }

    pub fn poll(&mut self, now: f64, tx: &mut Tx) -> bool {
        self.now = now;
        let expired = self.notice.as_ref().is_some_and(|(_, until)| now >= *until);
        if expired {
            self.notice = None;
        }
        if let Some((_, until)) = &self.notice {
            tx.wake_after(Duration::from_secs_f64((until - now).max(0.0)));
        }
        self.updates.poll(tx) || expired
    }

    pub fn check_pairing(&mut self, core: Option<&cairn_app::App>) -> bool {
        let expired = self.pairing.as_ref().is_some_and(|request| {
            core.and_then(cairn_app::App::pairing_request)
                .is_none_or(|current| request.code != current.code)
        });
        if expired {
            self.pairing = None;
        }
        expired
    }
}

fn show(state: &mut State, page: Page) {
    state.settings.page = Some(page);
    state.settings.language_open = false;
    state.settings.browsers.editing = None;
    state.settings.notice = None;
    match page {
        Page::General => {
            state.settings.startup = startup::startup_status();
            state.settings.startup_failed = false;
        }
        Page::Extension => browsers::refresh(state),
        Page::Updates | Page::Appearance => {}
    }
}

pub fn open_button(kit: &Kit) -> El {
    IconButton::new(&icons::SETTINGS)
        .label(t!("settings.open"))
        .on_press_tx(open)
        .build(kit)
        .key("settings")
}

pub fn open(state: &mut State, tx: &mut Tx) {
    show(state, Page::General);
    tx.focus("settings-general", false);
}

fn close(state: &mut State, tx: &mut Tx) {
    state.settings.close();
    tx.return_focus("settings", false);
}

fn general(state: &State, compact: bool, kit: &Kit, layer: &mut Vec<El>) -> El {
    let settings = &state.settings;
    let options = [
        t!("language.system"),
        t!("language.en-US"),
        t!("language.fr-FR"),
    ];
    let selected = match state.core().and_then(|core| core.language().chosen) {
        None => options[0],
        Some(Locale::EnUs) => options[1],
        Some(Locale::FrFr) => options[2],
    };
    let select = Select::new("language", &options)
        .label(t!("settings.language"))
        .current(Some(selected))
        .appearance(SelectAppearance::Field)
        .width(224.0)
        .open(settings.language_open)
        .on_toggle(|state: &mut State| state.settings.language_open = !state.settings.language_open)
        .on_close(|state: &mut State| state.settings.language_open = false)
        .on_choose(move |state: &mut State, choice, _| {
            state.settings.language_open = false;
            let chosen = match options.iter().position(|option| *option == choice) {
                Some(0) => None,
                Some(1) => Some(Locale::EnUs),
                Some(2) => Some(Locale::FrFr),
                _ => return,
            };
            if let Some(core) = state.core() {
                match core.set_language(chosen) {
                    Ok(language) => i18n::set_locale(language.locale),
                    Err(_) => state.settings.notify(Notice::LanguageFailed),
                }
            }
        })
        .build(kit, layer);
    let startup_hint = if settings.startup_failed {
        t!("startup.failed")
    } else if settings.startup.available {
        t!("startup.hint")
    } else {
        t!("startup.disabled")
    };
    let startup_control = Checkbox::new(settings.startup.enabled)
        .label(t!("startup.title"))
        .hide_label()
        .disabled(!settings.startup.available)
        .on_toggle(|state: &mut State| {
            state.settings.startup_failed =
                startup::startup_set(!state.settings.startup.enabled).is_err();
            state.settings.startup = startup::startup_status();
        })
        .build(kit)
        .description(startup_hint);
    section(
        t!("settings.general"),
        [
            setting_row(
                t!("settings.language"),
                t!("settings.languageHint"),
                select,
                compact,
                kit,
            ),
            setting_row(
                t!("startup.title"),
                startup_hint,
                startup_control,
                compact,
                kit,
            ),
        ],
        kit,
    )
}

pub fn view(state: &State, page: Page, compact: bool, kit: &Kit, layer: &mut Vec<El>) -> El {
    let content = match page {
        Page::General => general(state, compact, kit, layer),
        Page::Appearance => appearance::view(state, kit),
        Page::Extension => browsers::view(state, compact, kit),
        Page::Updates => updates::view(&state.settings.updates, compact, kit),
    };

    let sidebar = col()
        .w(if compact { 170.0 } else { 220.0 })
        .min_h(0.0)
        .px(6.0)
        .py(12.0)
        .gap(2.0)
        .fill(kit.c.layer_01)
        .label(t!("settings.sections"))
        .children(Page::ALL.map(|item| {
            let selected = item == page;
            let marker = el().size(3.0, 18.0).radius(2.0).fill(if selected {
                kit.c.border_focus
            } else {
                Color::TRANSPARENT
            });
            row()
                .key(item.key())
                .w_full()
                .min_h(30.0)
                .center_y()
                .gap(9.0)
                .pr(8.0)
                .radius(kit.radius.md)
                .fill(if selected {
                    kit.c.bg_accent
                } else {
                    Color::TRANSPARENT
                })
                .hover_fill(kit.c.hover)
                .role("button")
                .label(item.label())
                .focus_selected(selected)
                .tab_index(0)
                .focus_ring(2.0, -2.0, kit.c.border_focus)
                .on_press(move |state| show(state, item))
                .child(marker.a11y_hidden())
                .child(
                    icon(item.icon(), 16.0)
                        .color(kit.c.text_muted)
                        .a11y_hidden(),
                )
                .child(heading(item.label(), kit).shrink().min_w(0.0))
        }));

    col()
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .child(
            row()
                .w_full()
                .h(44.0)
                .px(12.0)
                .gap(10.0)
                .center_y()
                .child(
                    IconButton::new(&icons::ARROW_LEFT)
                        .variant(IconButtonVariant::Ghost)
                        .label(t!("settings.back"))
                        .help(t!("settings.back"))
                        .on_press_tx(close)
                        .build(kit)
                        .key("settings-back"),
                )
                .child(
                    icon(&icons::SETTINGS, 16.0)
                        .color(kit.c.text_muted)
                        .a11y_hidden(),
                )
                .child(heading(t!("settings.title"), kit)),
        )
        .child(divider(kit))
        .child(
            row()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .child(sidebar)
                .child(el().w(1.0).fill(kit.c.border_muted))
                .child(
                    kit.scroll_bar(
                        col()
                            .key(page.key().to_owned() + "-scroll")
                            .grow(1.0)
                            .shrink()
                            .min_w(0.0)
                            .min_h(0.0)
                            .scroll(ScrollSpec::default())
                            .child(
                                col()
                                    .w_full()
                                    .items_center()
                                    .px(if compact { 16.0 } else { 24.0 })
                                    .py(24.0)
                                    .child(content.w_full().max_w(760.0)),
                            ),
                    ),
                ),
        )
}

pub fn overlays(state: &State, kit: &Kit, layer: &mut Vec<El>) {
    if let Some((notice, _)) = &state.settings.notice {
        let ink = if notice.is_error() {
            kit.c.danger.fg
        } else {
            kit.c.text_base
        };
        layer.push(
            col()
                .key("settings-notice-wrap")
                .absolute(0.0, 0.0)
                .w_full()
                .h_full()
                .justify_end()
                .items_end()
                .padding(16.0)
                .child(
                    card(kit).w(340.0).key("settings-notice").child(
                        text(notice.message())
                            .font(kit.ty.ui)
                            .color(ink)
                            .wrap()
                            .live_region(LiveRegion::Polite),
                    ),
                ),
        );
    }
    browsers::pairing_dialog(state, kit, layer);
}

fn section<const N: usize>(title: &'static str, cards: [El; N], kit: &Kit) -> El {
    col()
        .gap(8.0)
        .label(title)
        .child(
            text(title)
                .font(kit.ty.small_medium)
                .color(kit.c.text_muted)
                .role("heading"),
        )
        .children(cards)
}

fn setting_row(
    title: &'static str,
    hint: &'static str,
    control: El,
    compact: bool,
    kit: &Kit,
) -> El {
    let layout = if compact {
        col().items_start()
    } else {
        row().center_y()
    };
    card(kit).child(
        layout
            .gap(12.0)
            .w_full()
            .child(
                col()
                    .gap(4.0)
                    .grow(1.0)
                    .shrink()
                    .min_w(0.0)
                    .child(heading(title, kit))
                    .child(description(hint, kit)),
            )
            .child(control),
    )
}

fn card(kit: &Kit) -> El {
    col()
        .w_full()
        .gap(12.0)
        .padding(16.0)
        .radius(kit.radius.lg)
        .fill(kit.c.layer_01.alpha(0.5))
        .border(1.0, kit.c.border_muted)
}

fn heading(value: impl Into<String>, kit: &Kit) -> El {
    text(value.into())
        .font(kit.ty.body_medium)
        .color(kit.c.text_base)
        .wrap()
}

fn description(value: impl Into<String>, kit: &Kit) -> El {
    text(value.into())
        .font(kit.ty.text_xsmall)
        .color(kit.c.text_muted)
        .wrap()
}

fn divider(kit: &Kit) -> El {
    el().w_full().h(1.0).fill(kit.c.border_muted).a11y_hidden()
}

fn named(pattern: &'static str, name: &str) -> String {
    pattern.replace("{name}", name)
}

fn choice(label: &'static str, selected: bool, content: El, disabled: bool, kit: &Kit) -> El {
    col()
        .grow(1.0)
        .shrink()
        .min_w(0.0)
        .gap(8.0)
        .padding(10.0)
        .radius(kit.radius.xl)
        .fill(if selected {
            kit.c.bg_accent
        } else {
            kit.c.page
        })
        .border(
            if selected { 2.0 } else { 1.0 },
            if selected {
                kit.c.border_focus
            } else {
                kit.c.border_muted
            },
        )
        .role("button")
        .label(label)
        .focus_selected(selected)
        .aria_disabled(disabled)
        .tab_index(if disabled { -1 } else { 0 })
        .focus_ring(2.0, -2.0, kit.c.border_focus)
        .hover_fill(if disabled { kit.c.page } else { kit.c.hover })
        .child(content)
}
