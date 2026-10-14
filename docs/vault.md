# Vault

## What the app does

- The list shows names, sites, and usernames. Search filters them locally.
- A password or note reaches the UI only when you reveal it, and hides again after 30 seconds, or when you select another entry, search, or open a dialog.
- The edit dialog leaves the password field empty, and an empty field keeps the stored password. Notes are editable only if you revealed them before opening the editor. Otherwise they stay unchanged.
- The wand button next to the password field generates a password. See [password generator](#password-generator).
- Deleting an entry asks for confirmation. `backups/previous.cairn` keeps the version that still holds the entry until the next change.
- The backend locks after five minutes without activity, when closing the window to the tray, or through the tray's lock action. Activity is listing or revealing in the window, a change from the window or the browser, approving a pairing, or filling a login picked in the extension. The extension's background queries, listing a page's logins for suggestions and checking whether a typed login is new, don't count, so browsing can't keep the vault open. Typing alone doesn't reset the timer either. On lock, the desktop clears the list, the revealed secret, and the entry form. The bridge still answers while Cairn is in the tray, but only with its status: the vault is locked.
- The WebView runs in private mode with form autofill turned off. No credential goes to browser storage or logs.

Changing the master password, Windows Hello, sync, and recovery keys aren't built.

## Files

Cairn stores its data in Tauri's `app_local_data_dir()`:

```text
%LOCALAPPDATA%\com.hezaerd.cairn\
  vault.cairn
  vault.lock
  favicons.cairn
  browsers.cairn
  backups\previous.cairn
```

`vault.cairn` is a versioned JSON envelope. Version 2 added the paired-browser binding. Cairn still opens version 1 vaults and rewrites them as version 2 when you unlock them, keeping the version 1 file in `backups/previous.cairn`. Older releases can't open a version 2 vault. It holds the public key derivation parameters, the wrapped key, nonces, and ciphertext. Names, sites, usernames, passwords, and notes are all inside the ciphertext. Cairn never writes the master password or an unwrapped key to disk.

`browsers.cairn` lists the browsers paired with the extension: their public keys, names, and pairing dates. It is encrypted with the vault key, under its own header data, so nothing can add a browser without the master password. The encrypted part of `vault.cairn` records the nonce of the last write to `browsers.cairn`, and Cairn rewrites both on every pairing change. An older copy of the list, which might still hold a removed browser, no longer matches and reads as empty. So does a damaged or missing file, which only means pairing again. This doesn't stop someone with access to your files from rolling back `vault.cairn` and `browsers.cairn` together. See [browser bridge](browser-bridge.md).

`vault.lock` is an OS writer lock, not a key. The directory has the Windows user's normal permissions.

## Encryption

- Argon2id v19 from RustCrypto, with 64 MiB of memory, one lane, and 3 to 10 passes. Cairn picks the pass count at creation to take about 500 ms, and checks the bounds before it processes an untrusted file.
- A random 16-byte salt derives the wrapping key. A separate random 32-byte key encrypts the vault with XChaCha20-Poly1305.
- The key wrap and the payload each use their own random 24-byte nonce and domain-separated header data. Every save uses a fresh payload nonce.
- Limits: 16 MiB per file, 4 MiB of serialized plaintext, and 10,000 entries. Rust also checks each field's length.

Keys, entries, secret command results, the serialization buffer, and the Argon2 work area are zeroized when dropped. That doesn't erase copies made by JavaScript, IPC, allocators, libraries, the pagefile, or crash dumps. Encryption at rest doesn't protect an unlocked app from malware running as the same Windows user.

## Saving and backups

- Each save writes a temporary ciphertext file in the same directory, flushes it, and atomically replaces `vault.cairn`.
- Before the replacement, the previous version goes to `backups/previous.cairn`.
- Creating a vault never overwrites an existing one.
- A failed save locks the session, so the next unlock reads what is actually on disk.
- Cairn detects changes made by another program before it saves.
- An interrupted save leaves only ciphertext behind. The app can't guarantee the file survives a power loss.

## Recovery

1. Close Cairn.
2. Keep a copy of the damaged `vault.cairn`.
3. Copy `backups/previous.cairn` to `vault.cairn`. You lose the last change. If that change paired or removed a browser, you pair your browsers again.

The backup sits on the same drive, so keep separate copies of the encrypted vault. There is no password reset. If you lose the master password, you lose the vault and its backups. When only the backup survives, Cairn shows recovery steps and refuses to create a new vault over it.

## Password generator

The add and edit dialogs can generate a password. Rust generates it, in `crates/vault/src/generator.rs`, with the OS random generator that also makes the vault's keys and nonces.

- Options: a length from 8 to 128, 20 by default, and lowercase letters, uppercase letters, digits, and symbols, all on by default. **Avoid look-alike characters** leaves out `I`, `l`, `1`, `O`, `0`, `o`, and `|`. At least one set stays on, and Rust refuses an empty selection or a length out of range.
- The password has at least one character from each set that's on. Rust picks those first, fills the rest from all the sets, then shuffles the whole password. It draws each character by rejection sampling, so every character in a set is equally likely.
- Changing an option generates a new password, and so does **Regenerate**. **Use password** puts it in the password field. It reaches the vault only when you save the entry.
- The window keeps the options in its local storage so the next password uses them. It doesn't keep the passwords: the preview is cleared when the popover closes, and nothing logs them.
- Generating doesn't open the vault or count as activity for the idle lock.

The browser extension doesn't generate passwords.

## Site icons

Rust downloads icons outside the WebView. It tries `/favicon.ico`, then the icon links in the page's HTML.

- Requests go over public HTTPS on port 443, with no cookies, no authorization, no stored URL path, and no favicon proxy.
- Cairn checks and pins DNS addresses, and rejects private destinations and cross-origin redirects.
- It decodes PNG, ICO, JPEG, and WebP within size limits and stores them as PNG up to 64 pixels. Other formats show the entry's initial.
- Only visible rows ask for icons. Fetching an icon never resets the idle lock.

`favicons.cairn` is a separate encrypted cache. It uses the vault key with its own encryption purpose and holds no credentials. It keeps up to 256 origins and about 2 MiB. Icons stay fresh for 30 days, and failures retry after six hours while keeping the older icon. Locking cancels pending downloads and clears icons from the UI. To clear the cache, close Cairn and delete `favicons.cairn`.
