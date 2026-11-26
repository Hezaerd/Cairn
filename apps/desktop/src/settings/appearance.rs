use std::{
    fs, io,
    path::{Path, PathBuf},
};

use rune::{Color, El, col, el, row};
use rune_kit::Kit;

use crate::{app::State, i18n::t, theme};

use super::{Notice, card, choice, heading, section};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Scheme {
    System,
    Light,
    Dark,
}

impl Scheme {
    fn label(self) -> &'static str {
        match self {
            Self::System => t!("theme.system"),
            Self::Light => t!("theme.light"),
            Self::Dark => t!("theme.dark"),
        }
    }

    fn hint(self) -> &'static str {
        match self {
            Self::System => t!("theme.useSystem"),
            Self::Light => t!("theme.useLight"),
            Self::Dark => t!("theme.useDark"),
        }
    }

    fn value(self) -> &'static str {
        match self {
            Self::System => "system",
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

pub struct Preference {
    path: PathBuf,
    scheme: Scheme,
}

impl Preference {
    pub fn load(directory: &Path) -> Self {
        let path = directory.join("theme");
        let scheme = match fs::read_to_string(&path).as_deref().map(str::trim) {
            Ok("light") => Scheme::Light,
            Ok("dark") => Scheme::Dark,
            _ => Scheme::System,
        };
        Self { path, scheme }
    }

    pub fn dark(&self, system_dark: bool) -> bool {
        match self.scheme {
            Scheme::System => system_dark,
            Scheme::Light => false,
            Scheme::Dark => true,
        }
    }

    fn save(&mut self, scheme: Scheme) -> io::Result<()> {
        fs::write(&self.path, scheme.value())?;
        self.scheme = scheme;
        Ok(())
    }
}

pub fn view(state: &State, kit: &Kit) -> El {
    section(
        t!("settings.appearance"),
        [card(kit)
            .child(heading(t!("settings.colorScheme"), kit))
            .child(
                row()
                    .gap(12.0)
                    .children([Scheme::System, Scheme::Light, Scheme::Dark].map(|scheme| {
                        choice(
                            scheme.label(),
                            state.settings.theme.scheme == scheme,
                            col()
                                .gap(8.0)
                                .child(preview(scheme))
                                .child(heading(scheme.label(), kit)),
                            false,
                            kit,
                        )
                        .key(scheme.value())
                        .description(scheme.hint())
                        .on_press(move |state: &mut State| {
                            if state.settings.theme.save(scheme).is_err() {
                                state.settings.notify(Notice::ThemeFailed);
                            }
                        })
                    })),
            )],
        kit,
    )
}

fn preview(scheme: Scheme) -> El {
    let light = theme::kit(false);
    let dark = theme::kit(true);
    let mut box_view = row()
        .w_full()
        .aspect_ratio(16.0 / 9.0)
        .min_h(48.0)
        .clip_rounded(4.0)
        .a11y_hidden()
        .radius(4.0);
    match scheme {
        Scheme::Light => box_view = box_view.child(wireframe(&light, false)),
        Scheme::Dark => box_view = box_view.child(wireframe(&dark, false)),
        Scheme::System => {
            box_view = box_view
                .child(wireframe(&light, true))
                .child(wireframe(&dark, true));
        }
    }
    box_view
}

fn bar(width: f32, height: f32, ink: Color) -> El {
    el().w(width)
        .h(height)
        .radius(height / 2.0)
        .fill(ink)
        .shrink()
}

fn wireframe(kit: &Kit, split: bool) -> El {
    let text = kit.c.text_base.alpha(0.2);
    let accent = kit.c.border_focus;
    let item = |selected| {
        row()
            .w_full()
            .h(10.0)
            .center_y()
            .gap(3.0)
            .px(3.0)
            .radius(2.0)
            .fill(if selected {
                kit.c.bg_accent
            } else {
                Color::TRANSPARENT
            })
            .child(bar(4.0, 4.0, if selected { accent } else { text }))
            .child(bar(16.0, 2.0, text))
    };
    col()
        .grow(1.0)
        .shrink()
        .min_w(0.0)
        .clip_rounded(0.0)
        .fill(kit.c.page)
        .border(1.0, kit.c.border_muted)
        .child(
            row()
                .w_full()
                .h(13.0)
                .px(5.0)
                .center_y()
                .gap(4.0)
                .child(bar(5.0, 5.0, text))
                .child(bar(18.0, 3.0, text))
                .child(el().grow(1.0))
                .child(bar(16.0, 5.0, accent)),
        )
        .child(
            row()
                .w_full()
                .grow(1.0)
                .min_h(0.0)
                .child(
                    col()
                        .w(if split { 29.0 } else { 42.0 })
                        .h_full()
                        .padding(3.0)
                        .gap(2.0)
                        .fill(kit.c.layer_01)
                        .children([item(true), item(false), item(false), item(false)]),
                )
                .child(
                    col()
                        .grow(1.0)
                        .shrink()
                        .min_w(0.0)
                        .padding(5.0)
                        .gap(5.0)
                        .child(bar(10.0, 8.0, text))
                        .child(bar(24.0, 4.0, text))
                        .child(bar(38.0, 2.0, text))
                        .child(bar(30.0, 2.0, text)),
                ),
        )
}
