# Cairn

Windows desktop app and Chromium extension for a personal password manager.
The desktop creates and unlocks an encrypted local vault, adds credentials,
and reveals a selected password and its notes on request. Helium connects to
the running app through a local `GetStatus` exchange. The extension does not
have access to vault entries; pairing and autofill are not implemented.

## Stack

- pnpm workspace with a shared lockfile
- Desktop: Tauri 2, Rust, React, TypeScript, Vite
- Extension: Chromium Manifest V3, React, TypeScript, Vite
- Effect 4 services, scoped native connections, typed errors, and Schema validation
- TanStack Router with typed file routes in both apps
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

## Routing

Each app owns its router in `src/router.ts` and its pages in `src/routes`.
`__root.tsx` provides the shared outlet and not-found page; `index.tsx` renders
the existing home screen. Add new route files here and use TanStack's `Link`
or `useNavigate` for typed navigation.

The desktop uses hash history, so URLs such as `/#/settings` keep navigation
inside the Tauri document, including on reload. The popup uses memory history:
opening it starts at `/`, without changing `index.html` or the service worker's
sender URL check. Navigation state is not persisted when the popup closes.

The Vite plugin generates `src/routeTree.gen.ts` and splits route components
into lazy-loaded chunks. Build and typecheck scripts also run `tsr generate`
before TypeScript, so they work without a running dev server. The generated
trees are committed and excluded from lint/format; do not edit them manually.
Run `pnpm --filter @cairn/desktop routes:generate` or the equivalent extension
command to regenerate them explicitly.

## Local vault

Launch `pnpm dev:desktop` and create a vault with a master password of at least
12 characters. Add a name, site, username, password, and optional notes. Lock
the vault, close the app, then reopen and unlock it to retrieve the entry.
Passwords and notes are only sent to the UI on explicit reveal and hidden
again after 30 seconds. The list contains names, sites, and usernames only.
The backend locks after five minutes without a vault operation; the desktop
clears its list, secret display, and entry form when notified. Typing alone
does not extend this deadline. Editing/deleting entries, changing the master
password, Windows Hello, synchronization, and recovery keys are not implemented.

The Rust backend uses Tauri's `app_local_data_dir()` and the current app ID:

```text
%LOCALAPPDATA%\com.hezaerd.cairn\
  vault.cairn
  vault.lock
  backups\previous.cairn
```

`vault.cairn` is a versioned JSON envelope containing only public cryptographic
parameters, a wrapped key, nonces, and ciphertext. Names, sites, usernames,
passwords, and notes are inside the encrypted payload. The master password
and unwrapped keys are not persisted. No credential is written to browser
storage or logs. This directory inherits the Windows user's filesystem access
permissions; the lock file is an OS writer lock, not an encryption key.
The desktop WebView runs in private mode with general form autofill disabled.

Version 1 uses RustCrypto Argon2id v19 with 64 MiB of memory, one lane, and 3–10
passes calibrated at creation toward roughly 500 ms. Bounds are checked before
processing an untrusted file. A random 16-byte salt derives the wrapping key;
a separate random 32-byte key encrypts the vault with XChaCha20-Poly1305.
Wrapping and payload encryption use separate random 24-byte nonces and
domain-separated authenticated header data. Every save uses a fresh payload
nonce. The maximum file size is 16 MiB, serialized plaintext 4 MiB, and entry
count 10,000; individual field lengths are also checked in Rust.

Writes use a same-directory temporary ciphertext file, flush it, and atomically
replace the destination. Creation refuses to overwrite any existing vault.
Before each replacement, `backups/previous.cairn` receives the previous complete
encrypted version. A failed save locks the session so the next unlock reloads
the actual disk state. External modifications are detected before saving.
Interrupted temporary files contain ciphertext only. Filesystem/hardware
durability after power loss is not guaranteed by the application.

For recovery, close Cairn, retain a copy of the damaged file, and copy
`backups/previous.cairn` to `vault.cairn`. This loses the latest successful
change. A backup on the same drive does not protect against drive loss; keep
separate copies of the encrypted vault. There is no password reset: losing the
master password means losing access to both the vault and its backups.
If only the backup survives, Cairn presents recovery instructions and refuses
to create a new vault over it.

Keys, entries, secret command results, the serialization buffer, and the Argon2
work area use zeroization when released. JavaScript, IPC, allocator/library
copies, the pagefile, and crash dumps prevent a guarantee that every plaintext
copy is erased. Encryption at rest does not protect an unlocked app from
malware running as the same Windows user. This implementation has not received
an independent security audit.

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

The isolated native vault test uses the real Tauri app, WebView2, Rust commands,
and filesystem. Close Cairn first, then run:

```sh
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:vault
```

It creates synthetic credentials and a WebView2 profile under `.local`, checks
creation, reveal/hide, lock, incorrect passwords, process restart, encrypted
disk contents, and corrupted-file handling. Only debug builds honor its
`CAIRN_TEST_DATA_DIR` environment override; release builds always use the normal
application directory. The test's CDP debugging flag applies only to its child
process. Neither the personal vault nor browser profiles are opened.

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
- `crates/vault`: encrypted format, key derivation, session state, atomic storage,
  and persistence/security tests, independent of Tauri.
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
