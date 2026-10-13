#![cfg(windows)]

use cairn_protocol::{ErrorCode, MAX_MESSAGE_BYTES, Request, Response, parse_request};
use std::{future::Future, io, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::windows::named_pipe::{ClientOptions, NamedPipeServer},
    sync::Semaphore,
    time::timeout,
};
mod security;

pub fn pipe_name() -> io::Result<String> {
    let (sid, session) = security::identity()?;
    Ok(format!(r"\\.\pipe\cairn.status.v1.{sid}.{session}"))
}

fn create_server(name: &str, first: bool) -> io::Result<NamedPipeServer> {
    security::create_server(name, first)
}

async fn read_frame(stream: &mut (impl AsyncRead + Unpin)) -> io::Result<Vec<u8>> {
    let size = stream.read_u32_le().await? as usize;
    if size == 0 || size > MAX_MESSAGE_BYTES {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut bytes = vec![0; size];
    stream.read_exact(&mut bytes).await?;
    Ok(bytes)
}

async fn write_frame(stream: &mut (impl AsyncWrite + Unpin), bytes: &[u8]) -> io::Result<()> {
    if bytes.is_empty() || bytes.len() > MAX_MESSAGE_BYTES {
        return Err(io::ErrorKind::InvalidData.into());
    }
    stream.write_u32_le(bytes.len() as u32).await?;
    stream.write_all(bytes).await?;
    stream.flush().await
}

pub struct BridgeServer {
    name: String,
    listener: NamedPipeServer,
}

impl BridgeServer {
    // Must be called inside a Tokio runtime. First-instance creation refuses a
    // competing server instead of joining a pipe owned by another process.
    pub fn bind() -> io::Result<Self> {
        let name = pipe_name()?;
        let listener = create_server(&name, true)?;
        Ok(Self { name, listener })
    }

    /// Answers one request per connection with `handler`. Malformed requests
    /// are answered here and never reach it.
    pub async fn run<H, F>(mut self, handler: H) -> io::Result<()>
    where
        H: Fn(Request) -> F + Clone + Send + Sync + 'static,
        F: Future<Output = Response> + Send,
    {
        let permits = Arc::new(Semaphore::new(16));
        loop {
            let permit = permits
                .clone()
                .acquire_owned()
                .await
                .map_err(io::Error::other)?;
            self.listener.connect().await?;
            // Keep an instance alive while creating the next listener.
            let next = create_server(&self.name, false)?;
            let mut connection = std::mem::replace(&mut self.listener, next);
            let handler = handler.clone();
            tokio::spawn(async move {
                let _permit = permit;
                let _ = timeout(Duration::from_millis(1500), async {
                    let bytes = read_frame(&mut connection).await?;
                    let response = match parse_request(&bytes) {
                        Ok(request) => handler(request).await,
                        Err(response) => response,
                    };
                    write_frame(&mut connection, &serde_json::to_vec(&response)?).await
                })
                .await;
            });
        }
    }
}

/// Forwards one request to the desktop app and checks that the reply answers it.
pub async fn send(request: &Request) -> Response {
    let response = timeout(Duration::from_millis(1500), async {
        let name = pipe_name().map_err(|_| ErrorCode::AppUnavailable)?;
        let mut stream = loop {
            match ClientOptions::new().open(&name) {
                Ok(stream) => break stream,
                Err(error) if error.raw_os_error() == Some(231) => {
                    tokio::time::sleep(Duration::from_millis(20)).await
                }
                Err(_) => return Err(ErrorCode::AppUnavailable),
            }
        };
        let bytes = serde_json::to_vec(request).map_err(|_| ErrorCode::InvalidRequest)?;
        write_frame(&mut stream, &bytes)
            .await
            .map_err(|_| ErrorCode::AppUnavailable)?;
        let bytes = read_frame(&mut stream)
            .await
            .map_err(|_| ErrorCode::AppUnavailable)?;
        let response: Response =
            serde_json::from_slice(&bytes).map_err(|_| ErrorCode::ProtocolMismatch)?;
        if !response.matches(request) {
            return Err(ErrorCode::ProtocolMismatch);
        }
        Ok(response)
    })
    .await;
    match response {
        Ok(Ok(response)) => response,
        Ok(Err(code)) => Response::error(Some(request.id().into()), code),
        Err(_) => Response::error(Some(request.id().into()), ErrorCode::RequestTimeout),
    }
}
