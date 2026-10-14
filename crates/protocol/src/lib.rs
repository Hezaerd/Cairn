use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use zeroize::Zeroizing;

pub const VERSION: u8 = 1;
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;

/// Every request carries the protocol version and an ID echoed by its reply.
/// Authenticated operations also carry a paired client ID, a single-use
/// challenge from the app, and a signature over the operation.
#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", deny_unknown_fields, rename_all_fields = "camelCase")]
pub enum Request {
    GetStatus {
        version: u8,
        request_id: String,
    },
    GetChallenge {
        version: u8,
        request_id: String,
    },
    Pair {
        version: u8,
        request_id: String,
        public_key: String,
        name: String,
    },
    ListLogins {
        version: u8,
        request_id: String,
        origin: String,
        client_id: String,
        challenge: String,
        signature: String,
    },
    GetLogin {
        version: u8,
        request_id: String,
        origin: String,
        entry_id: String,
        client_id: String,
        challenge: String,
        signature: String,
    },
    /// Asks whether the vault already holds a login typed into a page.
    /// `proof` is an HMAC-SHA256 of the password keyed with the challenge, so
    /// the password itself doesn't cross the bridge before the user agrees to
    /// save it.
    CheckLogin {
        version: u8,
        request_id: String,
        origin: String,
        username: String,
        proof: String,
        client_id: String,
        challenge: String,
        signature: String,
    },
    /// Saves a new login for `origin`, after the user agreed in the browser.
    SaveLogin {
        version: u8,
        request_id: String,
        origin: String,
        name: String,
        username: String,
        password: Zeroizing<String>,
        client_id: String,
        challenge: String,
        signature: String,
    },
    /// Replaces the password of a login for `origin`.
    UpdateLogin {
        version: u8,
        request_id: String,
        origin: String,
        entry_id: String,
        password: Zeroizing<String>,
        client_id: String,
        challenge: String,
        signature: String,
    },
}

/// The proof attached to an authenticated request.
#[derive(Debug, PartialEq)]
pub struct Auth<'a> {
    pub client_id: &'a str,
    pub challenge: &'a str,
    pub signature: &'a str,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub enum ErrorCode {
    InvalidRequest,
    UnsupportedVersion,
    AppUnavailable,
    RequestTimeout,
    ProtocolMismatch,
    VaultLocked,
    NotPaired,
    Unauthorized,
    NotFound,
    /// Another browser asked to pair while this request waited, so the app
    /// refused both.
    PairingConflict,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LoginSummary {
    pub id: String,
    pub name: String,
    pub username: String,
}

/// What the vault knows about a login typed into a page.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub enum CheckResult {
    /// No login for the site has this username.
    New,
    /// A login for the site has this username and password.
    Known,
    /// A login for the site has this username with another password.
    Changed,
}

#[derive(Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", deny_unknown_fields, rename_all_fields = "camelCase")]
pub enum Response {
    Status {
        version: u8,
        request_id: String,
        app_version: String,
    },
    Challenge {
        version: u8,
        request_id: String,
        challenge: String,
    },
    /// The app shows the pairing code and waits for the user to approve it.
    /// The code comes from the SHA-256 of `nonce` and the browser's key.
    PairingRequested {
        version: u8,
        request_id: String,
        nonce: String,
    },
    Logins {
        version: u8,
        request_id: String,
        logins: Vec<LoginSummary>,
    },
    Login {
        version: u8,
        request_id: String,
        username: String,
        password: Zeroizing<String>,
    },
    /// `entry` is the login whose password changed, sent only with `Changed`.
    LoginCheck {
        version: u8,
        request_id: String,
        result: CheckResult,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        entry: Option<LoginSummary>,
    },
    Saved {
        version: u8,
        request_id: String,
    },
    Error {
        version: u8,
        request_id: Option<String>,
        code: ErrorCode,
    },
}

/// Request IDs, client IDs, challenges, and signatures share this alphabet.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Unpadded base64url of a fixed number of bytes.
pub fn valid_base64url(value: &str, bytes: usize) -> bool {
    value.len() == (bytes * 4).div_ceil(3)
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub const PUBLIC_KEY_BYTES: usize = 65;
pub const CLIENT_ID_BYTES: usize = 32;
pub const CHALLENGE_BYTES: usize = 32;
pub const PAIRING_NONCE_BYTES: usize = 32;
pub const SIGNATURE_BYTES: usize = 64;
pub const PROOF_BYTES: usize = 32;

impl Request {
    pub fn version(&self) -> u8 {
        match self {
            Self::GetStatus { version, .. }
            | Self::GetChallenge { version, .. }
            | Self::Pair { version, .. }
            | Self::ListLogins { version, .. }
            | Self::GetLogin { version, .. }
            | Self::CheckLogin { version, .. }
            | Self::SaveLogin { version, .. }
            | Self::UpdateLogin { version, .. } => *version,
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::GetStatus { request_id, .. }
            | Self::GetChallenge { request_id, .. }
            | Self::Pair { request_id, .. }
            | Self::ListLogins { request_id, .. }
            | Self::GetLogin { request_id, .. }
            | Self::CheckLogin { request_id, .. }
            | Self::SaveLogin { request_id, .. }
            | Self::UpdateLogin { request_id, .. } => request_id,
        }
    }

    fn validate(&self) -> bool {
        let fields = match self {
            Self::GetStatus { .. } | Self::GetChallenge { .. } => true,
            Self::Pair {
                public_key, name, ..
            } => {
                valid_base64url(public_key, PUBLIC_KEY_BYTES)
                    && !name.trim().is_empty()
                    && name.chars().count() <= 64
                    && !name.chars().any(char::is_control)
            }
            Self::ListLogins { origin, .. } => valid_origin(origin),
            Self::GetLogin {
                origin, entry_id, ..
            } => valid_origin(origin) && valid_entry_id(entry_id),
            Self::CheckLogin {
                origin,
                username,
                proof,
                ..
            } => {
                valid_origin(origin)
                    && valid_username(username)
                    && valid_base64url(proof, PROOF_BYTES)
            }
            Self::SaveLogin {
                origin,
                name,
                username,
                password,
                ..
            } => {
                valid_origin(origin)
                    && !name.trim().is_empty()
                    && name.len() <= 256
                    && !name.chars().any(char::is_control)
                    && valid_username(username)
                    && valid_password(password)
            }
            Self::UpdateLogin {
                origin,
                entry_id,
                password,
                ..
            } => valid_origin(origin) && valid_entry_id(entry_id) && valid_password(password),
        };
        let auth = self.auth().is_none_or(|auth| {
            valid_base64url(auth.client_id, CLIENT_ID_BYTES)
                && valid_base64url(auth.challenge, CHALLENGE_BYTES)
                && valid_base64url(auth.signature, SIGNATURE_BYTES)
        });
        self.version() == VERSION && valid_id(self.id()) && fields && auth
    }

    pub fn auth(&self) -> Option<Auth<'_>> {
        match self {
            Self::ListLogins {
                client_id,
                challenge,
                signature,
                ..
            }
            | Self::GetLogin {
                client_id,
                challenge,
                signature,
                ..
            }
            | Self::CheckLogin {
                client_id,
                challenge,
                signature,
                ..
            }
            | Self::SaveLogin {
                client_id,
                challenge,
                signature,
                ..
            }
            | Self::UpdateLogin {
                client_id,
                challenge,
                signature,
                ..
            } => Some(Auth {
                client_id,
                challenge,
                signature,
            }),
            _ => None,
        }
    }
}

/// A browser origin such as `https://example.com:8443`. The app parses it
/// fully; this only bounds what crosses the boundary.
fn valid_origin(origin: &str) -> bool {
    origin.len() <= 2048
        && (origin.starts_with("https://") || origin.starts_with("http://"))
        && origin.bytes().all(|b| b.is_ascii_graphic())
}

fn valid_entry_id(entry_id: &str) -> bool {
    entry_id.len() == 32 && entry_id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A username may be empty, on a page that asks for the password alone.
fn valid_username(username: &str) -> bool {
    username.len() <= 1024 && !username.chars().any(char::is_control)
}

fn valid_password(password: &str) -> bool {
    !password.is_empty() && password.len() <= 4096
}

/// The exact bytes a client signs for an authenticated operation. Only the
/// last field can contain a newline, so the encoding is unambiguous.
pub fn signed_message(request: &Request) -> Option<String> {
    match request {
        Request::ListLogins {
            origin, challenge, ..
        } => Some(format!(
            "cairn-bridge-v1\n{challenge}\nListLogins\n{origin}\n"
        )),
        Request::GetLogin {
            origin,
            entry_id,
            challenge,
            ..
        } => Some(format!(
            "cairn-bridge-v1\n{challenge}\nGetLogin\n{origin}\n{entry_id}"
        )),
        Request::CheckLogin {
            origin,
            username,
            proof,
            challenge,
            ..
        } => Some(format!(
            "cairn-bridge-v1\n{challenge}\nCheckLogin\n{origin}\n{proof}\n{username}"
        )),
        Request::SaveLogin {
            origin,
            name,
            username,
            password,
            challenge,
            ..
        } => Some(format!(
            "cairn-bridge-v1\n{challenge}\nSaveLogin\n{origin}\n{name}\n{username}\n{}",
            password.as_str()
        )),
        Request::UpdateLogin {
            origin,
            entry_id,
            password,
            challenge,
            ..
        } => Some(format!(
            "cairn-bridge-v1\n{challenge}\nUpdateLogin\n{origin}\n{entry_id}\n{}",
            password.as_str()
        )),
        _ => None,
    }
}

impl Response {
    pub fn error(request_id: Option<String>, code: ErrorCode) -> Self {
        Self::Error {
            version: VERSION,
            request_id,
            code,
        }
    }

    pub fn status(request: &Request, app_version: &str) -> Self {
        Self::Status {
            version: VERSION,
            request_id: request.id().into(),
            app_version: app_version.into(),
        }
    }

    /// Checks that a reply answers this request with an expected type.
    pub fn matches(&self, request: &Request) -> bool {
        let id = request.id();
        match (self, request) {
            (
                Self::Status {
                    version,
                    request_id,
                    app_version,
                },
                Request::GetStatus { .. },
            ) => *version == VERSION && request_id == id && valid_version(app_version),
            (
                Self::Challenge {
                    version,
                    request_id,
                    challenge,
                },
                Request::GetChallenge { .. },
            ) => {
                *version == VERSION
                    && request_id == id
                    && valid_base64url(challenge, CHALLENGE_BYTES)
            }
            (
                Self::PairingRequested {
                    version,
                    request_id,
                    nonce,
                },
                Request::Pair { .. },
            ) => {
                *version == VERSION
                    && request_id == id
                    && valid_base64url(nonce, PAIRING_NONCE_BYTES)
            }
            (
                Self::Logins {
                    version,
                    request_id,
                    ..
                },
                Request::ListLogins { .. },
            )
            | (
                Self::Login {
                    version,
                    request_id,
                    ..
                },
                Request::GetLogin { .. },
            )
            | (
                Self::Saved {
                    version,
                    request_id,
                },
                Request::SaveLogin { .. } | Request::UpdateLogin { .. },
            ) => *version == VERSION && request_id == id,
            (
                Self::LoginCheck {
                    version,
                    request_id,
                    result,
                    entry,
                },
                Request::CheckLogin { .. },
            ) => {
                *version == VERSION
                    && request_id == id
                    && (*result == CheckResult::Changed) == entry.is_some()
            }
            (
                Self::Error {
                    version,
                    request_id,
                    ..
                },
                _,
            ) => *version == VERSION && request_id.as_deref() == Some(id),
            _ => false,
        }
    }
}

fn valid_version(version: &str) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

pub fn parse_request(bytes: &[u8]) -> Result<Request, Response> {
    let failure = || Response::error(None, ErrorCode::InvalidRequest);
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(failure());
    }
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| failure())?;
    let request_id = value
        .get("requestId")
        .and_then(|v| v.as_str())
        .filter(|s| valid_id(s))
        .map(str::to_owned);
    if value
        .get("version")
        .and_then(|v| v.as_u64())
        .is_some_and(|v| v != u64::from(VERSION))
    {
        return Err(Response::error(request_id, ErrorCode::UnsupportedVersion));
    }
    // Parse the original bytes, so duplicate JSON fields are rejected by Serde.
    let request: Request = serde_json::from_slice(bytes)
        .map_err(|_| Response::error(request_id.clone(), ErrorCode::InvalidRequest))?;
    if !request.validate() {
        return Err(Response::error(request_id, ErrorCode::InvalidRequest));
    }
    Ok(request)
}

pub fn read_frame(reader: &mut impl Read) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0; 4];
    if reader.read(&mut header[..1])? == 0 {
        return Ok(None);
    }
    reader.read_exact(&mut header[1..])?;
    let size = u32::from_le_bytes(header) as usize;
    if size == 0 || size > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes)?;
    Ok(Some(bytes))
}

pub fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    writer.write_all(&(bytes.len() as u32).to_le_bytes())?;
    writer.write_all(bytes)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frames_reject_oversize_and_truncation() {
        assert!(read_frame(&mut &u32::MAX.to_le_bytes()[..]).is_err());
        assert!(read_frame(&mut &[3, 0, 0, 0, 1][..]).is_err());
        assert!(read_frame(&mut &[1, 0][..]).is_err());
        assert!(read_frame(&mut &[][..]).unwrap().is_none());
    }
    #[test]
    fn frame_roundtrip() {
        let mut data = vec![];
        write_frame(&mut data, b"hello").unwrap();
        assert_eq!(read_frame(&mut &data[..]).unwrap().unwrap(), b"hello");
    }
    #[test]
    fn authenticated_requests_roundtrip() {
        let bytes = br#"{"version":1,"requestId":"r-1","type":"GetLogin","origin":"https://example.com","entryId":"0123456789abcdef0123456789abcdef","clientId":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","challenge":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","signature":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}"#;
        let request = parse_request(bytes).unwrap();
        let again = parse_request(&serde_json::to_vec(&request).unwrap()).unwrap();
        assert_eq!(request, again);
        let message = signed_message(&request).unwrap();
        assert!(
            message.ends_with("\nGetLogin\nhttps://example.com\n0123456789abcdef0123456789abcdef")
        );
    }
    #[test]
    fn saving_signs_every_field() {
        let auth = r#""clientId":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","challenge":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","signature":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA""#;
        let message = |fields: &str| {
            let bytes = format!(r#"{{"version":1,"requestId":"r-1",{fields},{auth}}}"#);
            signed_message(&parse_request(bytes.as_bytes()).unwrap()).unwrap()
        };
        assert!(
            message(r#""type":"CheckLogin","origin":"https://example.com","username":"me","proof":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA""#)
                .ends_with("\nCheckLogin\nhttps://example.com\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA\nme")
        );
        assert!(
            message(r#""type":"SaveLogin","origin":"https://example.com","name":"Example","username":"me","password":"pass\nword""#)
                .ends_with("\nSaveLogin\nhttps://example.com\nExample\nme\npass\nword")
        );
        assert!(
            message(r#""type":"UpdateLogin","origin":"https://example.com","entryId":"0123456789abcdef0123456789abcdef","password":"new""#)
                .ends_with("\nUpdateLogin\nhttps://example.com\n0123456789abcdef0123456789abcdef\nnew")
        );
    }

    #[test]
    fn shared_fixtures() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/protocol/cases.json"))
                .unwrap();
        for case in fixtures.as_array().unwrap() {
            let bytes = serde_json::to_vec(&case["message"]).unwrap();
            let valid = if case["kind"] == "request" {
                parse_request(&bytes).is_ok()
            } else {
                let request = serde_json::from_value::<Request>(case["request"].clone()).unwrap_or(
                    Request::GetStatus {
                        version: VERSION,
                        request_id: "test-1".into(),
                    },
                );
                serde_json::from_slice::<Response>(&bytes)
                    .is_ok_and(|response| response.matches(&request))
            };
            assert_eq!(valid, case["valid"].as_bool().unwrap(), "{}", case["name"]);
        }
    }
}
