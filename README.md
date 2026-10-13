# Cairn

Windows desktop app and Chromium extension scaffold for a personal password manager.
No vault, password storage, browser integration, or autofill is implemented yet.

## Stack

- pnpm workspace with a shared lockfile
- Desktop: Tauri 2, Rust, React, TypeScript, Vite
- Extension: Chromium Manifest V3, React, TypeScript, Vite
- Effect 4 installed in both apps for future TypeScript services
- Cargo workspace with the desktop crate

## Prerequisites

Node.js 24+, pnpm 12.6.0, Rust stable through rustup (MSVC on Windows),
Visual Studio C++ build tools with a Windows SDK, and Microsoft Edge WebView2.
See https://v2.tauri.app/start/prerequisites/.
After installing Rust, open a new terminal so Cargo is on PATH.

## Development

```sh
pnpm install
pnpm dev:desktop
```

In a separate terminal, build the extension and watch for changes:

```sh
pnpm dev:extension
```

Open `chrome://extensions` in Helium, enable Developer mode, choose Load unpacked,
and select `apps/extension/dist`. Reload the extension after rebuilding it.
The extension currently requests no permissions and only displays a popup.

## Verification and builds

```sh
pnpm typecheck
pnpm build
pnpm check:rust
pnpm build:desktop
```

`pnpm build` builds the frontend and extension. `pnpm build:desktop` also compiles
the native app and creates Windows bundles under `target/release/bundle`.

## Layout

`apps/desktop` owns the Tauri application and its React frontend.
`apps/extension` owns the popup and empty background entry point.
Shared packages and additional Rust crates will be introduced with their first
implementation rather than populated with placeholders.
