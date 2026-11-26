# Cairn

Cairn is a personal password manager for Windows. It has a native desktop app built with Rune and an extension for Helium and other Chromium browsers.

The desktop app creates and unlocks an encrypted local vault. You can add, edit, and delete credentials, reveal a password and its notes when you need them, and keep two-factor authenticator codes next to your logins. Once you pair the extension with the app, its popup lists the logins for the site you're on and fills one in with a click, while the vault is unlocked.

## Quick start

Install the [development prerequisites](docs/development.md#prerequisites), then run the desktop app.

```sh
pnpm install
pnpm build:host
pnpm dev:desktop
```

The installer ships the extension. Open **Settings → Browser extension** to find the folder to load. To load a dev copy from the checkout instead, follow [Development](docs/development.md#browser-extension). Then pair it as described in [Browser bridge](docs/browser-bridge.md#using-it).

## Documentation

[Development](docs/development.md) · [Vault](docs/vault.md) · [Browser bridge](docs/browser-bridge.md) · [Design](DESIGN.md)

Cairn hasn't had an independent security audit.
