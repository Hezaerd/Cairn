use super::*;
use std::{fs, sync::OnceLock};

const PASSWORD: &str = "cairn-test-master-password";
const SECRET: &str = "test-only-credential-9x!";

fn password() -> Zeroizing<String> {
    Zeroizing::new(PASSWORD.to_owned())
}
fn entry(name: &str) -> NewEntry {
    NewEntry {
        name: name.into(),
        site: "https://example.com".into(),
        username: "test@example.com".into(),
        password: SECRET.into(),
        notes: "private note".into(),
    }
}
fn fixture() -> (tempfile::TempDir, Vault) {
    static BYTES: OnceLock<Vec<u8>> = OnceLock::new();
    let bytes = BYTES.get_or_init(|| {
        let dir = tempfile::tempdir().unwrap();
        let mut vault = Vault::open(dir.path()).unwrap();
        vault.create(password()).unwrap();
        fs::read(dir.path().join("vault.cairn")).unwrap()
    });
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("vault.cairn"), bytes).unwrap();
    let vault = Vault::open(dir.path()).unwrap();
    (dir, vault)
}

#[test]
fn create_save_lock_restart_and_reveal() {
    let dir = tempfile::tempdir().unwrap();
    let mut vault = Vault::open(dir.path()).unwrap();
    assert_eq!(vault.status().unwrap(), VaultStatus::Missing);
    assert_eq!(
        vault.create(Zeroizing::new("short".into())),
        Err(VaultError::InvalidInput)
    );
    assert!(!dir.path().join("vault.cairn").exists());
    vault.create(password()).unwrap();
    assert_eq!(vault.create(password()), Err(VaultError::AlreadyExists));
    vault.save(entry("Personal account")).unwrap();
    let summaries = vault.list().unwrap();
    assert_eq!(summaries.len(), 1);
    assert!(!serde_json::to_string(&summaries).unwrap().contains(SECRET));
    let id = summaries[0].id.clone();
    assert_eq!(vault.reveal(&id).unwrap().password, SECRET);
    assert_eq!(vault.reveal(&id).unwrap().notes, "private note");
    vault.lock();
    assert!(matches!(vault.list(), Err(VaultError::Locked)));
    assert!(matches!(vault.reveal(&id), Err(VaultError::Locked)));
    assert_eq!(vault.save(entry("locked")), Err(VaultError::Locked));
    drop(vault);
    let mut reopened = Vault::open(dir.path()).unwrap();
    assert_eq!(reopened.status().unwrap(), VaultStatus::Locked);
    assert_eq!(
        reopened.unlock(Zeroizing::new("wrong password".into())),
        Err(VaultError::UnlockFailed)
    );
    assert_eq!(reopened.status().unwrap(), VaultStatus::Locked);
    reopened.unlock(password()).unwrap();
    assert_eq!(reopened.reveal(&id).unwrap().password, SECRET);
    for file in [
        dir.path().join("vault.cairn"),
        dir.path().join("backups/previous.cairn"),
    ] {
        let bytes = fs::read_to_string(file).unwrap();
        for text in [
            PASSWORD,
            SECRET,
            "Personal account",
            "example.com",
            "private note",
        ] {
            assert!(!bytes.contains(text));
        }
    }
}

#[test]
fn backup_is_the_previous_complete_encrypted_version() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("first")).unwrap();
    let first = fs::read(dir.path().join("vault.cairn")).unwrap();
    vault.save(entry("second")).unwrap();
    let second = fs::read(dir.path().join("vault.cairn")).unwrap();
    assert_ne!(first, second);
    assert_eq!(
        fs::read(dir.path().join("backups/previous.cairn")).unwrap(),
        first
    );
    drop(vault);
    fs::copy(
        dir.path().join("backups/previous.cairn"),
        dir.path().join("vault.cairn"),
    )
    .unwrap();
    let mut restored = Vault::open(dir.path()).unwrap();
    restored.unlock(password()).unwrap();
    assert_eq!(restored.list().unwrap().len(), 1);
}

#[test]
fn rejects_tampering_without_overwriting_the_file() {
    let (dir, mut vault) = fixture();
    let original = fs::read(dir.path().join("vault.cairn")).unwrap();
    for field in ["wrapped_key", "ciphertext", "data_nonce", "key_nonce"] {
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        let byte = value[field][0].as_u64().unwrap();
        value[field][0] = serde_json::json!(byte ^ 1);
        let corrupted = serde_json::to_vec(&value).unwrap();
        fs::write(dir.path().join("vault.cairn"), &corrupted).unwrap();
        assert_eq!(vault.unlock(password()), Err(VaultError::UnlockFailed));
        assert_eq!(vault.status().unwrap(), VaultStatus::Locked);
        assert_eq!(fs::read(dir.path().join("vault.cairn")).unwrap(), corrupted);
    }
}

#[test]
fn rejects_untrusted_costs_versions_truncation_and_oversized_files() {
    let (dir, mut vault) = fixture();
    let original = fs::read(dir.path().join("vault.cairn")).unwrap();
    let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
    value["header"]["memory_kib"] = serde_json::json!(u32::MAX);
    fs::write(
        dir.path().join("vault.cairn"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert_eq!(vault.unlock(password()), Err(VaultError::InvalidVault));
    value["header"]["version"] = serde_json::json!(99);
    fs::write(
        dir.path().join("vault.cairn"),
        serde_json::to_vec(&value).unwrap(),
    )
    .unwrap();
    assert_eq!(
        vault.unlock(password()),
        Err(VaultError::UnsupportedVersion)
    );
    fs::write(
        dir.path().join("vault.cairn"),
        &original[..original.len() / 2],
    )
    .unwrap();
    assert_eq!(vault.unlock(password()), Err(VaultError::InvalidVault));
    File::create(dir.path().join("vault.cairn"))
        .unwrap()
        .set_len((MAX_FILE_BYTES + 1) as u64)
        .unwrap();
    assert_eq!(vault.unlock(password()), Err(VaultError::InvalidVault));
    assert_eq!(vault.create(password()), Err(VaultError::AlreadyExists));
}

#[test]
fn excludes_other_writers_and_releases_lock_on_drop() {
    let (dir, vault) = fixture();
    assert!(matches!(Vault::open(dir.path()), Err(VaultError::InUse)));
    drop(vault);
    assert!(Vault::open(dir.path()).is_ok());
}

#[test]
fn missing_primary_preserves_surviving_backup() {
    let (dir, mut vault) = fixture();
    let primary = dir.path().join("vault.cairn");
    let backup = dir.path().join("backups/previous.cairn");
    fs::rename(&primary, &backup).unwrap();
    let before = fs::read(&backup).unwrap();
    assert_eq!(vault.status().unwrap(), VaultStatus::Recovery);
    assert_eq!(vault.create(password()), Err(VaultError::AlreadyExists));
    assert_eq!(fs::read(backup).unwrap(), before);
    assert!(!primary.exists());
}

#[test]
fn failed_backup_does_not_change_primary_and_locks_session() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    let before = fs::read(dir.path().join("vault.cairn")).unwrap();
    fs::create_dir(dir.path().join("backups/previous.cairn")).unwrap();
    assert_eq!(vault.save(entry("not committed")), Err(VaultError::Storage));
    assert_eq!(vault.status().unwrap(), VaultStatus::Locked);
    assert_eq!(fs::read(dir.path().join("vault.cairn")).unwrap(), before);
    vault.unlock(password()).unwrap();
    assert!(vault.list().unwrap().is_empty());
}

#[test]
fn refuses_external_changes_and_expires_idle_session() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    fs::write(dir.path().join("vault.cairn"), b"external change").unwrap();
    assert_eq!(
        vault.save(entry("no overwrite")),
        Err(VaultError::ChangedOnDisk)
    );
    assert_eq!(
        fs::read(dir.path().join("vault.cairn")).unwrap(),
        b"external change"
    );
    vault.session.as_mut().unwrap().last_used = Instant::now() - IDLE_TIMEOUT;
    assert!(vault.expire());
    assert!(matches!(vault.list(), Err(VaultError::Locked)));
}

#[test]
fn favicon_cache_is_encrypted_persistent_shared_and_session_bound() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("First")).unwrap();
    vault.save(entry("Second")).unwrap();
    let entries = vault.list().unwrap();
    let first = vault.favicon_lookup(&entries[0].id, None).unwrap().unwrap();
    assert!(first.stale && first.image.is_none());
    let image = "data:image/png;base64,c3ludGhldGljLWljb24=".to_owned();
    vault
        .favicon_store(&entries[0].id, &first.session, Some(image.clone()))
        .unwrap();
    let shared = vault.favicon_lookup(&entries[1].id, None).unwrap().unwrap();
    assert_eq!(shared.image.as_ref(), Some(&image));
    assert!(!shared.stale);
    let encrypted = fs::read(dir.path().join("favicons.cairn")).unwrap();
    for value in ["https://example.com", image.as_str(), "synthetic-icon"] {
        assert!(
            !encrypted
                .windows(value.len())
                .any(|bytes| bytes == value.as_bytes())
        );
    }
    vault.lock();
    assert!(matches!(
        vault.favicon_lookup(&entries[0].id, None),
        Err(VaultError::Locked)
    ));
    assert!(!vault.favicon_session(&first.session));
    drop(vault);
    let mut reopened = Vault::open(dir.path()).unwrap();
    reopened.unlock(password()).unwrap();
    assert_eq!(
        reopened
            .favicon_lookup(&entries[1].id, None)
            .unwrap()
            .unwrap()
            .image
            .as_ref(),
        Some(&image)
    );
    assert!(matches!(
        reopened.favicon_store(&entries[0].id, &first.session, None),
        Err(VaultError::Locked)
    ));
}

#[test]
fn favicon_expiry_failure_and_corruption_do_not_affect_credentials() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("First")).unwrap();
    let id = vault.list().unwrap()[0].id.clone();
    let lookup = vault.favicon_lookup(&id, None).unwrap().unwrap();
    vault.favicon_store(&id, &lookup.session, None).unwrap();
    let missing = vault.favicon_lookup(&id, None).unwrap().unwrap();
    assert!(!missing.stale && missing.image.is_none());
    let image = "data:image/png;base64,dGVzdA==".to_owned();
    vault
        .favicon_store(&id, &lookup.session, Some(image.clone()))
        .unwrap();
    // Expire a successful record without waiting thirty days.
    vault.session.as_mut().unwrap().favicons.as_mut().unwrap()[0].retry_at = 0;
    assert!(vault.favicon_lookup(&id, None).unwrap().unwrap().stale);
    vault.favicon_store(&id, &lookup.session, None).unwrap();
    let stale = vault.favicon_lookup(&id, None).unwrap().unwrap();
    assert_eq!(stale.image, Some(image));
    assert!(!stale.stale);
    vault.lock();
    fs::write(dir.path().join("favicons.cairn"), b"corrupt-cache").unwrap();
    vault.unlock(password()).unwrap();
    assert!(
        vault
            .favicon_lookup(&id, None)
            .unwrap()
            .unwrap()
            .image
            .is_none()
    );
    assert_eq!(vault.reveal(&id).unwrap().password, SECRET);
    // Background asset work must never extend the five-minute idle timeout.
    vault.session.as_mut().unwrap().last_used = Instant::now() - IDLE_TIMEOUT;
    assert!(matches!(
        vault.favicon_lookup(&id, None),
        Err(VaultError::Locked)
    ));
}

fn update(name: &str, password: Option<&str>, notes: Option<&str>) -> EntryUpdate {
    EntryUpdate {
        name: name.into(),
        site: "https://example.org".into(),
        username: "renamed@example.org".into(),
        password: password.map(Into::into),
        notes: notes.map(Into::into),
    }
}

#[test]
fn update_keeps_omitted_secrets_and_persists() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("Original")).unwrap();
    let id = vault.list().unwrap()[0].id.clone();
    vault.update(&id, update("Renamed", None, None)).unwrap();
    let summary = &vault.list().unwrap()[0];
    assert_eq!(
        (
            summary.id.as_str(),
            summary.name.as_str(),
            summary.site.as_str()
        ),
        (id.as_str(), "Renamed", "https://example.org")
    );
    assert_eq!(summary.username, "renamed@example.org");
    let secret = vault.reveal(&id).unwrap();
    assert_eq!(
        (secret.password.as_str(), secret.notes.as_str()),
        (SECRET, "private note")
    );
    drop(secret);
    vault
        .update(&id, update("Renamed", Some("new-test-secret"), Some("")))
        .unwrap();
    drop(vault);
    let mut reopened = Vault::open(dir.path()).unwrap();
    reopened.unlock(password()).unwrap();
    let secret = reopened.reveal(&id).unwrap();
    assert_eq!(
        (secret.password.as_str(), secret.notes.as_str()),
        ("new-test-secret", "")
    );
}

#[test]
fn update_and_delete_reject_invalid_input_without_writing() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("Kept")).unwrap();
    let id = vault.list().unwrap()[0].id.clone();
    let before = fs::read(dir.path().join("vault.cairn")).unwrap();
    for (target, input) in [
        ("missing", update("Name", None, None)),
        (id.as_str(), update(" ", None, None)),
        (id.as_str(), update("Name", Some(""), None)),
    ] {
        assert_eq!(vault.update(target, input), Err(VaultError::InvalidInput));
    }
    assert_eq!(vault.delete("missing"), Err(VaultError::InvalidInput));
    assert_eq!(vault.status().unwrap(), VaultStatus::Unlocked);
    assert_eq!(fs::read(dir.path().join("vault.cairn")).unwrap(), before);
    assert_eq!(vault.list().unwrap()[0].name, "Kept");
}

#[test]
fn delete_removes_entry_from_disk_and_keeps_backup() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("Deleted")).unwrap();
    vault.save(entry("Kept")).unwrap();
    let entries = vault.list().unwrap();
    let before = fs::read(dir.path().join("vault.cairn")).unwrap();
    vault.delete(&entries[0].id).unwrap();
    assert_eq!(
        fs::read(dir.path().join("backups/previous.cairn")).unwrap(),
        before
    );
    assert_eq!(
        vault.reveal(&entries[0].id).err(),
        Some(VaultError::InvalidInput)
    );
    drop(vault);
    let mut reopened = Vault::open(dir.path()).unwrap();
    reopened.unlock(password()).unwrap();
    let names: Vec<_> = reopened
        .list()
        .unwrap()
        .into_iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(names, ["Kept"]);
}

#[test]
fn update_and_delete_refuse_external_changes() {
    let (dir, mut vault) = fixture();
    vault.unlock(password()).unwrap();
    vault.save(entry("Entry")).unwrap();
    let id = vault.list().unwrap()[0].id.clone();
    fs::write(dir.path().join("vault.cairn"), b"external change").unwrap();
    assert_eq!(
        vault.update(&id, update("Changed", None, None)),
        Err(VaultError::ChangedOnDisk)
    );
    assert_eq!(vault.delete(&id), Err(VaultError::ChangedOnDisk));
    assert_eq!(
        fs::read(dir.path().join("vault.cairn")).unwrap(),
        b"external change"
    );
    assert_eq!(vault.list().unwrap()[0].name, "Entry");
}

#[test]
fn paired_browsers_are_encrypted_persistent_and_need_an_unlocked_vault() {
    let (dir, mut vault) = fixture();
    assert!(matches!(vault.browsers(), Err(VaultError::Locked)));
    assert_eq!(
        vault.add_browser("client-a", "Helium", "public-key-a"),
        Err(VaultError::Locked)
    );
    vault.unlock(password()).unwrap();
    assert!(vault.browsers().unwrap().is_empty());
    vault
        .add_browser("client-a", "Helium", "public-key-a")
        .unwrap();
    vault
        .add_browser("client-b", "Work profile", "public-key-b")
        .unwrap();
    // Pairing the same client again replaces it.
    vault
        .add_browser("client-a", "Helium again", "public-key-a")
        .unwrap();
    let encrypted = fs::read(dir.path().join("browsers.cairn")).unwrap();
    for value in ["client-a", "Helium", "public-key-b"] {
        assert!(
            !encrypted
                .windows(value.len())
                .any(|bytes| bytes == value.as_bytes())
        );
    }
    drop(vault);

    let mut reopened = Vault::open(dir.path()).unwrap();
    reopened.unlock(password()).unwrap();
    let names: Vec<_> = reopened
        .browsers()
        .unwrap()
        .into_iter()
        .map(|browser| browser.name)
        .collect();
    assert_eq!(names, ["Work profile", "Helium again"]);
    assert_eq!(
        reopened.browser_key("client-b").unwrap().as_deref(),
        Some("public-key-b")
    );
    reopened.remove_browser("client-b").unwrap();
    assert_eq!(reopened.browser_key("client-b").unwrap(), None);
    assert_eq!(
        reopened.remove_browser("client-b"),
        Err(VaultError::InvalidInput)
    );

    // A damaged list reads as empty and never blocks the credentials.
    fs::write(dir.path().join("browsers.cairn"), b"damaged").unwrap();
    reopened.lock();
    reopened.unlock(password()).unwrap();
    assert!(reopened.browsers().unwrap().is_empty());
}

#[test]
fn an_older_browser_list_cannot_restore_a_removed_browser() {
    let (dir, mut vault) = fixture();
    let list = dir.path().join("browsers.cairn");
    vault.unlock(password()).unwrap();
    vault
        .add_browser("client-a", "Helium", "public-key-a")
        .unwrap();
    vault
        .add_browser("client-b", "Removed", "public-key-b")
        .unwrap();
    let before = fs::read(&list).unwrap();
    vault.remove_browser("client-b").unwrap();
    fs::write(&list, &before).unwrap();
    vault.lock();
    vault.unlock(password()).unwrap();
    assert_eq!(vault.browser_key("client-b").unwrap(), None);
    assert!(vault.browsers().unwrap().is_empty());

    // A list next to a vault that never bound one is ignored too.
    let (dir, mut fresh) = fixture();
    fs::write(dir.path().join("browsers.cairn"), &before).unwrap();
    fresh.unlock(password()).unwrap();
    assert!(fresh.browsers().unwrap().is_empty());
}

/// Writes a version 1 vault with one entry and one paired browser, as the
/// previous release did.
fn legacy_vault(dir: &Path) {
    let header = Header {
        version: 1,
        memory_kib: 65_536,
        iterations: 3,
        lanes: 1,
        salt: random().unwrap(),
        vault_id: random().unwrap(),
    };
    let wrapping_key = derive(PASSWORD, &header).unwrap();
    let key = random::<32>().unwrap();
    let (key_nonce, data_nonce, list_nonce) =
        (random().unwrap(), random().unwrap(), random().unwrap());
    let entries = serde_json::json!([{
        "id": "legacy",
        "name": "Legacy",
        "site": "https://example.com",
        "username": "test@example.com",
        "password": SECRET,
        "notes": "",
    }]);
    let envelope = Envelope {
        wrapped_key: encrypt(
            &wrapping_key,
            &key_nonce,
            &key,
            &header.aad(b"cairn-key-v1").unwrap(),
        )
        .unwrap(),
        ciphertext: encrypt(
            &key,
            &data_nonce,
            &serde_json::to_vec(&entries).unwrap(),
            &header.aad(b"cairn-data-v1").unwrap(),
        )
        .unwrap(),
        key_nonce,
        data_nonce,
        header,
    };
    fs::write(
        dir.join("vault.cairn"),
        serde_json::to_vec(&envelope).unwrap(),
    )
    .unwrap();
    let browsers = serde_json::json!([{
        "id": "client-a",
        "name": "Helium",
        "public_key": "public-key-a",
        "paired_at": 1,
    }]);
    let mut bytes = b"CAIRN-BROWSERS-1".to_vec();
    bytes.extend(list_nonce);
    bytes.extend(
        encrypt(
            &key,
            &list_nonce,
            &serde_json::to_vec(&browsers).unwrap(),
            &envelope.header.aad(b"cairn-browsers-v1").unwrap(),
        )
        .unwrap(),
    );
    fs::write(dir.join("browsers.cairn"), bytes).unwrap();
}

#[test]
fn version_1_vaults_upgrade_and_keep_their_entries_and_browsers() {
    let dir = tempfile::tempdir().unwrap();
    legacy_vault(dir.path());
    let original = fs::read(dir.path().join("vault.cairn")).unwrap();
    let legacy_list = fs::read(dir.path().join("browsers.cairn")).unwrap();
    let mut vault = Vault::open(dir.path()).unwrap();
    vault.unlock(password()).unwrap();
    assert_eq!(vault.reveal("legacy").unwrap().password, SECRET);
    assert_eq!(
        vault.browser_key("client-a").unwrap().as_deref(),
        Some("public-key-a")
    );
    let upgraded: serde_json::Value =
        serde_json::from_slice(&fs::read(dir.path().join("vault.cairn")).unwrap()).unwrap();
    assert_eq!(upgraded["header"]["version"], VERSION);
    assert_eq!(
        fs::read(dir.path().join("backups/previous.cairn")).unwrap(),
        original
    );

    vault.lock();
    vault.unlock(password()).unwrap();
    assert_eq!(vault.reveal("legacy").unwrap().password, SECRET);
    assert_eq!(vault.browsers().unwrap().len(), 1);
    vault.remove_browser("client-a").unwrap();
    // The pre-upgrade list is an older copy now, too.
    fs::write(dir.path().join("browsers.cairn"), legacy_list).unwrap();
    vault.lock();
    vault.unlock(password()).unwrap();
    assert!(vault.browsers().unwrap().is_empty());
}
