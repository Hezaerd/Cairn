use cairn_protocol::{parse_request, read_frame, write_frame};
use std::io;

fn main() {
    if let Err(error) = run() {
        eprintln!("Cairn native host: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    while let Some(bytes) = read_frame(&mut input)? {
        let response = match parse_request(&bytes) {
            Ok(request) => runtime.block_on(cairn_local_bridge::send(&request)),
            Err(response) => response,
        };
        write_frame(&mut output, &serde_json::to_vec(&response)?)?;
    }
    Ok(())
}
