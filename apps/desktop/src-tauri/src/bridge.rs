pub fn start() -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tauri::async_runtime::handle();
    // Pipe construction requires an entered Tokio reactor.
    let server = runtime.block_on(async { cairn_local_bridge::StatusServer::bind() })?;
    tauri::async_runtime::spawn(async move {
        if let Err(error) = server.run(env!("CARGO_PKG_VERSION")).await {
            eprintln!("Cairn status server stopped: {error}");
        }
    });
    Ok(())
}
