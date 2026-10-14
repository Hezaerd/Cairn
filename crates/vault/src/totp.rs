//! Authenticator codes (RFC 6238). Keys come from a site's setup page, an
//! `otpauth://` link, or a Google Authenticator export, and never leave Rust:
//! the window gets the current code only.
use super::*;
use hmac::{Hmac, Mac};
use std::time::{SystemTime, UNIX_EPOCH};

/// HMAC of `message` under `key`, with the given hash.
macro_rules! hmac {
    ($hash:ty, $key:expr, $message:expr) => {{
        let mut mac = Hmac::<$hash>::new_from_slice($key).expect("HMAC takes keys of any length");
        mac.update($message);
        Zeroizing::new(mac.finalize().into_bytes().to_vec())
    }};
}

const MAX_SECRET_BYTES: usize = 128;
const MAX_IMPORT: usize = 1_000;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Zeroize)]
pub(super) enum Algorithm {
    #[serde(rename = "SHA1")]
    Sha1,
    #[serde(rename = "SHA256")]
    Sha256,
    #[serde(rename = "SHA512")]
    Sha512,
}

/// A stored TOTP key and its parameters.
#[derive(Serialize, Deserialize, Clone, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
pub(super) struct Totp {
    secret: Vec<u8>,
    algorithm: Algorithm,
    digits: u32,
    period: u32,
}

impl Totp {
    fn new(secret: Vec<u8>, algorithm: Algorithm, digits: u32, period: u32) -> Result<Self> {
        let totp = Self {
            secret,
            algorithm,
            digits,
            period,
        };
        totp.validate()?;
        Ok(totp)
    }

    pub(super) fn validate(&self) -> Result<()> {
        if self.secret.is_empty()
            || self.secret.len() > MAX_SECRET_BYTES
            || !(6..=8).contains(&self.digits)
            || !(1..=300).contains(&self.period)
        {
            return Err(VaultError::InvalidInput);
        }
        Ok(())
    }

    /// Reads a key typed into the entry form: a Base32 key with the usual
    /// parameters (SHA-1, six digits, 30 seconds), or one `otpauth://totp` link.
    pub(super) fn parse(input: &str) -> Result<Self> {
        let input = input.trim();
        if input.len() > 4096 {
            return Err(VaultError::InvalidInput);
        }
        if input.to_ascii_lowercase().starts_with("otpauth://") {
            return Ok(parse_uri(input)?.totp.clone());
        }
        Self::new(base32(input)?, Algorithm::Sha1, 6, 30)
    }

    pub(super) fn code(&self, unix: u64) -> TotpCode {
        let counter = unix / u64::from(self.period);
        let message = counter.to_be_bytes();
        let digest = match self.algorithm {
            Algorithm::Sha1 => hmac!(sha1::Sha1, &self.secret, &message),
            Algorithm::Sha256 => hmac!(sha2::Sha256, &self.secret, &message),
            Algorithm::Sha512 => hmac!(sha2::Sha512, &self.secret, &message),
        };
        let offset = usize::from(digest[digest.len() - 1] & 0x0f);
        let binary = u32::from_be_bytes([
            digest[offset] & 0x7f,
            digest[offset + 1],
            digest[offset + 2],
            digest[offset + 3],
        ]);
        let value = binary % 10u32.pow(self.digits);
        TotpCode {
            code: format!("{value:0width$}", width = self.digits as usize),
            period: self.period,
            remaining: self.period - (unix % u64::from(self.period)) as u32,
        }
    }
}

/// The current code of an entry, and how long it stays valid.
#[derive(Serialize, Zeroize, ZeroizeOnDrop)]
pub struct TotpCode {
    pub code: String,
    pub period: u32,
    pub remaining: u32,
}

/// An account read from an `otpauth://` link or an authenticator export.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct OtpAccount {
    pub issuer: String,
    pub account: String,
    totp: Totp,
}

/// What the window shows of an account before importing it.
#[derive(Serialize)]
pub struct OtpPreview {
    pub issuer: String,
    pub account: String,
}

impl OtpAccount {
    pub fn preview(&self) -> OtpPreview {
        OtpPreview {
            issuer: self.issuer.clone(),
            account: self.account.clone(),
        }
    }
}

/// Reads every account in `text`: `otpauth://totp` links and Google
/// Authenticator's `otpauth-migration://` exports, separated by whitespace.
/// Counter-based (HOTP) accounts aren't supported and fail the whole read.
pub fn parse_accounts(text: &str) -> Result<Vec<OtpAccount>> {
    if text.len() > 256 * 1024 {
        return Err(VaultError::InvalidInput);
    }
    let mut accounts = vec![];
    for link in text.split_whitespace() {
        let scheme = link.split(':').next().unwrap_or_default();
        if scheme.eq_ignore_ascii_case("otpauth") {
            accounts.push(parse_uri(link)?);
        } else if scheme.eq_ignore_ascii_case("otpauth-migration") {
            accounts.extend(parse_migration(link)?);
        } else {
            return Err(VaultError::InvalidInput);
        }
        if accounts.len() > MAX_IMPORT {
            return Err(VaultError::InvalidInput);
        }
    }
    if accounts.is_empty() {
        return Err(VaultError::InvalidInput);
    }
    Ok(accounts)
}

fn parse_uri(link: &str) -> Result<OtpAccount> {
    let url = url::Url::parse(link).map_err(|_| VaultError::InvalidInput)?;
    if url.scheme() != "otpauth" || url.host_str() != Some("totp") {
        return Err(VaultError::InvalidInput);
    }
    let label = percent_decode(url.path().trim_start_matches('/'))?;
    let (label_issuer, account) = match label.split_once(':') {
        Some((issuer, account)) => (issuer.trim().to_owned(), account.trim().to_owned()),
        None => (String::new(), label.trim().to_owned()),
    };
    let mut secret = None;
    let mut issuer = None;
    let mut algorithm = Algorithm::Sha1;
    let mut digits = 6;
    let mut period = 30;
    for (key, value) in url.query_pairs() {
        match key.to_ascii_lowercase().as_str() {
            "secret" => secret = Some(base32(&value)?),
            "issuer" => issuer = Some(value.trim().to_owned()),
            "algorithm" => {
                algorithm = match value.to_ascii_uppercase().as_str() {
                    "SHA1" => Algorithm::Sha1,
                    "SHA256" => Algorithm::Sha256,
                    "SHA512" => Algorithm::Sha512,
                    _ => return Err(VaultError::InvalidInput),
                }
            }
            "digits" => digits = value.parse().map_err(|_| VaultError::InvalidInput)?,
            "period" => period = value.parse().map_err(|_| VaultError::InvalidInput)?,
            _ => {}
        }
    }
    let totp = Totp::new(
        secret.ok_or(VaultError::InvalidInput)?,
        algorithm,
        digits,
        period,
    )?;
    account_with(issuer.unwrap_or(label_issuer), account, totp)
}

fn account_with(issuer: String, account: String, totp: Totp) -> Result<OtpAccount> {
    if issuer.len() > 256 || account.len() > 1024 {
        return Err(VaultError::InvalidInput);
    }
    Ok(OtpAccount {
        issuer,
        account,
        totp,
    })
}

fn percent_decode(text: &str) -> Result<String> {
    let mut bytes = Vec::with_capacity(text.len());
    let mut input = text.bytes();
    while let Some(byte) = input.next() {
        if byte == b'%' {
            let hex = [input.next(), input.next()];
            let [Some(high), Some(low)] = hex else {
                return Err(VaultError::InvalidInput);
            };
            let value = std::str::from_utf8(&[high, low])
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok())
                .ok_or(VaultError::InvalidInput)?;
            bytes.push(value);
        } else {
            bytes.push(byte);
        }
    }
    String::from_utf8(bytes).map_err(|_| VaultError::InvalidInput)
}

/// RFC 4648 Base32, ignoring case, spaces, hyphens, and padding.
fn base32(text: &str) -> Result<Vec<u8>> {
    let mut bytes = vec![];
    let (mut buffer, mut bits) = (0u32, 0);
    for character in text.chars() {
        let value = match character.to_ascii_uppercase() {
            letter @ 'A'..='Z' => letter as u32 - 'A' as u32,
            digit @ '2'..='7' => digit as u32 - '2' as u32 + 26,
            ' ' | '-' | '=' => continue,
            _ => return Err(VaultError::InvalidInput),
        };
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    buffer.zeroize();
    if bytes.is_empty() || bytes.len() > MAX_SECRET_BYTES {
        bytes.zeroize();
        return Err(VaultError::InvalidInput);
    }
    Ok(bytes)
}

/// Google Authenticator's export: a Base64 protocol buffer in the `data`
/// parameter. Its schema is public; this reads only the fields Cairn needs.
fn parse_migration(link: &str) -> Result<Vec<OtpAccount>> {
    use base64::Engine;
    let url = url::Url::parse(link).map_err(|_| VaultError::InvalidInput)?;
    if url.host_str() != Some("offline") {
        return Err(VaultError::InvalidInput);
    }
    let data = url
        .query_pairs()
        .find(|(key, _)| key == "data")
        .map(|(_, value)| value.into_owned())
        .ok_or(VaultError::InvalidInput)?;
    let payload = Zeroizing::new(
        base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|_| VaultError::InvalidInput)?,
    );
    let mut accounts = vec![];
    for field in Fields(&payload) {
        if let (1, Value::Bytes(parameters)) = field?
            && let Some(account) = parse_parameters(parameters)?
        {
            accounts.push(account);
        }
    }
    Ok(accounts)
}

fn parse_parameters(bytes: &[u8]) -> Result<Option<OtpAccount>> {
    let mut secret = Zeroizing::new(vec![]);
    let (mut name, mut issuer) = (String::new(), String::new());
    let (mut algorithm, mut digits, mut kind) = (Algorithm::Sha1, 6, 2);
    for field in Fields(bytes) {
        match field? {
            (1, Value::Bytes(value)) => *secret = value.to_vec(),
            (2, Value::Bytes(value)) => name = utf8(value)?,
            (3, Value::Bytes(value)) => issuer = utf8(value)?,
            (4, Value::Varint(value)) => {
                algorithm = match value {
                    0 | 1 => Algorithm::Sha1,
                    2 => Algorithm::Sha256,
                    3 => Algorithm::Sha512,
                    _ => return Err(VaultError::InvalidInput),
                }
            }
            (5, Value::Varint(value)) => {
                digits = match value {
                    0 | 1 => 6,
                    2 => 8,
                    _ => return Err(VaultError::InvalidInput),
                }
            }
            (6, Value::Varint(value)) => kind = value,
            _ => {}
        }
    }
    // 1 is HOTP. Its counter would have to stay in sync with the server.
    if kind == 1 {
        return Err(VaultError::InvalidInput);
    }
    let account = match name.split_once(':') {
        Some((prefix, rest)) if issuer.is_empty() || prefix.trim() == issuer => {
            if issuer.is_empty() {
                issuer = prefix.trim().to_owned();
            }
            rest.trim().to_owned()
        }
        _ => name.trim().to_owned(),
    };
    let totp = Totp::new(secret.to_vec(), algorithm, digits, 30)?;
    account_with(issuer.trim().to_owned(), account, totp).map(Some)
}

fn utf8(bytes: &[u8]) -> Result<String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| VaultError::InvalidInput)
}

enum Value<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
}

/// The fields of one protocol buffer message.
struct Fields<'a>(&'a [u8]);

impl<'a> Fields<'a> {
    fn varint(&mut self) -> Result<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = self.0.split_first().ok_or(VaultError::InvalidInput)?;
            self.0 = rest;
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
        }
        Err(VaultError::InvalidInput)
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = Result<(u64, Value<'a>)>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.0.is_empty() {
            return None;
        }
        let field = (|| {
            let key = self.varint()?;
            let value = match key & 7 {
                0 => Value::Varint(self.varint()?),
                2 => {
                    let length =
                        usize::try_from(self.varint()?).map_err(|_| VaultError::InvalidInput)?;
                    if length > self.0.len() {
                        return Err(VaultError::InvalidInput);
                    }
                    let (value, rest) = self.0.split_at(length);
                    self.0 = rest;
                    Value::Bytes(value)
                }
                _ => return Err(VaultError::InvalidInput),
            };
            Ok((key >> 3, value))
        })();
        if field.is_err() {
            // Stop after the first malformed field.
            self.0 = &[];
        }
        Some(field)
    }
}

pub(super) fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl Vault {
    /// The entry's current code. Reading it doesn't count as activity: the
    /// window refreshes it while an entry stays selected.
    pub fn totp_code(&mut self, id: &str) -> Result<TotpCode> {
        self.unlocked()?
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .and_then(|entry| entry.totp.as_ref())
            .map(|totp| totp.code(now()))
            .ok_or(VaultError::InvalidInput)
    }

    /// Adds each account to the entry it names, replacing that entry's key,
    /// or as a new entry without a password. Everything saves in one write.
    pub fn import_totp(&mut self, accounts: Vec<(OtpAccount, Option<String>)>) -> Result<()> {
        let mut ids = Vec::with_capacity(accounts.len());
        for _ in &accounts {
            ids.push(random_id()?);
        }
        self.commit(|entries| {
            for ((account, target), id) in accounts.iter().zip(ids) {
                if let Some(target) = target {
                    let entry = entries
                        .iter_mut()
                        .find(|entry| &entry.id == target)
                        .ok_or(VaultError::InvalidInput)?;
                    entry.totp = Some(account.totp.clone());
                    continue;
                }
                if entries.len() >= MAX_ENTRIES {
                    return Err(VaultError::InvalidInput);
                }
                let name = [&account.issuer, &account.account]
                    .into_iter()
                    .find(|name| !name.trim().is_empty())
                    .map_or_else(|| "Authenticator".to_owned(), |name| name.trim().to_owned());
                let entry = Entry {
                    id,
                    name: name.chars().take(256).collect(),
                    site: String::new(),
                    username: account.account.clone(),
                    password: String::new(),
                    notes: String::new(),
                    totp: Some(account.totp.clone()),
                };
                validate_fields(&entry.name, &entry.site, &entry.username)?;
                entries.push(entry);
            }
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238, appendix B. The seeds are the ASCII digits repeated to the hash's size.
    const SEED_20: &[u8] = b"12345678901234567890";
    const SEED_32: &[u8] = b"12345678901234567890123456789012";
    const SEED_64: &[u8] = b"1234567890123456789012345678901234567890123456789012345678901234";

    fn code(seed: &[u8], algorithm: Algorithm, time: u64) -> String {
        Totp::new(seed.to_vec(), algorithm, 8, 30)
            .unwrap()
            .code(time)
            .code
            .clone()
    }

    #[test]
    fn codes_match_the_rfc_6238_vectors() {
        for (time, sha1, sha256, sha512) in [
            (59, "94287082", "46119246", "90693936"),
            (1_111_111_109, "07081804", "68084774", "25091201"),
            (1_234_567_890, "89005924", "91819424", "93441116"),
            (20_000_000_000, "65353130", "77737706", "47863826"),
        ] {
            assert_eq!(code(SEED_20, Algorithm::Sha1, time), sha1);
            assert_eq!(code(SEED_32, Algorithm::Sha256, time), sha256);
            assert_eq!(code(SEED_64, Algorithm::Sha512, time), sha512);
        }
        let totp = Totp::new(SEED_20.to_vec(), Algorithm::Sha1, 6, 30).unwrap();
        let current = totp.code(59);
        assert_eq!(current.code, "287082");
        assert_eq!((current.period, current.remaining), (30, 1));
        assert_eq!(totp.code(60).remaining, 30);
    }

    #[test]
    fn keys_parse_from_base32_and_links() {
        // "12345678901234567890" in Base32, as sites show it.
        let key = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
        let totp = Totp::parse(key).unwrap();
        assert_eq!(totp.secret, SEED_20);
        assert_eq!(totp.code(59).code, "287082");
        assert_eq!(
            Totp::parse("GEZDGNBVGY3TQOJQ====").unwrap().secret,
            b"1234567890"
        );
        for invalid in [
            "",
            "not base32!",
            "otpauth://hotp/x?secret=GEZDGNBV&counter=1",
        ] {
            assert!(Totp::parse(invalid).is_err(), "{invalid}");
        }

        let link = "otpauth://totp/Example%20Co:me%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example%20Co&algorithm=SHA256&digits=8&period=60";
        let accounts = parse_accounts(link).unwrap();
        assert_eq!(accounts.len(), 1);
        let account = &accounts[0];
        assert_eq!(
            (account.issuer.as_str(), account.account.as_str()),
            ("Example Co", "me@example.com")
        );
        assert_eq!(account.totp.algorithm, Algorithm::Sha256);
        assert_eq!((account.totp.digits, account.totp.period), (8, 60));

        let bare = parse_accounts("otpauth://totp/Service:name?secret=GEZDGNBV").unwrap();
        assert_eq!(bare[0].issuer, "Service");
        assert_eq!(bare[0].totp.digits, 6);
        for invalid in [
            "https://example.com",
            "otpauth://totp/x?secret=GEZDGNBV&digits=12",
            "otpauth://totp/x?secret=GEZDGNBV&algorithm=MD5",
            "otpauth://totp/x",
        ] {
            assert!(parse_accounts(invalid).is_err(), "{invalid}");
        }
    }

    fn field(number: u64, bytes: &[u8]) -> Vec<u8> {
        let mut out = vec![(number << 3 | 2) as u8, bytes.len() as u8];
        out.extend(bytes);
        out
    }

    fn varint(number: u64, value: u8) -> Vec<u8> {
        vec![(number << 3) as u8, value]
    }

    fn migration(parameters: &[Vec<u8>]) -> String {
        use base64::Engine;
        let mut payload = vec![];
        for parameters in parameters {
            payload.extend(field(1, parameters));
        }
        payload.extend(varint(2, 1));
        let data = base64::engine::general_purpose::STANDARD.encode(payload);
        let mut url = url::Url::parse("otpauth-migration://offline").unwrap();
        url.query_pairs_mut().append_pair("data", &data);
        url.to_string()
    }

    #[test]
    fn google_authenticator_exports_import() {
        let github = [
            field(1, SEED_20),
            field(2, b"GitHub:octocat"),
            field(3, b"GitHub"),
            varint(4, 1),
            varint(5, 1),
            varint(6, 2),
        ]
        .concat();
        let plain = [
            field(1, SEED_32),
            field(2, b"me@example.com"),
            varint(4, 2),
            varint(5, 2),
        ]
        .concat();
        let accounts = parse_accounts(&migration(&[github, plain])).unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(
            (accounts[0].issuer.as_str(), accounts[0].account.as_str()),
            ("GitHub", "octocat")
        );
        assert_eq!(accounts[0].totp.code(59).code, "287082");
        assert_eq!(
            (accounts[1].issuer.as_str(), accounts[1].account.as_str()),
            ("", "me@example.com")
        );
        assert_eq!(accounts[1].totp.algorithm, Algorithm::Sha256);
        assert_eq!(accounts[1].totp.digits, 8);

        let hotp = [field(1, SEED_20), field(2, b"counter"), varint(6, 1)].concat();
        assert!(parse_accounts(&migration(&[hotp])).is_err());
        assert!(parse_accounts("otpauth-migration://offline?data=AAAA").is_err());
    }
}
