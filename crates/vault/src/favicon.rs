//! Disposable encrypted assets. Cache access deliberately does not refresh idle time.
use super::*;
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

const MAX_CACHE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ICONS: usize = 256;
const MAX_IMAGE_BYTES: usize = 90_000;
const FRESH_SECONDS: u64 = 30 * 24 * 60 * 60;
const RETRY_SECONDS: u64 = 6 * 60 * 60;
const PREFIX: &[u8] = b"CAIRN-ICONS-1";

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub(super) struct CachedIcon {
    origin: String,
    image: Option<String>,
    pub(super) retry_at: u64,
}

#[derive(Serialize)]
pub struct FaviconLookup {
    pub session: String,
    #[serde(skip)]
    pub origin: String,
    pub image: Option<String>,
    pub stale: bool,
}

pub(super) fn session_token() -> Result<String> {
    Ok(random::<16>()?.iter().map(|b| format!("{b:02x}")).collect())
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn origin(site: &str) -> Option<String> {
    let site = site.trim();
    if site.is_empty() {
        return None;
    }
    let url = Url::parse(site)
        .or_else(|_| Url::parse(&format!("https://{site}")))
        .ok()?;
    // Never send a stored URL path, query, or embedded credentials to a server.
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

fn read_cache(path: &Path, session: &Session) -> Option<Vec<CachedIcon>> {
    let bytes = storage::read(path).ok()?;
    if bytes.len() > MAX_CACHE_BYTES + 128
        || bytes.len() < PREFIX.len() + 24 + 16
        || !bytes.starts_with(PREFIX)
    {
        return None;
    }
    let nonce = bytes[PREFIX.len()..PREFIX.len() + 24].try_into().ok()?;
    let plaintext = decrypt(
        &session.key,
        nonce,
        &bytes[PREFIX.len() + 24..],
        &session.envelope.header.aad(b"cairn-icons-v1").ok()?,
    )
    .ok()?;
    let records: Vec<CachedIcon> = serde_json::from_slice(&plaintext).ok()?;
    if records.len() > MAX_ICONS
        || records.iter().any(|record| {
            record.origin.len() > 2048
                || record.image.as_ref().is_some_and(|image| {
                    image.len() > MAX_IMAGE_BYTES || !image.starts_with("data:image/png;base64,")
                })
        })
    {
        return None;
    }
    Some(records)
}

impl Vault {
    /// A session ticket prevents work queued before locking from running after unlocking.
    pub fn favicon_session(&mut self, token: &str) -> bool {
        self.expire();
        self.session
            .as_ref()
            .is_some_and(|session| session.favicon_token == token)
    }

    pub fn favicon_lookup(
        &mut self,
        id: &str,
        token: Option<&str>,
    ) -> Result<Option<FaviconLookup>> {
        self.expire();
        let path = self.directory.join("favicons.cairn");
        let session = self.session.as_mut().ok_or(VaultError::Locked)?;
        if token.is_some_and(|token| session.favicon_token != token) {
            return Err(VaultError::Locked);
        }
        let entry = session
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or(VaultError::InvalidInput)?;
        let Some(origin) = origin(&entry.site) else {
            return Ok(None);
        };
        if session.favicons.is_none() {
            session.favicons = Some(read_cache(&path, session).unwrap_or_default());
        }
        let record = session
            .favicons
            .as_ref()
            .and_then(|records| records.iter().find(|record| record.origin == origin));
        Ok(Some(FaviconLookup {
            session: session.favicon_token.clone(),
            origin,
            image: record.and_then(|record| record.image.clone()),
            stale: record.is_none_or(|record| record.retry_at <= now()),
        }))
    }

    /// A failed refresh preserves an old icon and suppresses further attempts for six hours.
    pub fn favicon_store(
        &mut self,
        id: &str,
        token: &str,
        image: Option<String>,
    ) -> Result<Option<String>> {
        if image.as_ref().is_some_and(|image| {
            image.len() > MAX_IMAGE_BYTES || !image.starts_with("data:image/png;base64,")
        }) {
            return Err(VaultError::InvalidInput);
        }
        let Some(lookup) = self.favicon_lookup(id, Some(token))? else {
            return Ok(None);
        };
        let path = self.directory.join("favicons.cairn");
        let session = self.session.as_mut().ok_or(VaultError::Locked)?;
        let retry_at = now()
            + if image.is_some() {
                FRESH_SECONDS
            } else {
                RETRY_SECONDS
            };
        let image = image.or(lookup.image);
        let records = session.favicons.get_or_insert_default();
        records.retain(|record| record.origin != lookup.origin);
        records.push(CachedIcon {
            origin: lookup.origin,
            image: image.clone(),
            retry_at,
        });
        // Bounded FIFO cache; no filenames or index expose the origins on disk.
        while records.len() > MAX_ICONS
            || records
                .iter()
                .map(|record| {
                    record.origin.len() + record.image.as_ref().map_or(0, String::len) + 128
                })
                .sum::<usize>()
                > MAX_CACHE_BYTES / 2
        {
            records.remove(0);
        }
        let mut plaintext = Zeroizing::new(vec![0; MAX_CACHE_BYTES]);
        let mut writer = std::io::Cursor::new(plaintext.as_mut_slice());
        serde_json::to_writer(&mut writer, records).map_err(|_| VaultError::Storage)?;
        let length = writer.position() as usize;
        let nonce = random::<24>()?;
        let ciphertext = encrypt(
            &session.key,
            &nonce,
            &plaintext[..length],
            &session.envelope.header.aad(b"cairn-icons-v1")?,
        )?;
        let mut bytes = PREFIX.to_vec();
        bytes.extend(nonce);
        bytes.extend(ciphertext);
        storage::replace(&path, &bytes)?;
        Ok(image)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origins_strip_paths_and_reject_credentials_and_non_https() {
        assert_eq!(
            origin("https://Example.com/private?token=secret#fragment").as_deref(),
            Some("https://example.com")
        );
        assert_eq!(
            origin("example.com/login").as_deref(),
            Some("https://example.com")
        );
        for site in [
            "",
            "http://example.com",
            "https://user:password@example.com",
            "file:///secret",
            "data:image/png;base64,x",
        ] {
            assert!(origin(site).is_none());
        }
    }
}
