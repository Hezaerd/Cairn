use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use cairn_app::{PairingRequest, locale::Locale};
use cairn_vault::VaultStatus;
use rune::{App, AppSpec, Env, Key, KeyEvent, Mods, Runtime};

use crate::{
    app::{self, State},
    i18n,
    verify::LOCALE_TEST,
};

fn setup() -> (PathBuf, tokio::runtime::Runtime) {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.local/rune-settings-unit")
        .join(stamp.to_string());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    (directory, runtime)
}

fn click(view: &mut Runtime<State>, key: &str) {
    let (x, y) = view
        .find(key)
        .unwrap_or_else(|| panic!("missing {key}: {}", view.accessibility_json()));
    view.pointer_down(x, y);
    view.pointer_up(x, y);
    view.frame(1.0 / 60.0);
    view.settle_all();
}

#[test]
fn changing_language_updates_the_open_window_and_persists() {
    let _locale = LOCALE_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    i18n::set_locale(Locale::EnUs);
    let (directory, runtime) = setup();
    let mut state = State::new(&directory, &runtime, false, None);
    state.status = Ok(VaultStatus::Unlocked);
    let mut view = app::build(state).headless_runtime((600.0, 480.0), Env::new(false, 1.0));
    view.frame(0.0);
    click(&mut view, "settings");
    assert!(
        view.accessibility_json()
            .to_string()
            .contains("Start with Windows")
    );
    click(&mut view, "language-trigger");
    click(&mut view, "option2");
    let tree = view.accessibility_json().to_string();
    assert!(
        tree.contains("Lancer avec Windows") && tree.contains("Français (France)"),
        "{tree}"
    );
    assert_eq!(
        fs::read_to_string(directory.join("language.json")).unwrap(),
        "\"fr-FR\""
    );
    i18n::set_locale(Locale::EnUs);
}

#[test]
fn pairing_shows_the_request_and_conflict_replaces_it() {
    let _locale = LOCALE_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    i18n::set_locale(Locale::EnUs);
    let (directory, runtime) = setup();
    let mut state = State::new(&directory, &runtime, false, None);
    state.status = Ok(VaultStatus::Unlocked);
    state.settings.pairing_requested(PairingRequest {
        name: "Fixture browser".into(),
        code: "1234 5678".into(),
    });
    let mut view = App::new(AppSpec::new(
        "Cairn",
        (920.0, 640.0),
        || unreachable!(),
        app::view,
    ))
    .init(move || state)
    .headless_runtime((920.0, 640.0), Env::new(false, 1.0));
    view.frame(0.0);
    let tree = view.accessibility_tree();
    assert!(tree.nodes.iter().any(|(_, node)| {
        format!("{:?}", node.role()) == "Dialog"
            && node.label() == Some("Pair a browser?")
            && node
                .description()
                .is_some_and(|description| description.contains("Fixture browser"))
    }));
    assert!(view.accessibility_json().to_string().contains("1234 5678"));

    view.key(KeyEvent {
        key: Key::Escape,
        mods: Mods::default(),
    });
    view.frame(0.0);
    assert!(!view.accessibility_json().to_string().contains("1234 5678"));

    view.update(|state, _| {
        state.settings.pairing_requested(PairingRequest {
            name: "Fixture browser".into(),
            code: "9876 5432".into(),
        });
    });
    view.frame(0.0);
    assert!(view.accessibility_json().to_string().contains("9876 5432"));
    view.update(|state, _| state.settings.pairing_conflict());
    view.frame(0.0);
    let tree = view.accessibility_json().to_string();
    assert!(!tree.contains("9876 5432"));
    assert!(tree.contains("Two browsers asked to pair at the same time"));
}
