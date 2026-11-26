#![cfg(windows)]

use tauri_plugin_updater::UpdaterExt;

#[test]
#[ignore = "installs over Cairn on a disposable Windows runner"]
fn tauri_installs_rune_update() -> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(std::env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    assert_eq!(
        std::env::var("RUNNER_ENVIRONMENT").as_deref(),
        Ok("github-hosted")
    );
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    context.package_info_mut().name = "Cairn".into();
    context.package_info_mut().version = std::env::var("CAIRN_TEST_TAURI_VERSION")?.parse()?;
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": std::env::var("CAIRN_TEST_UPDATE_PUBKEY")?,
            "dangerousInsecureTransportProtocol": true,
            "windows": { "installMode": "passive" }
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)?;
    let endpoint: tauri::Url = std::env::var("CAIRN_TEST_UPDATE_FEED")?.parse()?;
    assert_eq!(endpoint.host_str(), Some("127.0.0.1"));
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])?
        .restart_after_install(false)
        .build()?;
    tauri::async_runtime::block_on(async {
        let update = updater
            .check()
            .await?
            .expect("Rune update offered to Tauri");
        eprintln!("Tauri selected Rune {}", update.version);
        let bytes = update.download(|_, _| {}, || {}).await?;
        eprintln!("Tauri verified the Rune installer signature");
        update.install(bytes)?;
        Ok(())
    })
}
