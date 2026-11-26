use std::{
    fs,
    path::{Path, PathBuf},
};

use cairn_vault::{PasswordOptions, VaultError, generate_password};
use rune::{El, Family, LiveRegion, TextStyle, col, row, text};
use rune_kit::{Button, ButtonVariant, Checkbox, Kit, Slider, popover};
use zeroize::Zeroizing;

use crate::{
    app::State,
    i18n::{t, vault_error},
};

const MIN_LENGTH: usize = 8;
const MAX_LENGTH: usize = 128;

pub struct Preferences {
    path: PathBuf,
    options: PasswordOptions,
}

impl Preferences {
    pub fn load(directory: &Path) -> Self {
        let path = directory.join("password-generator.json");
        let options = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<PasswordOptions>(&bytes).ok())
            .filter(|options| {
                (MIN_LENGTH..=MAX_LENGTH).contains(&options.length)
                    && GROUPS.iter().any(|(_, field)| *field(&mut options.clone()))
            })
            .unwrap_or_default();
        Self { path, options }
    }

    fn save(&self) -> std::io::Result<()> {
        let PasswordOptions {
            length,
            lowercase,
            uppercase,
            digits,
            symbols,
            avoid_ambiguous,
        } = self.options;
        fs::write(
            &self.path,
            serde_json::json!({
                "length": length,
                "lowercase": lowercase,
                "uppercase": uppercase,
                "digits": digits,
                "symbols": symbols,
                "avoidAmbiguous": avoid_ambiguous,
            })
            .to_string(),
        )
    }
}

pub type Preview = Result<Zeroizing<String>, VaultError>;

type Group = (&'static str, fn(&mut PasswordOptions) -> &mut bool);

const GROUPS: [Group; 4] = [
    ("lowercase", |options| &mut options.lowercase),
    ("uppercase", |options| &mut options.uppercase),
    ("digits", |options| &mut options.digits),
    ("symbols", |options| &mut options.symbols),
];

impl Preferences {
    pub fn generate(&self) -> Preview {
        generate_password(&self.options)
    }

    fn change(&mut self, change: impl FnOnce(&mut PasswordOptions)) -> Preview {
        change(&mut self.options);
        self.save().map_err(|_| VaultError::Storage)?;
        self.generate()
    }
}

fn revise(state: &mut State, change: impl FnOnce(&mut PasswordOptions)) {
    let preview = state.vault.preferences.change(change);
    state.vault.set_preview(preview);
}

pub fn view(preferences: &Preferences, preview: &Preview, kit: &Kit) -> El {
    let mut options = preferences.options;
    let active = GROUPS
        .iter()
        .filter(|(_, field)| *field(&mut options))
        .count();
    let choices = GROUPS.into_iter().zip([
        t!("generator.lowercase"),
        t!("generator.uppercase"),
        t!("generator.digits"),
        t!("generator.symbols"),
    ]);
    let value = match preview {
        Ok(password) => text(password.as_str())
            .font(TextStyle::new(13.0, 400.0).family(Family::Mono))
            .color(kit.c.text_base),
        Err(error) => text(vault_error(*error)).color(kit.c.danger.fg),
    };
    let content = col()
        .w(320.0)
        .padding(16.0)
        .gap(10.0)
        .child(
            text(t!("generator.title"))
                .font(TextStyle::new(13.0, 600.0))
                .color(kit.c.text_base)
                .role("heading"),
        )
        .child(
            value
                .key("generated-password")
                .label(t!("generator.preview"))
                .live_region(LiveRegion::Polite)
                .wrap_anywhere()
                .w_full()
                .min_h(48.0)
                .padding(8.0)
                .fill(kit.c.layer_01)
                .radius(kit.radius.md)
                .border(1.0, kit.c.border_muted),
        )
        .child(
            row()
                .w_full()
                .justify_between()
                .child(text(t!("generator.length")).color(kit.c.text_base))
                .child(text(options.length.to_string()).color(kit.c.text_base)),
        )
        .child(
            Slider::new("generator-length", options.length as f32)
                .range(MIN_LENGTH as f32..=MAX_LENGTH as f32)
                .step(1.0)
                .label(t!("generator.length"))
                .hide_label()
                .on_change::<State>(|state, length, _| {
                    revise(state, |options| options.length = length as usize)
                })
                .build(kit)
                .w_full(),
        )
        .children(choices.map(|((key, field), label)| {
            let enabled = *field(&mut options);
            Checkbox::new(enabled)
                .label(label)
                .disabled(enabled && active == 1)
                .on_toggle::<State>(move |state| {
                    revise(state, |options| *field(options) = !*field(options))
                })
                .build(kit)
                .key(format!("generator-{key}"))
        }))
        .child(
            Checkbox::new(options.avoid_ambiguous)
                .label(t!("generator.avoidAmbiguous"))
                .on_toggle::<State>(|state| {
                    revise(state, |options| {
                        options.avoid_ambiguous = !options.avoid_ambiguous
                    })
                })
                .build(kit)
                .key("generator-ambiguous"),
        )
        .child(
            row()
                .w_full()
                .justify_end()
                .gap(8.0)
                .child(
                    Button::new(t!("generator.regenerate"))
                        .variant(ButtonVariant::Outline)
                        .on_press_tx(|state: &mut State, _| state.vault.regenerate())
                        .build(kit)
                        .key("regenerate"),
                )
                .child(
                    Button::new(t!("generator.use"))
                        .variant(ButtonVariant::Submit)
                        .disabled(preview.is_err())
                        .on_press_tx(|state: &mut State, tx| state.vault.use_generated(tx))
                        .build(kit)
                        .key("use-generated"),
                ),
        );
    popover::raised(kit, content, kit.radius.lg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_only_options_and_reuses_them_after_restart() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../.local/rune-unit")
            .join(format!("generator-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let mut preferences = Preferences::load(&directory);
        let password = preferences
            .change(|options| {
                *options = PasswordOptions {
                    length: 32,
                    symbols: false,
                    avoid_ambiguous: true,
                    ..PasswordOptions::default()
                };
            })
            .unwrap();
        let persisted = fs::read_to_string(&preferences.path).unwrap();
        assert!(!persisted.contains(password.as_str()));
        let reopened = Preferences::load(&directory);
        assert_eq!(reopened.options, preferences.options);
        let generated = reopened.generate().unwrap();
        assert_eq!(generated.len(), 32);
        assert!(
            generated
                .chars()
                .all(|c| c.is_ascii_alphanumeric() && !"Il1O0o".contains(c))
        );
    }
}
