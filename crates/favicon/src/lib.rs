//! Public HTTPS only, with pinned DNS and same-origin redirects.
use image::{ImageFormat, ImageReader, Limits};
use reqwest::{Client, redirect::Policy};
use scraper::{Html, Selector};
use std::{
    io::Cursor,
    net::{IpAddr, SocketAddr},
    time::Duration,
};
use url::Url;
const MAX_DOWNLOAD: usize = 512 * 1024;

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_unspecified()
                || ip.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..=127).contains(&b))
                || (a == 198 && (b == 18 || b == 19))
                || (a == 192 && b == 0 && c == 0)
                || (a == 192 && b == 88 && c == 99))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}
fn valid_origin(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some()
}
fn same_origin(base: &Url, next: &Url) -> bool {
    next.scheme() == "https"
        && next.username().is_empty()
        && next.password().is_none()
        && base.origin() == next.origin()
}
async fn pinned_client(origin: &Url) -> Option<Client> {
    if !valid_origin(origin) {
        return None;
    }
    let host = origin.host_str()?;
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host.trim_matches(['[', ']']), 443))
        .await
        .ok()?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !public_ip(address.ip())) {
        return None;
    }
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .referer(false)
        .timeout(Duration::from_secs(4))
        .connect_timeout(Duration::from_secs(3))
        .user_agent("Cairn/0.1 favicon")
        .resolve_to_addrs(host, &addresses)
        .build()
        .ok()
}
async fn download(client: &Client, origin: &Url, mut url: Url) -> Option<Vec<u8>> {
    for _ in 0..4 {
        if !same_origin(origin, &url) {
            return None;
        }
        let mut response = client.get(url.clone()).send().await.ok()?;
        if response.status().is_redirection() {
            url = url
                .join(
                    response
                        .headers()
                        .get(reqwest::header::LOCATION)?
                        .to_str()
                        .ok()?,
                )
                .ok()?;
            continue;
        }
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|length| length > MAX_DOWNLOAD as u64)
        {
            return None;
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.ok()? {
            if bytes.len() + chunk.len() > MAX_DOWNLOAD {
                return None;
            }
            bytes.extend_from_slice(&chunk);
        }
        return Some(bytes);
    }
    None
}
fn normalize(bytes: &[u8]) -> Option<Vec<u8>> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Ico | ImageFormat::Jpeg | ImageFormat::WebP)
    ) {
        return None;
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(1024);
    limits.max_image_height = Some(1024);
    limits.max_alloc = Some(16 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().ok()?.thumbnail(64, 64);
    let mut output = Cursor::new(Vec::new());
    image.write_to(&mut output, ImageFormat::Png).ok()?;
    let bytes = output.into_inner();
    (bytes.len() <= 64 * 1024).then_some(bytes)
}
fn candidates(origin: &Url, html: &[u8]) -> Vec<Url> {
    let document = Html::parse_document(&String::from_utf8_lossy(html));
    let Ok(selector) = Selector::parse("link[rel][href]") else {
        return vec![];
    };
    document
        .select(&selector)
        .filter(|element| {
            element.value().attr("rel").is_some_and(|rel| {
                rel.split_ascii_whitespace().any(|part| {
                    part.eq_ignore_ascii_case("icon")
                        || part.eq_ignore_ascii_case("apple-touch-icon")
                })
            })
        })
        .filter_map(|element| origin.join(element.value().attr("href")?).ok())
        .filter(|url| same_origin(origin, url))
        .take(4)
        .collect()
}
async fn fetch_with(client: &Client, origin: &Url) -> Option<Vec<u8>> {
    if let Some(bytes) = download(client, origin, origin.join("/favicon.ico").ok()?).await
        && let Some(image) = normalize(&bytes)
    {
        return Some(image);
    }
    let html = download(client, origin, origin.clone()).await?;
    for candidate in candidates(origin, &html) {
        if let Some(bytes) = download(client, origin, candidate).await
            && let Some(image) = normalize(&bytes)
        {
            return Some(image);
        }
    }
    None
}
/// Dropping this future cancels network work. No cookies, credentials, SVG or third-party service.
pub async fn fetch(origin: &str) -> Option<Vec<u8>> {
    tokio::time::timeout(Duration::from_secs(12), async {
        let origin = Url::parse(origin).ok()?;
        if origin.path() != "/" || origin.query().is_some() || origin.fragment().is_some() {
            return None;
        }
        let client = pinned_client(&origin).await?;
        fetch_with(&client, &origin).await
    })
    .await
    .ok()
    .flatten()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_private_and_special_addresses() {
        for address in [
            "127.0.0.1",
            "10.1.2.3",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "100.64.0.1",
            "198.18.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "240.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "3fff::1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }
    #[test]
    fn discovers_only_same_origin_icons() {
        let origin = Url::parse("https://example.com").unwrap();
        let icons = candidates(&origin, br#"<link rel="stylesheet" href="a.css"><link rel="shortcut ICON" href="/logo.png"><link rel="apple-touch-icon" href="https://third.party/icon.png"><link rel="icon" href="http://example.com/a.ico"><link rel="icon" href="https://user:pass@example.com/a.ico"><link rel="icon" href="data:image/svg+xml,x">"#);
        assert_eq!(icons, vec![origin.join("/logo.png").unwrap()]);
        assert!(!valid_origin(
            &Url::parse("https://example.com:8080").unwrap()
        ));
    }
    #[test]
    fn rejects_active_content_and_reencodes_images() {
        assert!(normalize(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").is_none());
        assert!(normalize(b"not an image").is_none());
        let source = image::DynamicImage::new_rgba8(128, 128);
        let mut bytes = Cursor::new(Vec::new());
        source.write_to(&mut bytes, ImageFormat::Png).unwrap();
        let normalized = normalize(bytes.get_ref()).unwrap();
        let image = image::load_from_memory(&normalized).unwrap();
        assert_eq!((image.width(), image.height()), (64, 64));
        let oversized = image::DynamicImage::new_rgba8(1025, 1);
        let mut bytes = Cursor::new(Vec::new());
        oversized.write_to(&mut bytes, ImageFormat::Png).unwrap();
        assert!(normalize(bytes.get_ref()).is_none());
    }
    #[tokio::test]
    async fn rejects_local_targets_before_connection() {
        for origin in [
            "https://127.0.0.1",
            "https://[::1]",
            "https://localhost",
            "http://example.com",
            "file:///tmp/icon",
            "https://example.com/private?secret=x",
        ] {
            assert!(fetch(origin).await.is_none());
        }
    }
}

#[cfg(test)]
mod network_tests;
