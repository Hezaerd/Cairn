use std::{
    path::PathBuf,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use cairn_vault::VaultStatus;
use rune::{
    Env, Key, KeyEvent, Mods, Runtime,
    accesskit::Action,
    clipboard::{self, ClipboardContent, ClipboardImage},
};
use zeroize::Zeroizing;

use crate::{app, i18n::t};

#[test]
fn dropped_qr_adds_a_code_with_a_countdown_on_the_virtual_clock() {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.local/rune-authenticator-unit")
        .join(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
                .to_string(),
        );
    let vault_path = directory.join("vault");
    let password = "synthetic authenticator test password";
    std::fs::create_dir_all(&directory).unwrap();
    let link = "otpauth://totp/Fixture:account?secret=GEZDGNBVGY3TQOJQ&issuer=Fixture&period=90";
    let png = directory.join("fixture.png");
    qrcode::QrCode::new(link)
        .unwrap()
        .render::<image::Luma<u8>>()
        .build()
        .save(&png)
        .unwrap();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();
    let mut state = app::State::new(&vault_path, &runtime, false, None);
    runtime
        .block_on(
            state
                .core()
                .unwrap()
                .create_vault(Zeroizing::new(password.into())),
        )
        .unwrap();
    state.status = Ok(VaultStatus::Unlocked);
    let mut view = app::build(state).headless_runtime((920.0, 640.0), Env::new(false, 1.0));
    view.frame(0.0);
    press(&mut view, "nav-authenticator");
    wait_for(&mut view, "authenticator toolbar", |view| {
        view.find("open-add-codes").is_some()
    });
    press(&mut view, "open-add-codes");
    wait_for(&mut view, "QR drop target", |view| {
        view.find("choose-qr").is_some()
    });
    let point = view.find("choose-qr").expect("QR drop target");
    view.drop_files(vec![png.clone()], Some(point));
    wait_for(&mut view, "dropped QR review", |view| {
        view.find("account-0").is_some()
    });
    let tree = view.accessibility_json().to_string();
    assert!(tree.contains("Fixture") && tree.contains("account"));
    assert!(!tree.contains("GEZDGNBVGY3TQOJQ"));
    press(&mut view, "confirm-add-codes");
    wait_for(&mut view, "saved one-time code", |view| {
        view.find("totp-value").is_some()
    });

    let seconds =
        |view: &Runtime<app::State>| view.state.authenticator.current.as_ref().unwrap().seconds;
    wait_for(&mut view, "next TOTP period", |view| seconds(view) > 1);
    let before = seconds(&view);
    view.frame(1.0);
    let after = seconds(&view);
    assert_eq!(after, before - 1);
    let countdown = t!("credentials.codeChanges").replace("{seconds}", &after.to_string());
    assert!(view.accessibility_json().to_string().contains(&countdown));

    let clipboard = clipboard::memory();
    view.use_clipboard(&clipboard);
    let image = ClipboardImage::from_png(std::fs::read(png).unwrap()).unwrap();
    clipboard.set_content(ClipboardContent::new("").with_image(image));
    press(&mut view, "open-add-codes");
    view.key(KeyEvent {
        key: Key::Command('v'),
        mods: Mods {
            cmd: true,
            ..Mods::default()
        },
    });
    wait_for(&mut view, "pasted QR review", |view| {
        view.find("account-0").is_some()
    });
    view.key(Key::Escape.into());
    view.frame(0.0);

    press(&mut view, "copy-code");
    let copied = clipboard.text().expect("copied one-time code");
    assert!(copied.bytes().all(|byte| byte.is_ascii_digit()));
    assert_eq!(copied.len(), 6);
    press(&mut view, "lock");
    assert!(view.find("totp-value").is_none());
    assert!(clipboard.text().is_none());
}

fn press(view: &mut Runtime<app::State>, key: &str) {
    assert!(
        view.accessibility_action(key, Action::Click, None),
        "could not press {key}"
    );
    view.frame(0.05);
}

fn wait_for(
    view: &mut Runtime<app::State>,
    description: &str,
    ready: impl Fn(&Runtime<app::State>) -> bool,
) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while !ready(view) {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {description}"
        );
        view.frame(0.02);
        std::thread::sleep(Duration::from_millis(20));
    }
}
