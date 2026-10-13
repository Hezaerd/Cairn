use serde::Serialize;

/// The language the UI and tray use, chosen once from Windows at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

#[tauri::command]
pub fn locale(locale: tauri::State<Locale>) -> Locale {
    *locale
}

#[cfg(test)]
mod tests {
    use super::Locale;

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
}
