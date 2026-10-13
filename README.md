# Cairn

Cairn is a personal password manager for Windows. It has a desktop app and an extension for Helium and other Chromium browsers.

The desktop app creates and unlocks an encrypted local vault. You can add, edit, and delete credentials, and reveal a password and its notes when you need them. The extension connects to the running app and shows whether it is available. It can't read vault entries yet, and pairing and autofill aren't built.

## Quick start

You need Windows, Node.js 24+, pnpm 12.6, Rust through rustup, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install
pnpm build:host
pnpm dev:desktop
```

To load the extension in Helium and connect it to the app, follow [Development](docs/development.md#browser-extension).

## Commands

| Command              | What it does                                         |
| -------------------- | ---------------------------------------------------- |
| `pnpm dev:desktop`   | Runs the desktop app with hot reload                 |
| `pnpm dev:extension` | Rebuilds the extension into `apps/extension/dist`    |
| `pnpm check`         | Lint, format check, TypeScript and Cargo checks      |
| `pnpm test`          | TypeScript and Rust tests. Close Cairn first         |
| `pnpm build:desktop` | Builds the NSIS installer in `target/release/bundle` |

## Layout

| Path                  | Contents                                                   |
| --------------------- | ---------------------------------------------------------- |
| `apps/desktop`        | Tauri app with its React frontend                          |
| `apps/extension`      | Manifest V3 popup and service worker                       |
| `packages/contracts`  | Effect Schema wire contracts and client errors             |
| `packages/client`     | Effect services and the Native Messaging adapter           |
| `crates/vault`        | Vault format, encryption, sessions and storage             |
| `crates/favicon`      | Site icon downloads and their encrypted cache              |
| `crates/protocol`     | Shared request types and message framing                   |
| `crates/local-bridge` | Windows named pipe between the app and the host            |
| `crates/native-host`  | Native Messaging host the browser launches                 |
| `scripts`             | Native host registration for development                   |
| `tests`               | TypeScript tests and the Helium and vault end-to-end tests |

## Documentation

[Development](docs/development.md) · [Vault](docs/vault.md) · [Browser bridge](docs/browser-bridge.md)

Cairn hasn't had an independent security audit.
