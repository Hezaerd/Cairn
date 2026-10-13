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
