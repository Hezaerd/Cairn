use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

/// A language the UI and tray are translated into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Locale {
    #[serde(rename = "en-US")]
    EnUs,
    #[serde(rename = "fr-FR")]
    FrFr,
}

impl Locale {
    pub fn detect() -> Self {
        // Debug builds let end-to-end tests pin the language their selectors use.
        #[cfg(debug_assertions)]
        if let Ok(tag) = std::env::var("CAIRN_TEST_LOCALE") {
            return Self::from_tag(&tag);
        }
        sys_locale::get_locale().map_or(Self::EnUs, |tag| Self::from_tag(&tag))
    }

    /// Any French variant gets French; everything else falls back to English.
    fn from_tag(tag: &str) -> Self {
        let language = tag.split(['-', '_']).next().unwrap_or_default();
        if language.eq_ignore_ascii_case("fr") {
            Self::FrFr
        } else {
            Self::EnUs
        }
    }
}

/// The language chosen in the settings, kept next to the vault. Without a choice, Cairn follows
/// the Windows language read at startup.
pub struct Languages {
    path: PathBuf,
    system: Locale,
    chosen: Mutex<Option<Locale>>,
}

impl Languages {
    pub fn load(directory: &Path) -> Self {
        let path = directory.join("language.json");
        let chosen = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        Self {
            path,
            system: Locale::detect(),
            chosen: Mutex::new(chosen),
        }
    }

    pub fn language(&self) -> Language {
        let chosen = *self.chosen.lock().unwrap_or_else(|error| error.into_inner());
        Language {
            chosen,
            locale: chosen.unwrap_or(self.system),
        }
    }

    fn choose(&self, chosen: Option<Locale>) -> std::io::Result<Language> {
        let mut current = self.chosen.lock().unwrap_or_else(|error| error.into_inner());
        match chosen {
            Some(locale) => {
                if let Some(directory) = self.path.parent() {
                    std::fs::create_dir_all(directory)?;
                }
                std::fs::write(&self.path, serde_json::to_vec(&locale)?)?;
            }
            None => match std::fs::remove_file(&self.path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
                _ => {}
            },
        }
        *current = chosen;
        drop(current);
        Ok(self.language())
    }
}

/// `chosen` is `null` when Cairn follows Windows; `locale` is the language in use.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Language {
    chosen: Option<Locale>,
    pub locale: Locale,
}

#[derive(Debug, Serialize)]
pub enum LanguageError {
    Storage,
}

#[tauri::command]
pub fn locale(languages: tauri::State<Languages>) -> Language {
    languages.language()
}

#[tauri::command]
pub fn set_language(
    app: tauri::AppHandle,
    languages: tauri::State<Languages>,
    chosen: Option<Locale>,
) -> Result<Language, LanguageError> {
    let language = languages
        .choose(chosen)
        .map_err(|_| LanguageError::Storage)?;
    crate::tray::translate(&app, language.locale);
    Ok(language)
}

#[cfg(test)]
mod tests {
    use super::{Languages, Locale};

    #[test]
    fn maps_language_tags() {
        assert_eq!(Locale::from_tag("fr-FR"), Locale::FrFr);
        assert_eq!(Locale::from_tag("fr_CA"), Locale::FrFr);
        assert_eq!(Locale::from_tag("FR"), Locale::FrFr);
        assert_eq!(Locale::from_tag("en-US"), Locale::EnUs);
        assert_eq!(Locale::from_tag("de-DE"), Locale::EnUs);
        assert_eq!(Locale::from_tag("fro"), Locale::EnUs);
        assert_eq!(Locale::from_tag(""), Locale::EnUs);
    }

    #[test]
    fn keeps_the_chosen_language() {
        let directory = std::env::temp_dir().join(format!("cairn-language-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let system = Languages::load(&directory).language().locale;

        let chosen = Languages::load(&directory).choose(Some(Locale::FrFr)).unwrap();
        assert_eq!(chosen.locale, Locale::FrFr);
        let reloaded = Languages::load(&directory).language();
        assert_eq!((reloaded.chosen, reloaded.locale), (Some(Locale::FrFr), Locale::FrFr));

        Languages::load(&directory).choose(None).unwrap();
        let reloaded = Languages::load(&directory).language();
        assert_eq!((reloaded.chosen, reloaded.locale), (None, system));

        std::fs::write(directory.join("language.json"), b"\"de-DE\"").unwrap();
        assert_eq!(Languages::load(&directory).language().chosen, None);
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
