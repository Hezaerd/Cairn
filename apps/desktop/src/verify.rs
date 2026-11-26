use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use cairn_vault::Vault;
use rune::{Env, Key, KeyEvent, Mods, Runtime};
use zeroize::Zeroizing;

use crate::{
    app::{self, State},
    i18n,
};

pub static LOCALE_TEST: Mutex<()> = Mutex::new(());

#[test]
fn relocked_vault_masks_passwords_and_reports_errors() {
    let _locale = LOCALE_TEST
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.local/rune-unit")
        .join(format!(
            "{:?}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    let mut vault = Vault::open(&directory).unwrap();
    vault
        .create(Zeroizing::new("synthetic master password".to_owned()))
        .unwrap();
    drop(vault);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let state = State::new(&directory, &runtime, false, None);
    let mut view = app::build(state).headless_runtime((920.0, 640.0), Env::new(false, 1.0));
    view.frame(0.0);
    click(&mut view, "master");
    key(&mut view, Key::Text("synthetic master password".into()));
    key(&mut view, Key::Enter);
    wait_for(&mut view, "unlocked workspace", |view| {
        view.find("lock").is_some()
    });
    click(&mut view, "lock");
    let tree = view.accessibility_tree();
    let focused = tree.nodes.iter().find(|(id, _)| *id == tree.focus).unwrap();
    assert_eq!(focused.1.label(), Some(i18n::t!("auth.masterPassword")));

    let wrong = "wrong fixture password";
    key(&mut view, Key::Text(wrong.into()));
    assert!(
        view.state.form.can_submit(false),
        "relocked field did not take keyboard input"
    );
    let tree = view.accessibility_tree();
    assert!(tree.nodes.iter().any(|(_, node)| {
        format!("{:?}", node.role()) == "PasswordInput"
            && node.label() == Some(i18n::t!("auth.masterPassword"))
            && node.value().is_none()
    }));
    assert!(!view.accessibility_json().to_string().contains(wrong));

    key(&mut view, Key::Enter);
    let message = i18n::t!("errors.UnlockFailed");
    wait_for(&mut view, "wrong-password error after locking", |view| {
        view.accessibility_json().to_string().contains(message)
    });
    assert!(view.find("master").is_some());
    assert!(view.find("lock").is_none());
}

fn click(view: &mut Runtime<State>, name: &str) {
    let (x, y) = view.find(name).expect(name);
    view.pointer_down(x, y);
    view.pointer_up(x, y);
    view.frame(0.0);
}

fn key(view: &mut Runtime<State>, key: Key) {
    view.key(KeyEvent {
        key,
        mods: Mods::default(),
    });
    view.frame(0.0);
}

fn wait_for(view: &mut Runtime<State>, description: &str, ready: impl Fn(&Runtime<State>) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready(view) {
        assert!(
            Instant::now() < deadline,
            "expected {description}, got {:?} with busy={} and error={}",
            view.state.status,
            view.state.busy(),
            view.state.form.error.is_some()
        );
        view.frame(0.02);
        std::thread::sleep(Duration::from_millis(20));
    }
}
