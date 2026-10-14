#![cfg(windows)]

use cairn_protocol::{ErrorCode, MAX_MESSAGE_BYTES, Request, Response, parse_request};
use std::{
    convert::Infallible,
    future::{Future, poll_fn},
    io,
    pin::pin,
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
    /// are answered here and never reach it. Runs until dropped.
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
                if let Poll::Ready(never) = instance.as_mut().poll(cx) {
                    match never {}
                }
            }
            Poll::Pending
        })
        .await
    }
}

/// How long a reused instance waits for its previous client's last read.
const STALE_READ: Duration = Duration::from_millis(500);

/// Waits for the next client on `instance`.
///
/// mio keeps a read going in the background and holds its result until it's
/// read. After a client leaves, that result is the error from its closed pipe,
/// or arrives once `disconnect` fails a read still in flight, and `disconnect`
/// doesn't clear it. A reused instance would hand it to the next client as an
/// immediate end of file. Taking it once the instance listens again makes mio
/// start a fresh read for the new client. mio starts that read only after the
/// stale result is taken, so this can't consume the new client's data.
async fn accept(instance: &NamedPipeServer, reused: bool) -> io::Result<()> {
    let mut connect = pin!(instance.connect());
    // The first poll issues ConnectNamedPipe.
    let connected = poll_fn(|cx| Poll::Ready(connect.as_mut().poll(cx))).await;

    if reused {
        let _ = timeout(STALE_READ, async {
            loop {
                instance.readable().await?;
                // mio's read buffers are 4 KiB, so one read takes all of a result.
                match instance.try_read(&mut [0; 4096]) {
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => continue,
                    _ => return io::Result::Ok(()),
                }
            }
        })
        .await;
    }

    match connected {
        Poll::Ready(result) => result,
        Poll::Pending => connect.await,
    }
}

/// Answers connections on one instance, one at a time. Cairn can't create
/// another instance once the pool is locked, so it reuses this one, and a
/// failing instance retries instead of taking the bridge down until restart.
async fn serve<H, F>(mut instance: NamedPipeServer, handler: H) -> Infallible
where
    H: Fn(Request) -> F,
    F: Future<Output = Response>,
{
    let mut reused = false;
    loop {
        let accepted = accept(&instance, reused).await;
        reused = true;
        match accepted {
            Ok(()) => {
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
            Err(error) => eprintln!("Cairn bridge: connection failed: {error}"),
        }
        if let Err(error) = instance.disconnect() {
            eprintln!("Cairn bridge: cannot reset pipe instance: {error}");
            tokio::time::sleep(Duration::from_millis(250)).await;
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

#[cfg(test)]
mod tests {
    use super::*;
    use cairn_protocol::VERSION;

    // Uses the real per-user pipe name, so run it with Cairn closed. One test,
    // so parallel tests don't race for the name.
    #[tokio::test]
    async fn serves_clients_on_every_instance_again_and_again() {
        let server = BridgeServer::bind().expect("bind the pipe; is Cairn running?");
        // ConnectNamedPipe reports ERROR_NO_DATA for this client, which mio
        // treats as connected. The read then fails and the instance is reset.
        drop(security::open_client(&pipe_name().unwrap()).unwrap());
        tokio::spawn(server.run(|request| async move { Response::status(&request, "1.0.0") }));
        // A client that never asks holds its instance until the server gives up.
        let silent = security::open_client(&pipe_name().unwrap()).unwrap();
        tokio::time::sleep(Duration::from_millis(1700)).await;
        drop(silent);

        // Each instance answers one client at a time, so this reuses every
        // instance several times, with clients that leave without asking.
        for attempt in 0..INSTANCES * 4 {
            if attempt % 5 == 4 {
                drop(security::open_client(&pipe_name().unwrap()).unwrap());
            }
            let request = Request::GetStatus {
                version: VERSION,
                request_id: format!("test-{attempt}"),
            };
            let response = send(&request).await;
            assert_eq!(response, Response::status(&request, "1.0.0"), "request {attempt}");
        }
    }
}
