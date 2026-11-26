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

/// A stored site matches a page with the same scheme, port, and host. A host
/// and the same host with `www.` in front match each other. A host written
/// as `*.example.com` also matches every subdomain of `example.com`. A site
/// without a scheme means `https`, so a login is never offered to a plain
/// `http` page unless it says so.
pub fn matches(site: &str, origin: &Url) -> bool {
    let site = site.trim();
    let (scheme, rest) = match site.split_once("://") {
        Some((scheme, rest)) => (scheme, rest),
        None => ("https", site),
    };
    let (subdomains, rest) = match rest.strip_prefix("*.") {
        Some(rest) => (true, rest),
        None => (false, rest),
    };
    if rest.is_empty() {
        return false;
    }
    let Some(stored) = Url::parse(&format!("{scheme}://{rest}"))
        .ok()
        .filter(|url| url.host().is_some())
    else {
        return false;
    };
    if stored.scheme() != origin.scheme()
        || stored.port_or_known_default() != origin.port_or_known_default()
    {
        return false;
    }
    match (stored.host(), origin.host()) {
        // A wildcard needs at least a registrable-looking domain, never `*.com`.
        (Some(Host::Domain(stored)), Some(Host::Domain(page))) if subdomains => {
            stored.contains('.') && (page == stored || page.ends_with(&format!(".{stored}")))
        }
        (Some(Host::Domain(stored)), Some(Host::Domain(page))) => {
            without_www(page) == without_www(stored)
        }
        (Some(stored), Some(page)) => !subdomains && stored == page,
        _ => false,
    }
}

fn without_www(host: &str) -> &str {
    host.strip_prefix("www.").unwrap_or(host)
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
    fn sites_match_exact_hosts() {
        let github = page("https://github.com");
        for site in [
            "github.com",
            "https://github.com",
            "https://github.com/login",
            "www.github.com",
            "https://www.github.com",
            " GitHub.com ",
        ] {
            assert!(matches(site, &github), "{site}");
        }
        assert!(matches("github.com", &page("https://www.github.com")));
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
        for origin in [
            "https://accounts.example.com",
            "https://user.www.example.com",
        ] {
            assert!(!matches("example.com", &page(origin)), "{origin}");
            assert!(!matches("www.example.com", &page(origin)), "{origin}");
        }
    }

    #[test]
    fn wildcards_opt_into_subdomains() {
        for site in [
            "*.example.com",
            "https://*.example.com",
            "*.example.com/login",
        ] {
            for origin in [
                "https://example.com",
                "https://accounts.example.com",
                "https://a.b.example.com",
            ] {
                assert!(matches(site, &page(origin)), "{site} {origin}");
            }
            for origin in [
                "https://notexample.com",
                "https://example.com.evil.example",
                "http://accounts.example.com",
            ] {
                assert!(!matches(site, &page(origin)), "{site} {origin}");
            }
        }
        assert!(!matches("*.com", &page("https://example.com")));
        assert!(!matches("*.localhost", &page("https://app.localhost")));
        assert!(!matches("*.", &page("https://example.com")));
        assert!(!matches("*.192.168.1.1", &page("https://192.168.1.1")));
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
