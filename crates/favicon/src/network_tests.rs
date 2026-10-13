//! Local TLS fixtures exercise the real HTTP client without external traffic.
use super::*;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_rustls::{
    TlsAcceptor,
    rustls::{ServerConfig, pki_types::PrivatePkcs8KeyDer},
};

type Requests = Arc<Mutex<Vec<String>>>;

async fn server(
    routes: HashMap<&'static str, Vec<u8>>,
) -> (Client, Url, Requests, tokio::task::JoinHandle<()>) {
    let certificate = rcgen::generate_simple_self_signed(vec!["icons.test".into()]).unwrap();
    let config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![certificate.cert.der().clone()],
            PrivatePkcs8KeyDer::from(certificate.signing_key.serialize_der()).into(),
        )
        .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let origin = Url::parse(&format!("https://icons.test:{}", address.port())).unwrap();
    // The local resolver override exists only in this test module.
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .referer(false)
        .add_root_certificate(reqwest::Certificate::from_der(certificate.cert.der()).unwrap())
        .resolve("icons.test", address)
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let requests: Requests = Arc::default();
    let captured = requests.clone();
    let task = tokio::spawn(async move {
        let acceptor = TlsAcceptor::from(Arc::new(config));
        while let Ok((socket, _)) = listener.accept().await {
            let Ok(mut stream) = acceptor.accept(socket).await else {
                continue;
            };
            let mut request = Vec::new();
            loop {
                let mut chunk = [0; 1024];
                let Ok(length) = stream.read(&mut chunk).await else {
                    break;
                };
                if length == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..length]);
                if request.ends_with(b"\r\n\r\n") || request.len() > 8192 {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&request).to_string();
            let path = text.split_whitespace().nth(1).unwrap_or("/").to_owned();
            captured.lock().unwrap().push(text);
            let response = routes
                .get(path.as_str())
                .cloned()
                .unwrap_or_else(|| response("404 Not Found", &[], b""));
            let _ = stream.write_all(&response).await;
            let _ = stream.shutdown().await;
        }
    });
    (client, origin, requests, task)
}

fn response(status: &str, headers: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(&format!("{name}: {value}\r\n"));
    }
    let mut bytes = response.into_bytes();
    bytes.extend_from_slice(b"\r\n");
    bytes.extend_from_slice(body);
    bytes
}
fn png() -> Vec<u8> {
    let mut output = Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(16, 16)
        .write_to(&mut output, ImageFormat::Png)
        .unwrap();
    output.into_inner()
}
#[tokio::test]
async fn direct_icon_and_html_discovery_without_cookies() {
    let (client, origin, requests, task) = server(HashMap::from([(
        "/favicon.ico",
        response("200 OK", &[], &png()),
    )]))
    .await;
    assert!(fetch_with(&client, &origin).await.is_some());
    assert_eq!(requests.lock().unwrap().len(), 1);
    task.abort();
    let (client, origin, requests, task) = server(HashMap::from([
        ("/", response("200 OK", &[("Set-Cookie", "session=tracking")], br#"<link rel="icon" href="https://third.party/icon"><link rel="icon" href="/logo.png">"#)),
        ("/logo.png", response("200 OK", &[], &png())),
    ])).await;
    assert!(fetch_with(&client, &origin).await.is_some());
    let requests = requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[2].starts_with("GET /logo.png "));
    assert!(
        requests
            .iter()
            .all(|request| !request.to_lowercase().contains("cookie:")
                && !request.to_lowercase().contains("authorization:")
                && !request.to_lowercase().contains("referer:"))
    );
    task.abort();
}
#[tokio::test]
async fn redirect_boundaries_and_missing_icons() {
    let (client, origin, requests, task) = server(HashMap::from([(
        "/favicon.ico",
        response(
            "302 Found",
            &[("Location", "https://127.0.0.1/internal")],
            b"",
        ),
    )]))
    .await;
    assert!(fetch_with(&client, &origin).await.is_none());
    assert_eq!(requests.lock().unwrap().len(), 2); // initial icon, then homepage
    task.abort();
    let (client, origin, requests, task) = server(HashMap::from([
        (
            "/favicon.ico",
            response("302 Found", &[("Location", "/logo.png")], b""),
        ),
        ("/logo.png", response("200 OK", &[], &png())),
    ]))
    .await;
    assert!(fetch_with(&client, &origin).await.is_some());
    assert_eq!(requests.lock().unwrap().len(), 2);
    task.abort();
}
#[tokio::test]
async fn rejects_oversized_content_length_and_chunked_bodies() {
    let oversized = vec![b'x'; MAX_DOWNLOAD + 1];
    let mut chunked = format!(
        "HTTP/1.1 200 OK\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n",
        oversized.len()
    )
    .into_bytes();
    chunked.extend_from_slice(&oversized);
    chunked.extend_from_slice(b"\r\n0\r\n\r\n");
    for body in [response("200 OK", &[], &oversized), chunked] {
        let (client, origin, _, task) = server(HashMap::from([("/favicon.ico", body)])).await;
        assert!(
            download(&client, &origin, origin.join("/favicon.ico").unwrap())
                .await
                .is_none()
        );
        task.abort();
    }
}
