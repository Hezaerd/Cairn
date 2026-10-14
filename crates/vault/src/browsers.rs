//! Browsers paired with the bridge. Their public keys aren't secret, but the
//! list is sealed with the vault key so nothing can add a browser to it
//! without the master password. The vault records the nonce of the last
//! write, so an older copy of the file can't bring back a removed browser.
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
    /// The name you gave it in Cairn, shown instead of `name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    public_key: String,
    paired_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSummary {
    pub id: String,
    pub name: String,
    pub label: Option<String>,
    pub paired_at: u64,
}

/// Reads the list and the nonce that identifies this write of it.
pub(super) fn read_list(path: &Path, session: &Session) -> Result<(Vec<PairedBrowser>, [u8; 24])> {
    let bytes = storage::read(path)?;
    if bytes.len() > MAX_FILE || bytes.len() < PREFIX.len() + 24 + 16 || !bytes.starts_with(PREFIX)
    {
        return Err(VaultError::InvalidVault);
    }
    let nonce: [u8; 24] = bytes[PREFIX.len()..PREFIX.len() + 24]
        .try_into()
        .map_err(|_| VaultError::InvalidVault)?;
    let plaintext = decrypt(
        &session.key,
        &nonce,
        &bytes[PREFIX.len() + 24..],
        &session.envelope.header.aad(b"cairn-browsers-v1")?,
    )
    .map_err(|_| VaultError::InvalidVault)?;
    let browsers: Vec<PairedBrowser> =
        serde_json::from_slice(&plaintext).map_err(|_| VaultError::InvalidVault)?;
    if browsers.len() > MAX_BROWSERS {
        return Err(VaultError::InvalidVault);
    }
    Ok((browsers, nonce))
}

/// Writes the list and points the session at it. The caller writes the vault
/// next, which records the new nonce.
pub(super) fn bind(path: &Path, session: &mut Session, browsers: Vec<PairedBrowser>) -> Result<()> {
    session.browsers_nonce = Some(write_list(path, session, &browsers)?);
    session.browsers = Some(browsers);
    Ok(())
}

fn write_list(path: &Path, session: &Session, browsers: &[PairedBrowser]) -> Result<[u8; 24]> {
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
    storage::replace(path, &bytes)?;
    Ok(nonce)
}

impl Vault {
    fn browser_list(&mut self) -> Result<&mut Vec<PairedBrowser>> {
        self.expire();
        let path = self.directory.join("browsers.cairn");
        let session = self.session.as_mut().ok_or(VaultError::Locked)?;
        if session.browsers.is_none() {
            // A missing, damaged, or older list only costs a new pairing, so it
            // never blocks the vault.
            let expected = session.browsers_nonce;
            let list = expected
                .and_then(|expected| {
                    read_list(&path, session)
                        .ok()
                        .filter(|(_, nonce)| *nonce == expected)
                })
                .map(|(list, _)| list);
            session.browsers = Some(list.unwrap_or_default());
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
                label: browser.label.clone(),
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

    /// Pairs a browser, replacing an earlier pairing with the same ID but
    /// keeping the name you gave it.
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
        let label = browsers
            .iter()
            .find(|browser| browser.id == id)
            .and_then(|browser| browser.label.clone());
        browsers.retain(|browser| browser.id != id);
        if browsers.len() >= MAX_BROWSERS {
            return Err(VaultError::InvalidInput);
        }
        browsers.push(PairedBrowser {
            id: id.into(),
            name: name.into(),
            label,
            public_key: public_key.into(),
            paired_at,
        });
        self.store_browsers(browsers)
    }

    /// Names a paired browser. An empty name, or the one the browser reported,
    /// goes back to that one.
    pub fn rename_browser(&mut self, id: &str, label: &str) -> Result<()> {
        let label = label.trim();
        if label.len() > 256 {
            return Err(VaultError::InvalidInput);
        }
        let mut browsers = self.browser_list()?.clone();
        let browser = browsers
            .iter_mut()
            .find(|browser| browser.id == id)
            .ok_or(VaultError::InvalidInput)?;
        browser.label = (!label.is_empty() && label != browser.name).then(|| label.into());
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

    /// Writes the list, then the vault that vouches for it. If the vault
    /// write fails, the session locks and the new list no longer matches, so
    /// it reads as empty: a failure never restores a removed browser.
    fn store_browsers(&mut self, browsers: Vec<PairedBrowser>) -> Result<()> {
        let path = self.directory.join("browsers.cairn");
        self.write(|session| bind(&path, session, browsers))
    }
}
