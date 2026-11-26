param(
    [string]$Version,
    [switch]$TestBuild
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root = Resolve-Path "$PSScriptRoot/../../.."
Push-Location $root
try {
    if (!$Version) {
        $metadata = cargo metadata --format-version 1 --no-deps --locked | ConvertFrom-Json
        $Version = ($metadata.packages | Where-Object name -eq 'cairn-desktop-rune').version
    }
    if ($Version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$') {
        throw "Expected a Cairn release version, got '$Version'"
    }
    $env:CAIRN_BUILD_VERSION = $Version
    $target = Join-Path $root 'target'
    $env:CARGO_TARGET_DIR = $target
    pnpm build:connector

    if ($TestBuild) {
        cargo build --locked -p cairn-desktop-rune
        $binary = "$target/debug/cairn-desktop-rune.exe"
        $variant = 'test'
    } else {
        cargo build --locked --release -p cairn-desktop-rune
        $binary = "$target/release/cairn-desktop-rune.exe"
        $variant = 'release'
    }

    $stage = Join-Path $target "rune-installer/$variant/$Version"
    $bundleTarget = Join-Path $stage 'target'
    New-Item -Force -ItemType Directory "$stage/src", "$bundleTarget/release" | Out-Null
    @"
[workspace]
[package]
name = "cairn-desktop"
version = "$Version"
edition = "2024"
"@ | Set-Content "$stage/Cargo.toml"
    'fn main() {}' | Set-Content "$stage/src/main.rs"
    Copy-Item $binary "$bundleTarget/release/cairn-desktop.exe" -Force

    $tauri = Join-Path $root 'apps/desktop/src-tauri'
    $config = Get-Content "$PSScriptRoot/tauri.conf.json" -Raw | ConvertFrom-Json -AsHashtable
    $config.version = $Version
    $config.bundle.icon = @("$tauri/icons/icon.ico")
    $config.bundle.windows.nsis.installerIcon = "$tauri/icons/icon.ico"
    $config.bundle.windows.nsis.installerHooks = "$PSScriptRoot/connector.nsh"
    $config.bundle.resources = @{
        "$target/release/cairn-native-host.exe" = 'cairn-native-host.exe'
        "$target/connector/cairn-native-host.json" = 'cairn-native-host.json'
        "$target/connector/extension/" = 'extension/'
    }
    $config | ConvertTo-Json -Depth 10 | Set-Content "$stage/tauri.conf.json"

    $env:TAURI_APP_PATH = $stage
    $env:TAURI_FRONTEND_PATH = $stage
    $env:CARGO_TARGET_DIR = $bundleTarget
    pnpm --filter @cairn/desktop tauri bundle --ci --no-sign --no-binary-patching
} finally {
    Pop-Location
}
