use std::{
    io::Cursor,
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use cairn_vault::{NewEntry, Vault};
use rune::{Env, Key, KeyEvent, Mods, Runtime};
use zeroize::Zeroizing;

use crate::app::{self, State};

const MASTER: &str = "synthetic master password";
const PASSWORD: &str = "fixture-password-with-punctuation!";
const NOTES: &str = "private fixture note";

fn workspace() -> (tokio::runtime::Runtime, Runtime<State>) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.local/rune-unit")
        .join(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
                .to_string(),
        );
    let mut vault = Vault::open(&path).unwrap();
    vault.create(Zeroizing::new(MASTER.into())).unwrap();
    for (name, site, username, password, totp) in [
        ("Atlas Books", "", "alice@fixture.example", PASSWORD, ""),
        (
            "Birch Mail",
            "https://birch.example",
            "",
            "other fixture",
            "",
        ),
        (
            "Code only",
            "",
            "alice@fixture.example",
            "",
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        ),
    ] {
        vault
            .save(NewEntry {
                name: name.into(),
                site: site.into(),
                username: username.into(),
                password: password.into(),
                notes: NOTES.into(),
                totp: totp.into(),
            })
            .unwrap();
    }
    let id = vault
        .list()
        .unwrap()
        .into_iter()
        .find(|entry| entry.name == "Birch Mail")
        .unwrap()
        .id;
    let ticket = vault.favicon_lookup(&id, None).unwrap().unwrap().session;
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        2,
        2,
        image::Rgba([0, 0, 255, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let icon = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(png.into_inner())
    );
    vault.favicon_store(&id, &ticket, Some(icon)).unwrap();
    drop(vault);
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let state = State::new(&path, &runtime, false, None);
    let mut view = app::build(state).headless_runtime((920.0, 640.0), Env::new(false, 1.0));
    view.frame(0.0);
    click(&mut view, "master");
    key(&mut view, Key::Text(MASTER.into()));
    key(&mut view, Key::Enter);
    wait_for(&mut view, "Atlas Books", |view| {
        content(view, "entry-title").as_deref() == Some("Atlas Books")
    });
    (runtime, view)
}

fn content(view: &Runtime<State>, key: &str) -> Option<String> {
    view.elements()
        .into_iter()
        .find(|element| element.key.as_deref() == Some(key))
        .and_then(|element| element.text)
}

fn click(view: &mut Runtime<State>, key: &str) {
    let (x, y) = view
        .find(key)
        .unwrap_or_else(|| panic!("Missing control {key}"));
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

fn wait_for(view: &mut Runtime<State>, label: &str, condition: impl Fn(&Runtime<State>) -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !condition(view) {
        assert!(Instant::now() < deadline, "Timed out waiting for {label}");
        std::thread::sleep(Duration::from_millis(10));
        view.frame(0.01);
    }
}

fn assert_hidden(view: &Runtime<State>) {
    assert_eq!(
        content(view, "entry-secret").as_deref(),
        Some("••••••••••••")
    );
    let accessibility = view.accessibility_json().to_string();
    assert!(!accessibility.contains(PASSWORD));
    assert!(!accessibility.contains(NOTES));
    assert!(view.elements().iter().all(|item| {
        item.text
            .as_ref()
            .is_none_or(|text| !text.contains(PASSWORD) && !text.contains(NOTES))
    }));
}

#[test]
fn search_matches_name_site_and_username_ignoring_case_and_excludes_code_only_entries() {
    let (_runtime, mut view) = workspace();
    assert!(!view.accessibility_json().to_string().contains("Code only"));
    click(&mut view, "login-search");
    key(&mut view, Key::Text("BIRCH.EXAMPLE".into()));
    assert_eq!(content(&view, "entry-title").as_deref(), Some("Birch Mail"));
    wait_for(&mut view, "cached icon in both panes", |view| {
        view.elements()
            .iter()
            .filter(|element| element.key.as_deref() == Some("cached-site-icon"))
            .count()
            == 2
    });
    for _ in 0.."BIRCH.EXAMPLE".len() {
        key(&mut view, Key::Backspace);
    }
    key(&mut view, Key::Text("ALICE@FIXTURE".into()));
    assert_eq!(
        content(&view, "entry-title").as_deref(),
        Some("Atlas Books")
    );
    key(&mut view, Key::Text("zzz".into()));
    assert!(view.find("entry-title").is_none());
    assert!(view.find("empty-logins").is_some());
}

#[test]
fn reveal_is_explicit_and_hides_on_toggle_expiry_and_search() {
    let (_runtime, mut view) = workspace();
    assert_hidden(&view);
    for hide in ["toggle", "timer", "search"] {
        click(&mut view, "toggle-reveal");
        wait_for(&mut view, "revealed password", |view| {
            content(view, "entry-secret").as_deref() == Some(PASSWORD)
        });
        assert_eq!(content(&view, "entry-notes-value").as_deref(), Some(NOTES));
        match hide {
            "toggle" => click(&mut view, "toggle-reveal"),
            "timer" => {
                view.frame(31.0);
            }
            _ => {
                click(&mut view, "login-search");
                key(&mut view, Key::Text("ATLAS".into()));
            }
        }
        assert_hidden(&view);
    }
}
