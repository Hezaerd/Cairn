#![cfg(windows)]

use cairn_protocol::{ErrorCode, MAX_MESSAGE_BYTES, Request, Response, parse_request};
use std::{
    future::{Future, poll_fn},
    io,
    task::Poll,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::windows::named_pipe::NamedPipeServer,
    time::timeout,
};
mod security;

/// Pipe instances, and so requests answered at once.
const INSTANCES: usize = 16;

pub fn pipe_name() -> io::Result<String> {
    let (sid, session) = security::identity()?;
    Ok(format!(r"\\.\pipe\cairn.status.v1.{sid}.{session}"))
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
    instances: Vec<NamedPipeServer>,
}

impl BridgeServer {
    // Must be called inside a Tokio runtime. Fails if another process holds
    // the pipe name instead of sharing a pipe with it.
    pub fn bind() -> io::Result<Self> {
        let instances = security::create_pool(&pipe_name()?, INSTANCES)?;
        Ok(Self { instances })
    }

    /// Answers one request per connection with `handler`. Malformed requests
    /// are answered here and never reach it. Returns only on a pipe error.
    pub async fn run<H, F>(self, handler: H) -> io::Result<()>
    where
        H: Fn(Request) -> F + Clone + Send + Sync + 'static,
        F: Future<Output = Response> + Send,
    {
        // The instances stay in this future, so dropping it closes the pipe.
        let mut instances: Vec<_> = self
            .instances
            .into_iter()
            .map(|instance| Box::pin(serve(instance, handler.clone())))
            .collect();
        poll_fn(|cx| {
            for instance in &mut instances {
                if let Poll::Ready(error) = instance.as_mut().poll(cx) {
                    return Poll::Ready(Err(error));
                }
            }
            Poll::Pending
        })
        .await
    }
}

/// Answers connections on one instance, one at a time, until the pipe fails.
async fn serve<H, F>(mut instance: NamedPipeServer, handler: H) -> io::Error
where
    H: Fn(Request) -> F,
    F: Future<Output = Response>,
{
    loop {
        if instance.connect().await.is_ok() {
            let _ = timeout(Duration::from_millis(1500), async {
                let bytes = read_frame(&mut instance).await?;
                let response = match parse_request(&bytes) {
                    Ok(request) => handler(request).await,
                    Err(response) => response,
                };
                write_frame(&mut instance, &serde_json::to_vec(&response)?).await?;
                // Disconnecting discards unread data, so wait for the client
                // to read the reply and close its end.
                instance.read(&mut [0; 1]).await
            })
            .await;
        }
        if let Err(error) = instance.disconnect() {
            return error;
        }
    }
}

/// Forwards one request to the desktop app and checks that the reply answers
/// it. A pipe served by anything but Cairn counts as Cairn being unavailable.
pub async fn send(request: &Request) -> Response {
    let response = timeout(Duration::from_millis(1500), async {
        let name = pipe_name().map_err(|_| ErrorCode::AppUnavailable)?;
        let mut stream = loop {
            match security::open_client(&name) {
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
