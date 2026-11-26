use cairn_app::locale::Locale;
use cairn_vault::VaultError;
use rune_i18n::I18n;

include!(concat!(env!("OUT_DIR"), "/i18n.rs"));

static TRANSLATOR: I18n = I18n::new(&CATALOG);

macro_rules! t {
    ($name:literal) => {{
        const KEY: rune_i18n::Key = rune_i18n::Key::named($crate::i18n::KEYS, $name);
        $crate::i18n::text(KEY)
    }};
}

pub(crate) use t;

pub fn text(key: rune_i18n::Key) -> &'static str {
    TRANSLATOR.text(key)
}

pub fn set_locale(locale: Locale) {
    TRANSLATOR.set_locale(match locale {
        Locale::EnUs => 0,
        Locale::FrFr => 1,
    });
    rune::set_labels(|label| {
        Some(
            match label {
                rune::Label::Minimize => t!("window.minimize"),
                rune::Label::Maximize => t!("window.maximize"),
                rune::Label::Restore => t!("window.restore"),
                rune::Label::Close => t!("window.close"),
                _ => return None,
            }
            .into(),
        )
    });
}

pub fn vault_error(error: VaultError) -> &'static str {
    match error {
        VaultError::Storage => t!("errors.Storage"),
        VaultError::InUse => t!("errors.InUse"),
        VaultError::AlreadyExists => t!("errors.AlreadyExists"),
        VaultError::Missing => t!("errors.Missing"),
        VaultError::Locked => t!("errors.Locked"),
        VaultError::InvalidInput => t!("errors.InvalidInput"),
        VaultError::InvalidVault => t!("errors.InvalidVault"),
        VaultError::UnsupportedVersion => t!("errors.UnsupportedVersion"),
        VaultError::UnlockFailed => t!("errors.UnlockFailed"),
        VaultError::Randomness => t!("errors.Randomness"),
        VaultError::ChangedOnDisk => t!("errors.ChangedOnDisk"),
    }
}
