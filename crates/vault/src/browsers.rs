//! Browsers paired with the bridge. Their public keys aren't secret, but the
//! list is sealed with the vault key so nothing can add a browser to it
//! without the master password.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BROWSERS: usize = 16;
const MAX_FILE: usize = 64 * 1024;
const PREFIX: &[u8] = b"CAIRN-BROWSERS-1";

#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub(super) struct PairedBrowser {
    id: String,
    name: String,
    public_key: String,
    paired_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSummary {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
}

fn read_list(path: &Path, session: &Session) -> Result<Vec<PairedBrowser>> {
    let bytes = match storage::read(path) {
        Ok(bytes) => bytes,
        Err(VaultError::Missing) => return Ok(vec![]),
        Err(error) => return Err(error),
    };
    if bytes.len() > MAX_FILE || bytes.len() < PREFIX.len() + 24 + 16 || !bytes.starts_with(PREFIX)
    {
        return Err(VaultError::InvalidVault);
    }
    let nonce = bytes[PREFIX.len()..PREFIX.len() + 24]
        .try_into()
        .map_err(|_| VaultError::InvalidVault)?;
    let plaintext = decrypt(
        &session.key,
        nonce,
        &bytes[PREFIX.len() + 24..],
        &session.envelope.header.aad(b"cairn-browsers-v1")?,
    )
    .map_err(|_| VaultError::InvalidVault)?;
    let browsers: Vec<PairedBrowser> =
        serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidVault)?;
    if browsers.len() > MAX_BROWSERS {
        return Err(VaultError::InvalidVault);
    }
    Ok(browsers)
}

fn write_list(path: &Path, session: &Session, browsers: &[PairedBrowser]) -> Result<()> {
    let plaintext = serde_json::to_vec(browsers).map_err(|_| VaultError::Storage)?;
    let nonce = random::<24>()?;
    let ciphertext = encrypt(
        &session.key,
        &nonce,
        &plaintext,
        &session.envelope.header.aad(b"cairn-browsers-v1")?,
    )?;
    let mut bytes = PREFIX.to_vec();
    bytes.extend(nonce);
    bytes.extend(ciphertext);
    storage::replace(path, &bytes)
}

impl Vault {
    fn browser_list(&mut self) -> Result<&mut Vec<PairedBrowser>> {
        self.expire();
        let path = self.directory.join("browsers.cairn");
        let session = self.session.as_mut().ok_or(VaultError::Locked)?;
        if session.browsers.is_none() {
            // A damaged list only costs a new pairing, so it never blocks the vault.
            session.browsers = Some(read_list(&path, session).unwrap_or_default());
        }
        Ok(session.browsers.get_or_insert_default())
    }

    pub fn browsers(&mut self) -> Result<Vec<BrowserSummary>> {
        Ok(self
            .browser_list()?
            .iter()
            .map(|browser| BrowserSummary {
                id: browser.id.clone(),
                name: browser.name.clone(),
                paired_at: browser.paired_at,
            })
            .collect())
    }

    /// The public key of a paired browser, as the client sent it at pairing.
    pub fn browser_key(&mut self, id: &str) -> Result<Option<String>> {
        Ok(self
            .browser_list()?
            .iter()
            .find(|browser| browser.id == id)
            .map(|browser| browser.public_key.clone()))
    }

    /// Pairs a browser, replacing an earlier pairing with the same ID.
    pub fn add_browser(&mut self, id: &str, name: &str, public_key: &str) -> Result<()> {
        if id.is_empty() || id.len() > 64 || name.is_empty() || name.len() > 256 {
            return Err(VaultError::InvalidInput);
        }
        if public_key.is_empty() || public_key.len() > 256 {
            return Err(VaultError::InvalidInput);
        }
        let paired_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut browsers = self.browser_list()?.clone();
        browsers.retain(|browser| browser.id != id);
        if browsers.len() >= MAX_BROWSERS {
            return Err(VaultError::InvalidInput);
        }
        browsers.push(PairedBrowser {
            id: id.into(),
            name: name.into(),
            public_key: public_key.into(),
            paired_at,
        });
        self.store_browsers(browsers)
    }

    pub fn remove_browser(&mut self, id: &str) -> Result<()> {
        let mut browsers = self.browser_list()?.clone();
        let count = browsers.len();
        browsers.retain(|browser| browser.id != id);
        if browsers.len() == count {
            return Err(VaultError::InvalidInput);
        }
        self.store_browsers(browsers)
    }

    /// Writes first, so a failed write leaves the paired list as it was.
    fn store_browsers(&mut self, browsers: Vec<PairedBrowser>) -> Result<()> {
        let path = self.directory.join("browsers.cairn");
        let session = self.active()?;
        write_list(&path, session, &browsers)?;
        session.browsers = Some(browsers);
        Ok(())
    }
}
