//! Which logins belong to the page the browser is on.
use url::{Host, Url};

/// Accepts only a bare `http` or `https` origin, exactly as a browser
/// serializes it.
pub fn parse_origin(origin: &str) -> Option<Url> {
    let url = Url::parse(origin).ok()?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host().is_none()
        || url.origin().ascii_serialization() != origin
    {
        return None;
    }
    Some(url)
}

/// A stored site matches a page with the same scheme and port, on the same
/// host or one of its subdomains. A site without a scheme means `https`, so
/// a login is never offered to a plain `http` page unless it says so.
pub fn matches(site: &str, origin: &Url) -> bool {
    let site = site.trim();
    if site.is_empty() {
        return false;
    }
    let Some(stored) = Url::parse(site)
        .ok()
        .filter(|url| url.host().is_some())
        .or_else(|| Url::parse(&format!("https://{site}")).ok())
    else {
        return false;
    };
    if stored.scheme() != origin.scheme()
        || stored.port_or_known_default() != origin.port_or_known_default()
    {
        return false;
    }
    match (stored.host(), origin.host()) {
        (Some(Host::Domain(stored)), Some(Host::Domain(page))) => {
            let stored = stored.strip_prefix("www.").unwrap_or(stored);
            page == stored || page.ends_with(&format!(".{stored}"))
        }
        (Some(stored), Some(page)) => stored == page,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(origin: &str) -> Url {
        parse_origin(origin).unwrap()
    }

    #[test]
    fn origins_must_be_exact() {
        assert!(parse_origin("https://example.com").is_some());
        assert!(parse_origin("http://localhost:8080").is_some());
        for origin in [
            "https://example.com/",
            "https://example.com/login",
            "https://user@example.com",
            "https://Example.com",
            "ftp://example.com",
            "chrome://settings",
            "file:///C:/secret",
            "example.com",
        ] {
            assert!(parse_origin(origin).is_none(), "{origin}");
        }
    }

    #[test]
    fn sites_match_hosts_and_subdomains() {
        let github = page("https://github.com");
        for site in [
            "github.com",
            "https://github.com",
            "https://github.com/login",
            "www.github.com",
            " GitHub.com ",
        ] {
            assert!(matches(site, &github), "{site}");
        }
        assert!(matches(
            "example.com",
            &page("https://accounts.example.com")
        ));
        for site in [
            "",
            "gist.github.com",
            "notgithub.com",
            "github.com.evil.example",
            "http://github.com",
            "https://github.com:8443",
            "Personal GitHub",
        ] {
            assert!(!matches(site, &github), "{site}");
        }
    }

    #[test]
    fn plain_http_needs_an_explicit_scheme() {
        let router = page("http://192.168.1.1");
        assert!(matches("http://192.168.1.1", &router));
        assert!(!matches("192.168.1.1", &router));
        assert!(!matches("http://192.168.1.10", &router));
        assert!(matches(
            "http://localhost:3000",
            &page("http://localhost:3000")
        ));
        assert!(!matches(
            "http://localhost:3000",
            &page("http://localhost:4000")
        ));
    }
}
