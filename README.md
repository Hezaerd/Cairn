# Cairn

Windows desktop app and Chromium extension for a personal password manager.
The first milestone connects Helium to the running Tauri app through a local
`GetStatus` exchange. No vault, passwords, pairing, or autofill are implemented.

## Stack

- pnpm workspace with a shared lockfile
- Desktop: Tauri 2, Rust, React, TypeScript, Vite
- Extension: Chromium Manifest V3, React, TypeScript, Vite
- Effect 4 services, scoped native connections, typed errors, and Schema validation
- Cargo workspace for the app, protocol, Windows pipe transport, and native host

## Prerequisites

Node.js 24+, pnpm 12.6.0, Rust stable through rustup (MSVC on Windows),
Visual Studio C++ build tools with a Windows SDK, and Microsoft Edge WebView2.
See https://v2.tauri.app/start/prerequisites/.
After installing Rust, open a new terminal so Cargo is on PATH.

## Development

```sh
pnpm install
pnpm build:host
pnpm dev:desktop
```

In a separate terminal, build the extension and watch for changes:

```sh
pnpm dev:extension
```

Open `chrome://extensions` in Helium, enable Developer mode, choose Load unpacked,
and select `apps/extension/dist`. Reload the extension after rebuilding it.
Copy its extension ID and register the native host from the repository root:

```powershell
.\scripts\register-native-host.ps1 -ExtensionId '<32-letter extension ID>'
```

Reload the extension and open its popup. It shows `Cairn connecté` when the app
responds and `Cairn indisponible` when the app is closed. Use `Actualiser` or
`Réessayer` to request the latest state; there is no background polling.
An absent/forbidden native host instead shows `Connecteur à installer`.

The extension only requests `nativeMessaging`, with no website permissions.
Load it in each Helium profile you want to test. Register any different extension
ID using the same command; existing origins are preserved. Closing the Tauri
window closes the app and its server. A second app launch focuses the existing one.

The registration is per Windows user and does not require administrator rights.
It writes `.local/native-host.json` and the default value of
`HKCU\Software\Chromium\NativeMessagingHosts\com.hezaerd.cairn` in both registry
views. Helium's Windows native host lookup supports this Chromium key. The script
refuses to replace another installation. For a release host, pass its absolute
path with `-BinaryPath`.

Remove this checkout's registration with:

```powershell
.\scripts\unregister-native-host.ps1
```

After moving the repository, unregister it from its old location first, then
register it at the new location. The registration contains absolute paths.

## Verification and builds

Oxlint and Oxfmt are configured once at the workspace root for both TypeScript
apps, shared packages, and tests. Their generated defaults are retained, with
anti-slop's generic and Effect rules enabled as errors. Vendored and generated
files are excluded; Cargo files remain outside Oxfmt's scope.

```sh
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm check
```

The apps also expose these lint and format scripts individually, for example
`pnpm --filter @cairn/extension lint`. `pnpm check` runs lint, formatting checks,
TypeScript checks, and Cargo checks without modifying files.

Anti-slop is vendored in `tools/oxlint/anti-slop`, with its revision recorded in
[UPSTREAM.md](tools/oxlint/anti-slop/UPSTREAM.md). Its Effect service-import rule
currently checks relative imports only, so workspace aliases such as
`@cairn/client` are not covered by that rule.

```sh
pnpm typecheck
pnpm build
pnpm check:rust
pnpm test
pnpm build:desktop
```

`pnpm build` builds the frontend and extension. `pnpm build:desktop` also compiles
the native app and creates Windows bundles under `target/release/bundle`.
Native host installation is currently a manual development step, not part of the
desktop installer. `pnpm build:host` builds that executable separately.

Run `pnpm test` with Cairn closed. The Rust integration test owns the current
user/session status endpoint and launches the real native host subprocess.
TypeScript tests cover shared protocol fixtures, transport errors, cancellation,
deadline handling, resource cleanup, and independent connection scopes.

For the full browser test on Windows:

```sh
pnpm build
pnpm build:host
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:helium
```

Close Cairn and unregister this checkout's host first. The test uses the installed
Helium executable, creates isolated profiles under `.local`, temporarily registers
the host, and removes its registration on completion. It checks missing-host and
app-absent states, the actual Tauri connection, two browser profiles, service
worker termination, and app closure. Personal Helium profiles are never opened.
Set `CAIRN_HELIUM_PATH` if Helium is installed in a nonstandard location.

## Layout

- `apps/desktop`: Tauri application, React frontend, status server startup.
- `apps/extension`: popup and service worker; only messages from its own popup
  are accepted.
- `packages/contracts`: Effect Schema wire contracts and typed client errors.
- `packages/client`: Effect services and the Chromium Native Messaging adapter.
- `crates/protocol`: Serde contracts, request validation, bounded binary framing.
- `crates/local-bridge`: Windows named pipe server/client and access control.
- `crates/native-host`: standard input/output Native Messaging relay.
- `scripts`: reversible development registration.
- `tests`: shared fixtures, TypeScript tests, and Helium integration test.

## Protocol and boundaries

Requests have `version: 1`, a 1–64 character ASCII request ID, and
`type: "GetStatus"`. Replies echo the ID with `type: "Status"` and `appVersion`,
or `type: "Error"` and a code. Unknown fields, operations, and versions are
rejected. An invalid request without a usable ID receives an error with a null ID.

Both stdio and pipe messages use UTF-8 JSON prefixed by a four-byte little-endian
length, limited to 16 KiB before allocating the payload. The host reserves stdout
for this protocol. Its pipe round trip has a 1.5-second deadline; the extension
has a two-second deadline. Each popup request owns a scoped native connection.
No connection, response, or credential is persisted in browser storage.

The app is the only pipe server. Its endpoint includes the Windows user SID and
session ID, rejects remote clients, and has a protected DACL granting access only
to the current user. It limits concurrent handlers to 16 and times out idle peers.
The server accepts only `GetStatus`; the native host validates the reply and ID.

These controls do not authenticate peers against other software running as the
same Windows user. Native Messaging's origin allowlist is not profile pairing.
Do not extend this endpoint to expose secrets before implementing pairing,
authenticated sessions, and operation-specific authorization.
