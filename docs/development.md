# Development

## Prerequisites

- Node.js 24+ and pnpm 12.6.0
- Rust stable through rustup, with the MSVC toolchain
- Visual Studio C++ build tools with a Windows SDK
- Microsoft Edge WebView2

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/). Open a new terminal after installing Rust so Cargo is on `PATH`.

## Desktop app

```sh
pnpm install
pnpm build:host
pnpm dev:desktop
```

Create a vault with a master password of at least 12 characters. Closing the window quits the app and its status server. Launching it a second time focuses the open window.

The UI uses shadcn/ui components in `apps/desktop/src/components/ui`, with Tailwind CSS 4 and the Windows-style tokens in `apps/desktop/src/App.css`. Add a component with:

```sh
pnpm dlx shadcn@latest add <component> -c apps/desktop
```

## Browser extension

Build the extension and watch for changes:

```sh
pnpm dev:extension
```

1. Open `chrome://extensions` in Helium and turn on Developer mode.
2. Choose Load unpacked and select `apps/extension/dist`.
3. Copy the extension ID and register the native host from the repository root:

   ```powershell
   .\scripts\register-native-host.ps1 -ExtensionId '<32-letter extension ID>'
   ```

4. Reload the extension and open its popup.

The popup shows `Cairn connecté` when the app answers, `Cairn indisponible` when it is closed, and `Connecteur à installer` when the native host is missing or refused. It only asks for status when you open it or press `Actualiser` or `Réessayer`. Reload the extension after each rebuild.

Load the extension in each Helium profile you want to test. Running the script again with another extension ID keeps the IDs already registered.

The registration applies to the current Windows user and needs no administrator rights. It writes `.local/native-host.json` and sets `HKCU\Software\Chromium\NativeMessagingHosts\com.hezaerd.cairn` in both registry views. The script refuses to replace another installation. Pass `-BinaryPath` with an absolute path to register a release host.

The registration stores absolute paths. Before moving the checkout, unregister it:

```powershell
.\scripts\unregister-native-host.ps1
```

The desktop installer doesn't register the host yet.

## Routing

Each app has its router in `src/router.ts` and its pages in `src/routes`. Navigate with TanStack's `Link` or `useNavigate`.

- The desktop uses hash history, so a URL such as `/#/settings` survives a reload inside Tauri.
- The popup uses memory history and always opens on `/`. Its navigation is lost when it closes.

The Vite plugin generates `src/routeTree.gen.ts`, and the build and typecheck scripts run `tsr generate` first. The generated trees are committed. Don't edit them by hand. To regenerate one, run `pnpm --filter @cairn/desktop routes:generate` or the extension's equivalent.

## Checks

```sh
pnpm check        # lint, format check, typecheck, cargo check
pnpm lint:fix
pnpm format
```

Oxlint and Oxfmt are configured once at the root for every TypeScript package. Anti-slop's generic and Effect rules run as errors. It is vendored in `tools/oxlint/anti-slop`, with its revision in [UPSTREAM.md](../tools/oxlint/anti-slop/UPSTREAM.md). Its Effect service-import rule only checks relative imports, so it misses aliases such as `@cairn/client`.

## Tests

```sh
pnpm test
```

Close Cairn first. The Rust integration test takes the user's status endpoint and launches the real native host. The TypeScript tests cover the shared protocol fixtures, transport errors, cancellation, deadlines, and connection cleanup. `cargo test -p cairn-favicon` runs the icon downloads against local TLS fixtures.

### Vault end-to-end

This test drives the real Tauri app, WebView2, and filesystem with synthetic credentials. Close Cairn, then run:

```sh
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:vault
```

It covers creation, reveal and hide, locking, wrong passwords, restarts, encrypted disk contents, and corrupted files. Its data and WebView2 profile live under `.local`. Only debug builds read the `CAIRN_TEST_DATA_DIR` override, so the test never opens your own vault.

It uses no network by default. To also check live favicons, set `$env:CAIRN_TEST_FAVICON_SITE = 'https://www.google.com'` in PowerShell before running it, and remove the variable afterwards.

### Helium end-to-end

Close Cairn and unregister this checkout's host first. Then run:

```sh
pnpm build
pnpm build:host
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:helium
```

The test creates isolated Helium profiles under `.local` and registers the host only for its run. It checks a missing host, a closed app, a live connection, two profiles, service worker restarts, and the app closing. Set `CAIRN_HELIUM_PATH` if Helium isn't in its default location.

## Builds

| Command              | Output                                                    |
| -------------------- | --------------------------------------------------------- |
| `pnpm build`         | Desktop frontend and extension                            |
| `pnpm build:desktop` | Native app and Windows bundles in `target/release/bundle` |
| `pnpm build:host`    | Native Messaging host                                     |
