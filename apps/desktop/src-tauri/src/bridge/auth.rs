//! Pairing keys, challenges, and request signatures. The extension holds a
//! P-256 key pair from WebCrypto; the app stores its public key when you
//! approve the pairing and checks a signature on every vault request.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};

const CHALLENGE_LIFETIME: Duration = Duration::from_secs(30);
const MAX_CHALLENGES: usize = 64;

/// An uncompressed SEC1 point, as WebCrypto exports a raw P-256 public key.
fn public_key(encoded: &str) -> Option<(Vec<u8>, VerifyingKey)> {
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if bytes.len() != 65 || bytes[0] != 4 {
        return None;
    }
    let key = VerifyingKey::from_sec1_bytes(&bytes).ok()?;
    Some((bytes, key))
}

/// The client ID is the SHA-256 of the raw public key.
pub fn client_id(encoded: &str) -> Option<String> {
    let (bytes, _) = public_key(encoded)?;
    Some(URL_SAFE_NO_PAD.encode(Sha256::digest(bytes)))
}

/// Eight digits shown in both the popup and the app, so you can check that
/// the browser asking to pair is the one in front of you.
pub fn pairing_code(encoded: &str) -> Option<String> {
    let (bytes, _) = public_key(encoded)?;
    let digest = Sha256::digest(bytes);
    let value = u32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]]) % 100_000_000;
    Some(format!("{:04} {:04}", value / 10_000, value % 10_000))
}

/// Checks an IEEE P1363 (r || s) ECDSA signature over SHA-256, as WebCrypto makes them.
pub fn verify(encoded_key: &str, message: &str, encoded_signature: &str) -> bool {
    let Some((_, key)) = public_key(encoded_key) else {
        return false;
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(encoded_signature) else {
        return false;
    };
    let Ok(signature) = Signature::from_slice(&bytes) else {
        return false;
    };
    key.verify(message.as_bytes(), &signature).is_ok()
}

/// Single-use challenges. Each authenticated request signs a fresh one, so
/// a captured request can't be replayed.
#[derive(Default)]
pub struct Challenges(Mutex<VecDeque<(String, Instant)>>);

impl Challenges {
    pub fn issue(&self) -> Option<String> {
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).ok()?;
        let challenge = URL_SAFE_NO_PAD.encode(bytes);
        let mut challenges = self.0.lock().ok()?;
        challenges.retain(|(_, issued)| issued.elapsed() < CHALLENGE_LIFETIME);
        if challenges.len() >= MAX_CHALLENGES {
            challenges.pop_front();
        }
        challenges.push_back((challenge.clone(), Instant::now()));
        Some(challenge)
    }

    pub fn take(&self, challenge: &str) -> bool {
        let Ok(mut challenges) = self.0.lock() else {
            return false;
        };
        challenges.retain(|(_, issued)| issued.elapsed() < CHALLENGE_LIFETIME);
        let Some(index) = challenges.iter().position(|(value, _)| value == challenge) else {
            return false;
        };
        challenges.remove(index);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::{
        ecdsa::{SigningKey, signature::Signer},
        elliptic_curve::rand_core::OsRng,
    };

    fn key_pair() -> (SigningKey, String) {
        let signing = SigningKey::random(&mut OsRng);
        let public =
            URL_SAFE_NO_PAD.encode(signing.verifying_key().to_encoded_point(false).as_bytes());
        (signing, public)
    }

    #[test]
    fn signatures_bind_the_key_and_the_message() {
        let (signing, public) = key_pair();
        let (_, other) = key_pair();
        let signature: Signature = signing.sign(b"cairn-bridge-v1\nmessage");
        let encoded = URL_SAFE_NO_PAD.encode(signature.to_bytes());
        assert!(verify(&public, "cairn-bridge-v1\nmessage", &encoded));
        assert!(!verify(&public, "cairn-bridge-v1\nother", &encoded));
        assert!(!verify(&other, "cairn-bridge-v1\nmessage", &encoded));
        assert!(!verify(&public, "cairn-bridge-v1\nmessage", "AAAA"));
    }

    #[test]
    fn keys_ids_and_codes() {
        let (_, public) = key_pair();
        assert_eq!(client_id(&public).unwrap().len(), 43);
        let code = pairing_code(&public).unwrap();
        assert_eq!(code.len(), 9);
        assert!(client_id("AAAA").is_none());
        // A compressed point is valid P-256 but not what WebCrypto exports.
        let compressed = URL_SAFE_NO_PAD.encode(
            SigningKey::random(&mut OsRng)
                .verifying_key()
                .to_encoded_point(true)
                .as_bytes(),
        );
        assert!(client_id(&compressed).is_none());
    }

    #[test]
    fn webcrypto_signatures_verify() {
        // Made by WebCrypto in Node; tests/pairing.test.ts checks the same file.
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/protocol/signature.json"
        ))
        .unwrap();
        let key = fixture["publicKey"].as_str().unwrap();
        let message = fixture["message"].as_str().unwrap();
        let signature = fixture["signature"].as_str().unwrap();
        assert!(verify(key, message, signature));
        assert!(!verify(
            key,
            &message.replace("example.com", "evil.example"),
            signature
        ));
        assert_eq!(client_id(key).as_deref(), fixture["clientId"].as_str());
        assert_eq!(pairing_code(key).as_deref(), fixture["code"].as_str());
    }

    #[test]
    fn challenges_are_single_use() {
        let challenges = Challenges::default();
        let challenge = challenges.issue().unwrap();
        assert_eq!(challenge.len(), 43);
        assert!(!challenges.take("unknown"));
        assert!(challenges.take(&challenge));
        assert!(!challenges.take(&challenge));
    }
}
