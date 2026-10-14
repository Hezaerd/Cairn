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

Create a vault with a master password of at least 12 characters. Closing the window locks the vault and hides Cairn in the system tray; its status server keeps running. Click the tray icon or launch Cairn again to restore the window. Right-click the icon for **Open Cairn**, **Lock vault**, and **Quit**. Only **Quit** exits the app. Minimizing keeps the normal Windows behavior.

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

The popup shows `Cairn unavailable` when the app is closed and `Connector not installed` when the native host is missing or refused. Once connected, choose **Pair with Cairn** and approve the code in the app; [browser bridge](browser-bridge.md#using-it) covers pairing and filling. The popup only talks to the app when you open it or press a button. With suggestions on, the content script also asks when a page shows a login form. Reload the extension after each rebuild, and reload open pages to get the new content script.

The build makes `content.js` separately, as one classic script without Effect, because content scripts can't load modules and it runs on every page.

Load the extension in each Helium profile you want to test. Running the script again with another extension ID keeps the IDs already registered.

The registration applies to the current Windows user and needs no administrator rights. It writes `.local/native-host.json` and sets `HKCU\Software\Chromium\NativeMessagingHosts\com.hezaerd.cairn` in both registry views. The script refuses to replace another installation. Pass `-BinaryPath` with an absolute path to register a release host.

The registration stores absolute paths. Before moving the checkout, unregister it:

```powershell
.\scripts\unregister-native-host.ps1
```

The desktop installer doesn't register the host yet.

## Languages

Cairn ships in English (`en-US`) and French (`fr-FR`) and follows the Windows display language by default: any French variant gets French, everything else gets English. Settings > General can pin either language instead; Rust saves that choice in `language.json` next to the vault.

- The desktop window and tray menu get the language from Rust (`src-tauri/src/locale.rs`). The window asks once at startup; changing it in the settings goes through Rust too, which relabels the tray menu. UI strings live in `apps/desktop/src/i18n`. Add a string to `en-US.ts` first; `fr-FR.ts` is typed against it, so `pnpm typecheck` fails until the French one exists. Read strings with `useT()`. Tray labels are in `tray.rs`.
- The extension uses Chrome's i18n and follows Helium's UI language. Its strings live in `apps/extension/public/_locales/{en,fr}/messages.json` and are read with `t()` from `src/popup/i18n.ts`, whose keys come from the English file. `pnpm test` checks both files have the same keys and placeholders.

The end-to-end tests select elements by their French text. The vault test sets `CAIRN_TEST_LOCALE=fr-FR`, which only debug builds read in place of the Windows language, and the Helium test launches with `--lang=fr`.

## Icons

`brand/cairn.svg` is the only source for the logo. After editing it, regenerate every icon with:

```sh
pnpm icons
```

The script renders through `tauri icon` and writes the app icons to `apps/desktop/src-tauri/icons`, the bare mark in black and white at 16 to 256 pixels to `icons/mark`, and the extension icons to `apps/extension/public/icons`. The app and extension icons put the mark on a dark tile so it shows on light and dark taskbars and toolbars. The tray shows the bare mark, black or white to match the Windows taskbar mode. The title bar uses the SVG directly, in the text color.

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

It covers creation, the language setting, reveal and hide, locking, close-to-tray and second-launch restoration, wrong passwords, restarts, encrypted disk contents, and corrupted files. Its data and WebView2 profile live under `.local`. Only debug builds read the `CAIRN_TEST_DATA_DIR` override, so the test never opens your own vault.

It uses no network by default. To also check live favicons, set `$env:CAIRN_TEST_FAVICON_SITE = 'https://www.google.com'` in PowerShell before running it, and remove the variable afterwards.

### Autofill end-to-end

This test pairs an isolated Helium profile with the real app and fills a login page served on `127.0.0.1`. Close Cairn and unregister this checkout's host, then run:

```sh
pnpm build
pnpm build:host
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:autofill
```

It covers pairing and its code, refusal before approval, listing only the logins for the tab's site, filling, refusing another site's login, a page without a form, a locked vault, and removing a paired browser. For suggestions, it covers the picker opening on focus, the badge, refusing clicks on a transparent picker, filling from the picker, reopening and Escape, sign-up forms, and a site without logins. For saving, it covers the banner after a login on a new site, refusing clicks on a transparent banner, saving under a chosen name and the app showing it, no offer for a known login, a filled login, or a failed login, updating a changed password, a sign-up form, and Not now. A browser under automation can't click the toolbar button that grants `activeTab` or accept a permission prompt, so the test loads a copy of the extension with host access to `127.0.0.1` instead, which stands in for both. It saves screenshots of the popup, the picker, the save banner, and the app next to its data under `.local`.

### Helium end-to-end

Close Cairn and unregister this checkout's host first. Then run:

```sh
pnpm build
pnpm build:host
pnpm --filter @cairn/desktop tauri build --debug --no-bundle
pnpm test:helium
```

The test creates isolated Helium profiles under `.local` and registers the host only for its run. It checks a missing host, a closed app, a live connection, two profiles, service worker restarts, connection while hidden in the tray, and process termination. Set `CAIRN_HELIUM_PATH` if Helium isn't in its default location.

## Builds

| Command              | Output                                                   |
| -------------------- | -------------------------------------------------------- |
| `pnpm build`         | Desktop frontend and extension                           |
| `pnpm build:desktop` | Native app and NSIS installer in `target/release/bundle` |
| `pnpm build:host`    | Native Messaging host                                    |

Local builds aren't signed for the updater, so they can't be published as updates.

## Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`. A Windows job builds the NSIS installer without the signing key. A second job signs it for the updater and attaches the installer, its `.sig`, and `latest.json` to a draft release.

1. Set the same version in `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, and `apps/desktop/package.json`, and merge it into `main`.
2. Tag the merge and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

   The workflow fails if the tag doesn't match the `tauri.conf.json` version.

3. Install the draft's installer, check it, then publish the release.

### Nightly builds

`.github/workflows/nightly.yml` builds `main` every day at 03:00 UTC, and skips the build when `main` hasn't changed since the last nightly. Run it by hand from the Actions tab to build right away. It builds and signs the same way as a release, then replaces a single prerelease tagged `nightly` with the new installer, its `.sig`, and a `latest.json` it writes itself.

A nightly takes the next patch version with a timestamp, such as `0.1.1-nightly.202610130300` after `0.1.0`. That keeps it newer than the stable release it was built after and older than the next one.

### Update channels

Settings → General → Updates picks the channel and checks on demand. At launch, release builds also check and offer an update in a notification. Debug builds never check, so the end-to-end tests stay offline.

| Channel | Manifest                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Stable  | `https://github.com/Hezaerd/Cairn/releases/latest/download/latest.json`  |
| Nightly | `https://github.com/Hezaerd/Cairn/releases/download/nightly/latest.json` |

The URLs are fixed in `src-tauri/src/updater.rs`; the UI only sends a channel name. The choice is saved in `update-channel` next to the vault. Without it, a stable build starts on stable and a nightly build on nightly.

Stable installs only see a release once it's published and marked latest. GitHub never marks a prerelease as latest, so the nightly never reaches them. Both manifests need the repository to be public.

Updates never go back in version. Switching from nightly to stable keeps the nightly until a newer stable release comes out, so a vault a nightly touched isn't opened by an older Cairn.

The installer isn't Authenticode-signed. SmartScreen warns on the first manual install (More info → Run anyway). Updates are protected by the updater signature instead: the app only installs an update whose `.sig` matches the public key in `tauri.conf.json`.

The private key is in `~/.tauri/cairn.key` and in the `TAURI_SIGNING_PRIVATE_KEY` secret of the `updater-signing` environment. Keep a backup of it outside this machine. Without it, installed copies can't accept updates and have to be reinstalled by hand. If the key gets a password, store it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the same environment.

The key is trusted for automatic installs, so the workflows keep it away from the build:

- The build job runs `pnpm build` and the npm packages it pulls in. It has no signing key and a read-only token.
- The signing job installs only `@tauri-apps/cli` at `TAURI_CLI_VERSION`, with install scripts off, and signs the downloaded installer. It's the only job in the `updater-signing` environment. Restrict that environment's deployment branches and tags to `main` and `v*`. When the lockfile moves to another `@tauri-apps/cli`, update `TAURI_CLI_VERSION` in both workflows; the build fails until they match.
- Every action is pinned to a commit SHA, with its version in a comment.

To sign by hand instead, build with `pnpm build:desktop`, then run `pnpm --filter @cairn/desktop tauri signer sign --private-key-path ~/.tauri/cairn.key --app-version <version> <installer>`. Pass `--app-version` so the signature carries the version, as `tauri build` does.
