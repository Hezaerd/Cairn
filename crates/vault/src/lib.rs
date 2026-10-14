//! Local, single-writer encrypted vault. No browser or IPC dependencies.
mod browsers;
mod favicon;
mod storage;
pub use browsers::BrowserSummary;
pub use favicon::FaviconLookup;

use argon2::{Algorithm, Argon2, Block, Params, Version};
use chacha20poly1305::{
    KeyInit, XChaCha20Poly1305,
    aead::{Aead, Payload},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES: usize = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;
const IDLE_TIMEOUT: Duration = Duration::from_secs(300);
/// Version 2 binds the paired-browser list to the vault. Version 1 vaults
/// still open and are rewritten as version 2 on unlock.
const VERSION: u32 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum VaultError {
    Storage,
    InUse,
    AlreadyExists,
    Missing,
    Locked,
    InvalidInput,
    InvalidVault,
    UnsupportedVersion,
    UnlockFailed,
    Randomness,
    ChangedOnDisk,
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for VaultError {}
type Result<T> = std::result::Result<T, VaultError>;

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Header {
    version: u32,
    memory_kib: u32,
    iterations: u32,
    lanes: u32,
    salt: [u8; 16],
    vault_id: [u8; 16],
}

impl Header {
    fn validate(&self) -> Result<()> {
        if !(1..=VERSION).contains(&self.version) {
            return Err(VaultError::UnsupportedVersion);
        }
        // Bound untrusted costs before asking Argon2 to allocate or compute.
        if self.memory_kib != 65_536 || !(3..=10).contains(&self.iterations) || self.lanes != 1 {
            return Err(VaultError::InvalidVault);
        }
        Ok(())
    }
    fn aad(&self, purpose: &[u8]) -> Result<Vec<u8>> {
        let mut aad = purpose.to_vec();
        aad.extend(serde_json::to_vec(self).map_err(|_| VaultError::InvalidVault)?);
        Ok(aad)
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Envelope {
    header: Header,
    key_nonce: [u8; 24],
    wrapped_key: Vec<u8>,
    data_nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

/// The encrypted payload since version 2. Version 1 held only the entries.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Contents<E> {
    entries: E,
    /// The nonce of the `browsers.cairn` write this vault vouches for.
    browsers: Option<[u8; 24]>,
}

#[derive(Serialize, Deserialize, Clone, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    name: String,
    site: String,
    username: String,
    password: String,
    notes: String,
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct NewEntry {
    pub name: String,
    pub site: String,
    pub username: String,
    pub password: String,
    pub notes: String,
}

impl NewEntry {
    fn validate(&self) -> Result<()> {
        validate_fields(&self.name, &self.site, &self.username)?;
        validate_secret(Some(&self.password), Some(&self.notes))
    }
}

/// Changes to an existing entry. `None` keeps the stored password or notes,
/// so the UI can edit an entry without revealing its secrets first.
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub struct EntryUpdate {
    pub name: String,
    pub site: String,
    pub username: String,
    pub password: Option<String>,
    pub notes: Option<String>,
}

impl EntryUpdate {
    fn validate(&self) -> Result<()> {
        validate_fields(&self.name, &self.site, &self.username)?;
        validate_secret(self.password.as_deref(), self.notes.as_deref())
    }
}

fn validate_fields(name: &str, site: &str, username: &str) -> Result<()> {
    if name.trim().is_empty() || name.len() > 256 || site.len() > 2048 || username.len() > 1024 {
        return Err(VaultError::InvalidInput);
    }
    Ok(())
}

fn validate_secret(password: Option<&str>, notes: Option<&str>) -> Result<()> {
    if password.is_some_and(|password| password.is_empty() || password.len() > 4096)
        || notes.is_some_and(|notes| notes.len() > 16_384)
    {
        return Err(VaultError::InvalidInput);
    }
    Ok(())
}

#[derive(Serialize)]
pub struct EntrySummary {
    pub id: String,
    pub name: String,
    pub site: String,
    pub username: String,
}

/// What a browser needs to fill a login form.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct Login {
    pub site: String,
    pub username: String,
    pub password: String,
}

#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
pub struct EntrySecret {
    pub password: String,
    pub notes: String,
}

struct Session {
    favicon_token: String,
    favicons: Option<Vec<favicon::CachedIcon>>,
    browsers: Option<Vec<browsers::PairedBrowser>>,
    browsers_nonce: Option<[u8; 24]>,
    key: Zeroizing<[u8; 32]>,
    envelope: Envelope,
    entries: Vec<Entry>,
    disk_bytes: Vec<u8>,
    last_used: Instant,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VaultStatus {
    Missing,
    Locked,
    Unlocked,
    Recovery,
}

pub struct Vault {
    directory: PathBuf,
    _writer_lock: File,
    session: Option<Session>,
}

impl Vault {
    pub fn open(directory: impl AsRef<Path>) -> Result<Self> {
        let directory = directory.as_ref().to_path_buf();
        let writer_lock = storage::lock(&directory)?;
        Ok(Self {
            directory,
            _writer_lock: writer_lock,
            session: None,
        })
    }

    pub fn status(&mut self) -> Result<VaultStatus> {
        self.expire();
        if self.session.is_some() {
            return Ok(VaultStatus::Unlocked);
        }
        if self.path().try_exists().map_err(|_| VaultError::Storage)? {
            Ok(VaultStatus::Locked)
        } else if self
            .directory
            .join("backups/previous.cairn")
            .try_exists()
            .map_err(|_| VaultError::Storage)?
        {
            Ok(VaultStatus::Recovery)
        } else {
            Ok(VaultStatus::Missing)
        }
    }

    pub fn create(&mut self, password: Zeroizing<String>) -> Result<()> {
        if self.status()? != VaultStatus::Missing {
            return Err(VaultError::AlreadyExists);
        }
        if password.chars().count() < 12 || password.len() > 1024 {
            return Err(VaultError::InvalidInput);
        }
        let mut header = Header {
            version: VERSION,
            memory_kib: 65_536,
            iterations: 3,
            lanes: 1,
            salt: random()?,
            vault_id: random()?,
        };
        let start = Instant::now();
        let mut wrapping_key = derive(&password, &header)?;
        // Aim for roughly 500 ms, with a conservative minimum of three passes.
        let iterations = (1500 / start.elapsed().as_millis().max(1)).clamp(3, 10) as u32;
        if iterations != header.iterations {
            header.iterations = iterations;
            wrapping_key = derive(&password, &header)?;
        }
        let key = Zeroizing::new(random::<32>()?);
        let key_nonce = random()?;
        let wrapped_key = encrypt(
            &wrapping_key,
            &key_nonce,
            key.as_ref(),
            &header.aad(b"cairn-key-v1")?,
        )?;
        let mut session = Session {
            favicon_token: favicon::session_token()?,
            favicons: None,
            browsers: None,
            browsers_nonce: None,
            key,
            envelope: Envelope {
                header,
                key_nonce,
                wrapped_key,
                data_nonce: random()?,
                ciphertext: vec![],
            },
            entries: vec![],
            disk_bytes: vec![],
            last_used: Instant::now(),
        };
        let bytes = seal(&mut session)?;
        storage::create(&self.path(), &bytes)?;
        session.disk_bytes = bytes;
        self.session = Some(session);
        Ok(())
    }

    pub fn unlock(&mut self, password: Zeroizing<String>) -> Result<()> {
        self.lock();
        if password.is_empty() || password.len() > 1024 {
            return Err(VaultError::InvalidInput);
        }
        let bytes = storage::read(&self.path())?;
        let envelope: Envelope =
            serde_json::from_slice(&bytes).map_err(|_| VaultError::InvalidVault)?;
        envelope.header.validate()?;
        if envelope.wrapped_key.len() != 48 || envelope.ciphertext.len() < 16 {
            return Err(VaultError::InvalidVault);
        }
        let wrapping_key = derive(&password, &envelope.header)?;
        let unwrapped = decrypt(
            &wrapping_key,
            &envelope.key_nonce,
            &envelope.wrapped_key,
            &envelope.header.aad(b"cairn-key-v1")?,
        )?;
        let mut key = Zeroizing::new([0u8; 32]);
        if unwrapped.len() != key.len() {
            return Err(VaultError::InvalidVault);
        }
        key.copy_from_slice(&unwrapped);
        let plaintext = decrypt(
            &key,
            &envelope.data_nonce,
            &envelope.ciphertext,
            &envelope.header.aad(b"cairn-data-v1")?,
        )?;
        let legacy = envelope.header.version == 1;
        let (entries, browsers_nonce): (Vec<Entry>, _) = if legacy {
            let entries = serde_json::from_slice(&plaintext);
            (entries.map_err(|_| VaultError::InvalidVault)?, None)
        } else {
            let contents: Contents<Vec<Entry>> =
                serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidVault)?;
            (contents.entries, contents.browsers)
        };
        if entries.len() > MAX_ENTRIES {
            return Err(VaultError::InvalidVault);
        }
        self.session = Some(Session {
            favicon_token: favicon::session_token()?,
            favicons: None,
            browsers: None,
            browsers_nonce,
            key,
            envelope,
            entries,
            disk_bytes: bytes,
            last_used: Instant::now(),
        });
        if legacy && let Err(error) = self.upgrade(&wrapping_key) {
            self.lock();
            return Err(error);
        }
        Ok(())
    }

    /// Rewrites a version 1 vault as version 2 and binds the paired-browser
    /// list found next to it, which version 1 had no way to vouch for.
    fn upgrade(&mut self, wrapping_key: &[u8; 32]) -> Result<()> {
        let path = self.directory.join("browsers.cairn");
        let session = self.active()?;
        // Read under the version 1 header, before the header changes.
        let browsers = browsers::read_list(&path, session).ok();
        let header = &mut session.envelope.header;
        header.version = VERSION;
        session.envelope.key_nonce = random()?;
        session.envelope.wrapped_key = encrypt(
            wrapping_key,
            &session.envelope.key_nonce,
            session.key.as_ref(),
            &header.aad(b"cairn-key-v1")?,
        )?;
        self.write(|session| match browsers {
            Some((list, _)) => browsers::bind(&path, session, list),
            None => Ok(()),
        })
    }

    pub fn lock(&mut self) {
        self.session = None;
    }

    pub fn expire(&mut self) -> bool {
        if self
            .session
            .as_ref()
            .is_some_and(|s| s.last_used.elapsed() >= IDLE_TIMEOUT)
        {
            self.lock();
            true
        } else {
            false
        }
    }

    fn active(&mut self) -> Result<&mut Session> {
        self.expire();
        let session = self.session.as_mut().ok_or(VaultError::Locked)?;
        session.last_used = Instant::now();
        Ok(session)
    }

    pub fn list(&mut self) -> Result<Vec<EntrySummary>> {
        Ok(self
            .active()?
            .entries
            .iter()
            .map(|entry| EntrySummary {
                id: entry.id.clone(),
                name: entry.name.clone(),
                site: entry.site.clone(),
                username: entry.username.clone(),
            })
            .collect())
    }

    pub fn reveal(&mut self, id: &str) -> Result<EntrySecret> {
        self.active()?
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| EntrySecret {
                password: entry.password.clone(),
                notes: entry.notes.clone(),
            })
            .ok_or(VaultError::InvalidInput)
    }

    pub fn login(&mut self, id: &str) -> Result<Login> {
        self.active()?
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| Login {
                site: entry.site.clone(),
                username: entry.username.clone(),
                password: entry.password.clone(),
            })
            .ok_or(VaultError::InvalidInput)
    }

    pub fn save(&mut self, input: NewEntry) -> Result<()> {
        input.validate()?;
        let id = random::<16>()?.iter().map(|b| format!("{b:02x}")).collect();
        self.commit(|entries| {
            if entries.len() >= MAX_ENTRIES {
                return Err(VaultError::InvalidInput);
            }
            entries.push(Entry {
                id,
                name: input.name.clone(),
                site: input.site.clone(),
                username: input.username.clone(),
                password: input.password.clone(),
                notes: input.notes.clone(),
            });
            Ok(())
        })
    }

    pub fn update(&mut self, id: &str, input: EntryUpdate) -> Result<()> {
        input.validate()?;
        self.commit(|entries| {
            let entry = entries
                .iter_mut()
                .find(|entry| entry.id == id)
                .ok_or(VaultError::InvalidInput)?;
            // Replacing the whole entry drops the old one, which zeroizes its fields.
            *entry = Entry {
                id: entry.id.clone(),
                name: input.name.clone(),
                site: input.site.clone(),
                username: input.username.clone(),
                password: input
                    .password
                    .clone()
                    .unwrap_or_else(|| entry.password.clone()),
                notes: input.notes.clone().unwrap_or_else(|| entry.notes.clone()),
            };
            Ok(())
        })
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        self.commit(|entries| {
            let index = entries
                .iter()
                .position(|entry| entry.id == id)
                .ok_or(VaultError::InvalidInput)?;
            entries.remove(index);
            Ok(())
        })
    }

    fn commit(&mut self, change: impl FnOnce(&mut Vec<Entry>) -> Result<()>) -> Result<()> {
        self.write(|session| change(&mut session.entries))
    }

    /// Applies `change` and writes the vault. A rejected change leaves the
    /// session untouched; a failed write locks it.
    fn write(&mut self, change: impl FnOnce(&mut Session) -> Result<()>) -> Result<()> {
        let path = self.path();
        let backup = self.directory.join("backups/previous.cairn");
        let session = self.active()?;
        // Never silently overwrite a file restored or changed outside this process.
        if storage::read(&path)? != session.disk_bytes {
            return Err(VaultError::ChangedOnDisk);
        }
        change(session)?;
        let result = (|| {
            let bytes = seal(session)?;
            storage::replace(&backup, &session.disk_bytes)?;
            storage::replace(&path, &bytes)?;
            session.disk_bytes = bytes;
            Ok(())
        })();
        if result.is_err() {
            // Commit errors can have ambiguous durability. Reopen from disk before retrying.
            self.lock();
        }
        result
    }

    fn path(&self) -> PathBuf {
        self.directory.join("vault.cairn")
    }
}

fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes).map_err(|_| VaultError::Randomness)?;
    Ok(bytes)
}

fn derive(password: &str, header: &Header) -> Result<Zeroizing<[u8; 32]>> {
    header.validate()?;
    let params = Params::new(header.memory_kib, header.iterations, header.lanes, Some(32))
        .map_err(|_| VaultError::InvalidVault)?;
    let mut key = Zeroizing::new([0u8; 32]);
    // Own and wipe the Argon2 work area too: its allocating helper does not
    // wipe the backing allocation when it is dropped.
    let mut blocks = Zeroizing::new(vec![Block::default(); params.block_count()]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into_with_memory(
            password.as_bytes(),
            &header.salt,
            key.as_mut(),
            &mut *blocks,
        )
        .map_err(|_| VaultError::InvalidVault)?;
    Ok(key)
}

fn encrypt(key: &[u8; 32], nonce: &[u8; 24], bytes: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
    XChaCha20Poly1305::new(key.into())
        .encrypt(nonce.into(), Payload { msg: bytes, aad })
        .map_err(|_| VaultError::InvalidVault)
}

fn decrypt(
    key: &[u8; 32],
    nonce: &[u8; 24],
    bytes: &[u8],
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>> {
    XChaCha20Poly1305::new(key.into())
        .decrypt(nonce.into(), Payload { msg: bytes, aad })
        .map(Zeroizing::new)
        .map_err(|_| VaultError::UnlockFailed)
}

fn seal(session: &mut Session) -> Result<Vec<u8>> {
    // Serialize without reallocating a Vec and leaving its old plaintext
    // allocations behind. Cursor refuses writes past this fixed capacity.
    let mut plaintext = Zeroizing::new(vec![0u8; MAX_PLAINTEXT_BYTES]);
    let mut writer = std::io::Cursor::new(plaintext.as_mut_slice());
    let contents = Contents {
        entries: &session.entries,
        browsers: session.browsers_nonce,
    };
    serde_json::to_writer(&mut writer, &contents).map_err(|_| VaultError::InvalidInput)?;
    let length = writer.position() as usize;
    session.envelope.data_nonce = random()?;
    session.envelope.ciphertext = encrypt(
        &session.key,
        &session.envelope.data_nonce,
        &plaintext[..length],
        &session.envelope.header.aad(b"cairn-data-v1")?,
    )?;
    let bytes = serde_json::to_vec(&session.envelope).map_err(|_| VaultError::InvalidVault)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(VaultError::InvalidInput);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests;
