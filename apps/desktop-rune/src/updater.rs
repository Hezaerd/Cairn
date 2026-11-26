use std::{
    collections::HashMap,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};
use reqwest::{Client, Url};
use semver::Version;
use serde::Deserialize;

const PUBLIC_KEY: &str = include_str!("../packaging/updater.pub");
const VERSION: &str = env!("CAIRN_VERSION");
const MAX_FEED_BYTES: usize = 64 * 1024;
const MAX_INSTALLER_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Channel {
    Stable,
    Nightly,
}

impl Channel {
    fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => "https://github.com/Hezaerd/Cairn/releases/latest/download/latest.json",
            Self::Nightly => {
                "https://github.com/Hezaerd/Cairn/releases/download/nightly/latest.json"
            }
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Nightly => "nightly",
        }
    }

    fn load(file: &Path) -> Self {
        match std::fs::read_to_string(file).as_deref().map(str::trim) {
            Ok("stable") => Self::Stable,
            Ok("nightly") => Self::Nightly,
            _ if VERSION.contains('-') => Self::Nightly,
            _ => Self::Stable,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpdateStatus {
    pub version: &'static str,
    pub channel: Channel,
    pub enabled: bool,
    pub available: Option<Version>,
}

#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    #[error("another update operation is running")]
    Busy,
    #[error("updates are disabled")]
    Disabled,
    #[error("could not save the update channel")]
    SaveChannel,
    #[error("could not read the release feed")]
    Check,
    #[error("no update is available")]
    NoUpdate,
    #[error("could not download the update")]
    Download,
    #[error("the update signature or signed version is invalid")]
    InvalidSignature,
    #[error("could not launch the update installer")]
    Install,
}

#[derive(Deserialize)]
struct Feed {
    version: Version,
    platforms: HashMap<String, Asset>,
}

#[derive(Clone, Deserialize)]
struct Asset {
    url: Url,
    signature: String,
}

#[derive(Clone)]
struct Release {
    version: Version,
    asset: Asset,
}

struct State {
    channel: Channel,
    pending: Option<Release>,
}

struct Source {
    #[cfg(debug_assertions)]
    test_feed: Option<(Url, String)>,
}

impl Source {
    fn load() -> Self {
        Self {
            #[cfg(debug_assertions)]
            test_feed: std::env::var("CAIRN_TEST_UPDATE_FEED")
                .ok()
                .and_then(|value| Url::parse(&value).ok())
                .filter(is_loopback_feed)
                .zip(std::env::var("CAIRN_TEST_UPDATE_PUBKEY").ok()),
        }
    }

    fn enabled(&self) -> bool {
        #[cfg(debug_assertions)]
        return cfg!(windows) && self.test_feed.is_some();
        #[cfg(not(debug_assertions))]
        cfg!(windows)
    }

    fn endpoint(&self, channel: Channel) -> Result<Url, UpdateError> {
        #[cfg(debug_assertions)]
        if let Some((url, _)) = &self.test_feed {
            return Ok(url.clone());
        }
        Url::parse(channel.endpoint()).map_err(|_| UpdateError::Check)
    }

    fn public_key(&self) -> &str {
        #[cfg(debug_assertions)]
        if let Some((_, key)) = &self.test_feed {
            return key;
        }
        PUBLIC_KEY
    }

    fn client(&self) -> Result<Client, reqwest::Error> {
        let builder = Client::builder().timeout(Duration::from_secs(120));
        #[cfg(debug_assertions)]
        if self.test_feed.is_some() {
            return builder
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build();
        }
        builder.https_only(true).build()
    }

    fn allows_asset(&self, url: &Url) -> bool {
        #[cfg(debug_assertions)]
        if let Some((endpoint, _)) = &self.test_feed {
            return url.origin() == endpoint.origin();
        }
        url.scheme() == "https"
    }
}

#[cfg(debug_assertions)]
fn is_loopback_feed(url: &Url) -> bool {
    url.scheme() == "http" && url.host_str() == Some("127.0.0.1")
}

/// Keep one instance per app. Run network operations on the app runtime.
pub struct Updates {
    file: PathBuf,
    source: Source,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
}

impl Updates {
    pub fn load(directory: &Path) -> Self {
        let file = directory.join("update-channel");
        let channel = Channel::load(&file);
        Self {
            file,
            source: Source::load(),
            state: Mutex::new(State {
                channel,
                pending: None,
            }),
            operation: tokio::sync::Mutex::new(()),
        }
    }

    pub fn status(&self) -> UpdateStatus {
        let state = self.state.lock().unwrap();
        UpdateStatus {
            version: VERSION,
            channel: state.channel,
            enabled: self.source.enabled(),
            available: state
                .pending
                .as_ref()
                .map(|release| release.version.clone()),
        }
    }

    pub fn set_channel(&self, channel: Channel) -> Result<(), UpdateError> {
        let _operation = self.operation.try_lock().map_err(|_| UpdateError::Busy)?;
        let directory = self.file.parent().unwrap();
        let save = || -> io::Result<()> {
            std::fs::create_dir_all(directory)?;
            let mut file = tempfile::NamedTempFile::new_in(directory)?;
            file.write_all(channel.name().as_bytes())?;
            file.as_file().sync_all()?;
            file.persist(&self.file)?;
            Ok(())
        };
        save().map_err(|_| UpdateError::SaveChannel)?;
        *self.state.lock().unwrap() = State {
            channel,
            pending: None,
        };
        Ok(())
    }

    pub async fn check(&self) -> Result<Option<Version>, UpdateError> {
        let _operation = self.operation.try_lock().map_err(|_| UpdateError::Busy)?;
        if !self.source.enabled() {
            return Err(UpdateError::Disabled);
        }
        let endpoint = self.source.endpoint(self.status().channel)?;
        let client = self.source.client().map_err(|_| UpdateError::Check)?;
        let response = client
            .get(endpoint)
            .send()
            .await
            .map_err(|_| UpdateError::Check)?;
        let pending = if response.status() == reqwest::StatusCode::NO_CONTENT {
            None
        } else {
            let bytes = read_response(response, MAX_FEED_BYTES)
                .await
                .ok_or(UpdateError::Check)?;
            let feed: Feed = serde_json::from_slice(&bytes).map_err(|_| UpdateError::Check)?;
            let current = Version::parse(VERSION).map_err(|_| UpdateError::Check)?;
            if feed.version.cmp_precedence(&current).is_gt() {
                let target = format!("windows-{}", std::env::consts::ARCH);
                let asset = feed
                    .platforms
                    .get(&format!("{target}-nsis"))
                    .or_else(|| feed.platforms.get(&target))
                    .filter(|asset| self.source.allows_asset(&asset.url))
                    .ok_or(UpdateError::Check)?;
                Some(Release {
                    version: feed.version,
                    asset: asset.clone(),
                })
            } else {
                None
            }
        };
        let version = pending.as_ref().map(|release| release.version.clone());
        self.state.lock().unwrap().pending = pending;
        Ok(version)
    }

    /// Launches the verified installer. Quit Cairn after this returns successfully.
    pub async fn install(&self) -> Result<(), UpdateError> {
        let _operation = self.operation.try_lock().map_err(|_| UpdateError::Busy)?;
        if !self.source.enabled() {
            return Err(UpdateError::Disabled);
        }
        let release = self
            .state
            .lock()
            .unwrap()
            .pending
            .clone()
            .ok_or(UpdateError::NoUpdate)?;
        let client = self.source.client().map_err(|_| UpdateError::Download)?;
        let response = client
            .get(release.asset.url)
            .send()
            .await
            .map_err(|_| UpdateError::Download)?;
        let bytes = read_response(response, MAX_INSTALLER_BYTES)
            .await
            .ok_or(UpdateError::Download)?;
        verify(
            &bytes,
            self.source.public_key(),
            &release.asset.signature,
            &release.version,
        )?;
        launch_installer(&bytes).map_err(|_| UpdateError::Install)?;
        self.state.lock().unwrap().pending = None;
        Ok(())
    }
}

async fn read_response(mut response: reqwest::Response, limit: usize) -> Option<Vec<u8>> {
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size > limit as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if chunk.len() > limit - bytes.len() {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

fn verify(bytes: &[u8], key: &str, signature: &str, version: &Version) -> Result<(), UpdateError> {
    let decode = |value: &str| {
        STANDARD
            .decode(value.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .ok_or(UpdateError::InvalidSignature)
    };
    let key = PublicKey::decode(&decode(key)?).map_err(|_| UpdateError::InvalidSignature)?;
    let signature =
        Signature::decode(&decode(signature)?).map_err(|_| UpdateError::InvalidSignature)?;
    key.verify(bytes, &signature, false)
        .map_err(|_| UpdateError::InvalidSignature)?;
    let signed_version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|field| field.strip_prefix("version:"))
        .and_then(|version| Version::parse(version).ok());
    if signed_version.as_ref() != Some(version) {
        return Err(UpdateError::InvalidSignature);
    }
    Ok(())
}

#[cfg(windows)]
fn launch_installer(bytes: &[u8]) -> io::Result<()> {
    let mut installer = tempfile::Builder::new()
        .prefix("cairn-update-")
        .suffix(".exe")
        .tempfile()?;
    installer.write_all(bytes)?;
    let (file, path) = installer.keep()?;
    drop(file);
    if let Err(error) = std::process::Command::new(&path)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
    {
        let _ = std::fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

#[cfg(not(windows))]
fn launch_installer(_: &[u8]) -> io::Result<()> {
    Err(io::ErrorKind::Unsupported.into())
}
