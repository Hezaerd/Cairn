$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$nightly = Get-Content .local/tauri-nightly/latest.json -Raw | ConvertFrom-Json
$core = [version]($nightly.version -replace '-.*$', '')
$first = "$($core.Major).$($core.Minor).$($core.Build + 1)-nightly.1"
$second = "$($core.Major).$($core.Minor).$($core.Build + 1)-nightly.2"

pwsh -NoProfile -File "$PSScriptRoot/build.ps1" -Version $first -TestBuild
pwsh -NoProfile -File "$PSScriptRoot/build.ps1" -Version $second

$key = Join-Path (Resolve-Path .local) 'rune-test.key'
pnpm --filter @cairn/installer exec tauri signer generate --ci --force --password 'test-fixture' --write-keys $key
$installer = Resolve-Path "target/rune-installer/release/$second/target/release/bundle/nsis/Cairn_${second}_x64-setup.exe"
pnpm --filter @cairn/installer exec tauri signer sign --password 'test-fixture' --private-key-path $key --app-version $second "$installer"

@{
    tauri = $nightly.version
    first = $first
    second = $second
} | ConvertTo-Json | Set-Content .local/rune-test-versions.json
