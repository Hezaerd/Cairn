//! Whether a login typed into a page is already in the vault. The browser
//! sends the username and an HMAC of the password keyed with the request's
//! challenge, never the password itself, until the user chooses to save it.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use cairn_protocol::{CheckResult, LoginSummary};
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// A stored login for the page's site.
pub struct Candidate<'a> {
    pub summary: LoginSummary,
    pub password: &'a str,
}

/// Checks `proof` against a stored password, in constant time.
pub fn proves(challenge: &str, proof: &str, password: &str) -> bool {
    let (Ok(key), Ok(proof)) = (
        URL_SAFE_NO_PAD.decode(challenge),
        URL_SAFE_NO_PAD.decode(proof),
    ) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&key) else {
        return false;
    };
    mac.update(password.as_bytes());
    mac.verify_slice(&proof).is_ok()
}

/// Usernames compare without case or surrounding spaces, as most sites do.
fn same_user(stored: &str, typed: &str) -> bool {
    stored.trim().to_lowercase() == typed.trim().to_lowercase()
}

/// `Known` when a login for the site has this username and password.
/// `Changed`, with the first such login by name, when the username is there
/// with another password. Without a username, the page asked for the password
/// alone: any login for the site with that password counts as known, and
/// nothing counts as changed, since there's no telling which one it was.
pub fn check(
    candidates: Vec<Candidate<'_>>,
    username: &str,
    challenge: &str,
    proof: &str,
) -> (CheckResult, Option<LoginSummary>) {
    let anonymous = username.trim().is_empty();
    let mut accounts: Vec<_> = candidates
        .into_iter()
        .filter(|candidate| anonymous || same_user(&candidate.summary.username, username))
        .collect();
    if accounts
        .iter()
        .any(|candidate| proves(challenge, proof, candidate.password))
    {
        return (CheckResult::Known, None);
    }
    if anonymous {
        return (CheckResult::New, None);
    }
    accounts.sort_by_key(|candidate| candidate.summary.name.to_lowercase());
    match accounts.into_iter().next() {
        Some(candidate) => (CheckResult::Changed, Some(candidate.summary)),
        None => (CheckResult::New, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHALLENGE: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn proof(challenge: &str, password: &str) -> String {
        let key = URL_SAFE_NO_PAD.decode(challenge).unwrap();
        let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
        mac.update(password.as_bytes());
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    fn candidate<'a>(id: &str, name: &str, username: &str, password: &'a str) -> Candidate<'a> {
        Candidate {
            summary: LoginSummary {
                id: id.into(),
                name: name.into(),
                username: username.into(),
            },
            password,
        }
    }

    fn logins() -> Vec<Candidate<'static>> {
        vec![
            candidate("b", "Work", "me@example.com", "work-password"),
            candidate("a", "Personal", "Me@Example.com", "home-password"),
            candidate("c", "Other", "other@example.com", "shared-password"),
        ]
    }

    #[test]
    fn known_logins_need_the_same_username_and_password() {
        let known = proof(CHALLENGE, "home-password");
        assert_eq!(
            check(logins(), " me@example.com ", CHALLENGE, &known),
            (CheckResult::Known, None)
        );
        // Another account's password doesn't make this one known.
        let shared = proof(CHALLENGE, "shared-password");
        let (result, entry) = check(logins(), "me@example.com", CHALLENGE, &shared);
        assert_eq!(result, CheckResult::Changed);
        assert_eq!(entry.unwrap().id, "a", "the first login by name");
    }

    #[test]
    fn unknown_usernames_are_new() {
        let password = proof(CHALLENGE, "work-password");
        assert_eq!(
            check(logins(), "new@example.com", CHALLENGE, &password),
            (CheckResult::New, None)
        );
        assert_eq!(
            check(vec![], "me@example.com", CHALLENGE, &password),
            (CheckResult::New, None)
        );
    }

    #[test]
    fn a_password_alone_is_known_or_new() {
        let shared = proof(CHALLENGE, "shared-password");
        assert_eq!(
            check(logins(), "", CHALLENGE, &shared),
            (CheckResult::Known, None)
        );
        let other = proof(CHALLENGE, "unknown-password");
        assert_eq!(
            check(logins(), "", CHALLENGE, &other),
            (CheckResult::New, None)
        );
    }

    #[test]
    fn proofs_bind_the_challenge() {
        let other = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
        let password = proof(other, "home-password");
        assert!(proves(other, &password, "home-password"));
        assert!(!proves(CHALLENGE, &password, "home-password"));
        assert!(!proves(other, &password, "home-password!"));
        assert!(!proves(other, "AAAA", "home-password"));
    }

    #[test]
    fn webcrypto_proofs_verify() {
        // Made by WebCrypto in Node; tests/pairing.test.ts checks the same file.
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../../tests/fixtures/protocol/proof.json"
        ))
        .unwrap();
        let challenge = fixture["challenge"].as_str().unwrap();
        let password = fixture["password"].as_str().unwrap();
        let encoded = fixture["proof"].as_str().unwrap();
        assert_eq!(proof(challenge, password), encoded);
        assert!(proves(challenge, encoded, password));
    }
}
