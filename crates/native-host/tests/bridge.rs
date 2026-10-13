#![cfg(windows)]

use cairn_local_bridge::{BridgeServer, pipe_name};
use cairn_protocol::{Request, Response};
use cairn_protocol::{read_frame, write_frame};
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command, Stdio},
    time::Duration,
};
use tokio::net::windows::named_pipe::ServerOptions;

fn exchange(messages: Vec<Value>) -> Vec<Value> {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cairn-native-host"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for message in &messages {
        write_frame(&mut input, &serde_json::to_vec(message).unwrap()).unwrap();
    }
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut data = &output.stdout[..];
    let mut responses = vec![];
    while let Some(bytes) = read_frame(&mut data).unwrap() {
        responses.push(serde_json::from_slice(&bytes).unwrap());
    }
    assert_eq!(responses.len(), messages.len());
    responses
}

fn request(id: &str) -> Value {
    json!({"version":1,"requestId":id,"type":"GetStatus"})
}

async fn status(request: Request) -> Response {
    Response::status(&request, "0.1.0")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn native_process_and_windows_pipe_lifecycle() {
    // Uses the real, current-user/session endpoint. Run with Cairn closed.
    let unavailable = tokio::task::spawn_blocking(|| exchange(vec![request("absent")]))
        .await
        .unwrap();
    assert_eq!(unavailable[0]["code"], "AppUnavailable");

    let server = BridgeServer::bind().unwrap();
    assert!(
        BridgeServer::bind().is_err(),
        "a second server must not bind"
    );
    let task = tokio::spawn(server.run(status));
    let a = tokio::task::spawn_blocking(|| exchange(vec![request("profile-a"), request("again")]));
    let b = tokio::task::spawn_blocking(|| exchange(vec![request("profile-b")]));
    let (a, b) = tokio::join!(a, b);
    assert_eq!(
        a.unwrap()[0],
        json!({"version":1,"requestId":"profile-a","type":"Status","appVersion":"0.1.0"})
    );
    assert_eq!(b.unwrap()[0]["requestId"], "profile-b");

    let malformed = tokio::task::spawn_blocking(|| {
        exchange(vec![
            json!({"version":1,"requestId":"invalid","type":"Unlock"}),
            json!({"version":2,"requestId":"version","type":"GetStatus"}),
            request("still-alive"),
        ])
    })
    .await
    .unwrap();
    assert_eq!(malformed[0]["code"], "InvalidRequest");
    assert_eq!(malformed[1]["code"], "UnsupportedVersion");
    assert_eq!(malformed[2]["type"], "Status");

    task.abort();
    let _ = task.await;
    let unavailable = tokio::task::spawn_blocking(|| exchange(vec![request("closed")]))
        .await
        .unwrap();
    assert_eq!(unavailable[0]["code"], "AppUnavailable");

    // A connected peer which never responds must not hang the native process.
    let stalled = ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name().unwrap())
        .unwrap();
    let client = tokio::task::spawn_blocking(|| exchange(vec![request("timeout")]));
    stalled.connect().await.unwrap();
    let response = tokio::time::timeout(Duration::from_secs(4), client)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response[0]["code"], "RequestTimeout");
    drop(stalled);

    // Closing the peer during a request becomes a recoverable unavailable error.
    let closing = ServerOptions::new()
        .first_pipe_instance(true)
        .create(pipe_name().unwrap())
        .unwrap();
    let client = tokio::task::spawn_blocking(|| exchange(vec![request("interrupted")]));
    closing.connect().await.unwrap();
    drop(closing);
    assert_eq!(client.await.unwrap()[0]["code"], "AppUnavailable");

    let task = tokio::spawn(BridgeServer::bind().unwrap().run(status));
    assert_eq!(
        tokio::task::spawn_blocking(|| exchange(vec![request("restart")]))
            .await
            .unwrap()[0]["type"],
        "Status"
    );
    task.abort();
    let _ = task.await;
}

#[test]
fn invalid_frames_exit_without_protocol_noise() {
    for frame in [u32::MAX.to_le_bytes().to_vec(), vec![5, 0, 0, 0, b'{']] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_cairn-native-host"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&frame).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
}
