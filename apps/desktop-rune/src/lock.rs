use cairn_vault::{VaultError, VaultStatus};
use rune::{Color, El, LiveRegion, TextEdit, TextStyle, Tx, col, text};
use rune_kit::{Button, ButtonVariant, Kit, TextInput};
use zeroize::Zeroizing;

use crate::{
    app::State,
    i18n::{t, vault_error},
    title_bar,
};

pub enum AuthError {
    Mismatch,
    Vault(VaultError),
}

pub struct Form {
    master: TextEdit,
    confirmation: TextEdit,
    pub error: Option<AuthError>,
}

impl Default for Form {
    fn default() -> Self {
        let mut master = TextEdit::new("").secure();
        master.focused = true;
        Self {
            master,
            confirmation: TextEdit::new("").secure(),
            error: None,
        }
    }
}

impl Form {
    pub fn clear(&mut self) {
        self.master.clear();
        self.confirmation.clear();
        self.error = None;
    }

    pub fn can_submit(&self, creating: bool) -> bool {
        !self.master.text.is_empty() && (!creating || !self.confirmation.text.is_empty())
    }
}

fn submit(state: &mut State, tx: &mut Tx) {
    let creating = state.status == Ok(VaultStatus::Missing);
    if state.busy() || !state.form.can_submit(creating) {
        return;
    }
    let password = Zeroizing::new(std::mem::take(&mut state.form.master.text));
    let confirmation = Zeroizing::new(std::mem::take(&mut state.form.confirmation.text));
    state.form.clear();
    if creating && *password != *confirmation {
        state.form.error = Some(AuthError::Mismatch);
        tx.focus("master", false);
        return;
    }
    state.authenticate(password, tx);
}

fn label(value: &'static str, size: f32, weight: f32, ink: Color) -> El {
    text(value).font(TextStyle::new(size, weight)).color(ink)
}

fn heading(title: &'static str, kit: &Kit) -> El {
    label(title, 22.0, 600.0, kit.c.text_base).role("heading")
}

fn panel(content: El) -> El {
    col()
        .w_full()
        .grow(1.0)
        .min_h(0.0)
        .px(32.0)
        .pb(32.0)
        .center()
        .child(content.w(320.0))
}

fn field(
    key: &'static str,
    name: &'static str,
    state: &State,
    edit: fn(&mut State) -> &mut TextEdit,
    value: &TextEdit,
    kit: &Kit,
) -> El {
    col()
        .gap(6.0)
        .child(label(name, 13.0, 500.0, kit.c.text_base))
        .child(
            TextInput::new(value)
                .label(name)
                .secure()
                .height(32.0)
                .invalid(state.form.error.is_some())
                .disabled(state.busy())
                .on_edit(edit)
                .on_submit(submit)
                .build(kit)
                .key(key)
                .w_full(),
        )
}

fn alert(message: &'static str, kit: &Kit) -> El {
    label(message, 13.0, 400.0, kit.c.danger.fg)
        .wrap()
        .key("auth-error")
        .live_region(LiveRegion::Assertive)
}

pub fn view(state: &State, kit: &Kit) -> El {
    let creating = state.status == Ok(VaultStatus::Missing);
    let (title, description, action) = if creating {
        (
            t!("auth.createTitle"),
            t!("auth.createDescription"),
            t!("auth.create"),
        )
    } else {
        (
            t!("auth.lockedTitle"),
            t!("auth.unlockDescription"),
            t!("auth.unlock"),
        )
    };
    let confirmation = creating.then(|| {
        field(
            "confirmation",
            t!("auth.confirmation"),
            state,
            |state| &mut state.form.confirmation,
            &state.form.confirmation,
            kit,
        )
    });
    let error = state.form.error.as_ref().map(|error| {
        let message = match error {
            AuthError::Mismatch => t!("auth.mismatch"),
            AuthError::Vault(error) => vault_error(*error),
        };
        alert(message, kit)
    });
    let form = col()
        .gap(18.0)
        .child(field(
            "master",
            t!("auth.masterPassword"),
            state,
            |state| &mut state.form.master,
            &state.form.master,
            kit,
        ))
        .children(confirmation)
        .children(error)
        .child(
            Button::new(if state.busy() {
                t!("auth.opening")
            } else {
                action
            })
            .variant(ButtonVariant::Submit)
            .disabled(state.busy() || !state.form.can_submit(creating))
            .on_press_tx(submit)
            .build(kit)
            .key("authenticate")
            .h(32.0)
            .w_full(),
        );
    panel(
        col()
            .gap(24.0)
            .children(
                state
                    .caption_font
                    .as_ref()
                    .map(|family| title_bar::glyph("\u{e72e}", family, 28.0, kit.c.text_muted)),
            )
            .child(
                col()
                    .gap(8.0)
                    .child(heading(title, kit))
                    .child(label(description, 13.0, 400.0, kit.c.text_muted).wrap()),
            )
            .child(form),
    )
}

pub fn recovery(kit: &Kit) -> El {
    panel(
        col()
            .gap(14.0)
            .child(heading(t!("app.recoveryTitle"), kit))
            .child(label(t!("app.recoveryDescription"), 13.0, 400.0, kit.c.text_muted).wrap())
            .child(label(
                r"%LOCALAPPDATA%\com.hezaerd.cairn",
                13.0,
                400.0,
                kit.c.text_muted,
            ))
            .child(
                Button::new(t!("app.checkAgain"))
                    .on_press_tx(State::retry)
                    .build(kit),
            ),
    )
}

pub fn unavailable(error: VaultError, kit: &Kit) -> El {
    panel(alert(vault_error(error), kit))
}
