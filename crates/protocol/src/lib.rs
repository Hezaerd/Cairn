use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

pub const VERSION: u8 = 1;
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub version: u8,
    pub request_id: String,
    #[serde(rename = "type")]
    pub kind: RequestKind,
}

#[derive(Debug, Deserialize, Serialize)]
pub enum RequestKind {
    GetStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub enum ErrorCode {
    InvalidRequest,
    UnsupportedVersion,
    AppUnavailable,
    RequestTimeout,
    ProtocolMismatch,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Response {
    #[serde(rename_all = "camelCase")]
    Status {
        version: u8,
        request_id: String,
        app_version: String,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        version: u8,
        request_id: Option<String>,
        code: ErrorCode,
    },
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
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
            request_id: request.request_id.clone(),
            app_version: app_version.into(),
        }
    }
    pub fn matches(&self, request: &Request) -> bool {
        match self {
            Self::Status {
                version,
                request_id,
                app_version,
            } => {
                *version == VERSION
                    && request_id == &request.request_id
                    && valid_version(app_version)
            }
            Self::Error {
                version,
                request_id,
                ..
            } => *version == VERSION && request_id.as_ref() == Some(&request.request_id),
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
    if request.version != VERSION || !valid_id(&request.request_id) {
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
    fn shared_fixtures() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/protocol/cases.json"))
                .unwrap();
        for case in fixtures.as_array().unwrap() {
            let bytes = serde_json::to_vec(&case["message"]).unwrap();
            let valid = if case["kind"] == "request" {
                parse_request(&bytes).is_ok()
            } else {
                serde_json::from_slice::<Response>(&bytes).is_ok_and(|response| {
                    response.matches(&Request {
                        version: VERSION,
                        request_id: "test-1".into(),
                        kind: RequestKind::GetStatus,
                    })
                })
            };
            assert_eq!(valid, case["valid"].as_bool().unwrap(), "{}", case["name"]);
        }
    }
}
