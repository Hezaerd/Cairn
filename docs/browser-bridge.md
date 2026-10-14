# Browser bridge

The extension reaches the desktop app in two hops:

```text
popup -> service worker -> native host (stdio) -> desktop app (named pipe)
```

The service worker accepts messages from its popup, its picker frame, and its content script in a page's top frame. Each request opens its own native connection. Credentials go from the app to the service worker and into the page being filled; nothing else in the extension sees them, and nothing is saved in browser storage except the pairing key.

## Using it

1. Open the popup and choose **Pair with Cairn**. The popup shows an eight-digit code, and Cairn comes to the front with the same code. Approve it there if the codes match.
2. On a website, open the popup. It lists the logins whose site matches the tab. Click one to fill the username and password into the page.
3. To get suggestions in login fields, turn on **Suggest logins in login fields** in the popup and allow access to websites. Focusing a login field on a site with saved logins then opens a list under it; click one to fill it. A Cairn icon in the field opens the list too, and the toolbar badge shows how many logins the site has.
4. **Paired browsers** (the globe button in Cairn's header) lists the paired browsers. Removing one revokes it; the extension then shows the pairing code again.

The popup needs Cairn running with the vault unlocked. The vault locks when Cairn goes to the tray, so the popup asks you to unlock Cairn instead. Pairing needs the vault unlocked too, because the list of paired browsers is encrypted with the vault key.

## Matching sites

A login matches a tab when they share the scheme and port, and the tab's host is the login's host or one of its subdomains. A leading `www.` on the stored site is ignored. A site saved without a scheme means `https`, so a login is offered to a plain `http` page only if its site says `http://`. IP addresses must match exactly.

The content script fills the login, after checking that the tab is still on the origin it was asked for. It fills the form whose field opened the picker, or else the first form with a visible password field: that password field and the username field before it in the same form. On a page that asks for the username alone, it fills a field marked `autocomplete="username"` or `type="email"`. It skips sign-up and password-change forms, with two password fields or one marked `new-password`. It doesn't submit the form.

## Suggestions

Suggestions need the optional `https://*/*` and `http://*/*` permissions. Once they're granted, the service worker registers the content script for every site and injects it into tabs already open; it unregisters the script when they're removed. The script runs in the top frame only.

- The content script looks for a login form at load and when the page changes. When it finds one, it asks the service worker whether Cairn has logins for the page. The answer is only yes, locked, or no; the address comes from Chromium, not from the page.
- The service worker keeps the names and usernames of each tab's logins in memory for a minute, never in browser storage, and sets the badge to their count. A tab that leaves the site loses them.
- With logins, the field gets a Cairn icon and focusing it opens the picker. With a locked vault, the icon opens the picker, which asks you to unlock Cairn. Otherwise nothing shows.
- The icon and the picker live in a closed shadow root. The picker is `picker.html`, a frame the page can't read. Only trusted focus, click, and key events open it, and the service worker answers a picker only after the tab's content script opened it for that site.
- Escape, a click elsewhere, or a fill closes the picker. Focusing the same field doesn't reopen it; clicking it does.

## Pairing and authorization

- The extension creates a P-256 key pair with WebCrypto. The private key is non-extractable, so no script can read it back, and it is stored as a `CryptoKey` in the extension's IndexedDB.
- **Pair** sends the public key. Cairn shows a code made from the key's SHA-256 and keeps one pending request for two minutes. Approving stores the key in `browsers.cairn`, encrypted with the vault key. Its client ID is the SHA-256 of the key.
- Every vault request first asks for a challenge: 32 random bytes, valid once, for 30 seconds. The extension signs the challenge with the operation, origin, and entry ID. Cairn checks the challenge, the paired key, and the signature before it answers.
- **ListLogins** returns the ID, name, and username of matching logins, at most 20. **GetLogin** returns the username and password of one login, and only if its site matches the origin in the signed request.

## Protocol

| Request        | Needs                      | Reply              |
| -------------- | -------------------------- | ------------------ |
| `GetStatus`    | nothing                    | `Status`           |
| `GetChallenge` | nothing                    | `Challenge`        |
| `Pair`         | an unlocked vault          | `PairingRequested` |
| `ListLogins`   | a signature from a pairing | `Logins`           |
| `GetLogin`     | a signature from a pairing | `Login`            |

- A request has `version: 1`, an ASCII request ID of 1 to 64 characters, and a `type`. Keys, client IDs, challenges, and signatures are unpadded base64url of a fixed length. An origin is an `http` or `https` origin exactly as the browser serializes it.
- A signed request carries `clientId`, `challenge`, and `signature`. The signature is ECDSA P-256 with SHA-256, in WebCrypto's 64-byte `r || s` form, over:

  ```text
  cairn-bridge-v1\n<challenge>\nListLogins\n<origin>\n
  cairn-bridge-v1\n<challenge>\nGetLogin\n<origin>\n<entryId>
  ```

- A reply echoes the ID with the reply type for its request, or `type: "Error"` and a code: `InvalidRequest`, `UnsupportedVersion`, `AppUnavailable`, `RequestTimeout`, `ProtocolMismatch`, `VaultLocked`, `NotPaired`, `Unauthorized`, or `NotFound`.
- Unknown fields, operations, and versions are rejected. An invalid request with no usable ID gets an error with a null ID. `tests/fixtures/protocol` holds cases that both the Rust and TypeScript tests check.

Both hops send UTF-8 JSON behind a four-byte little-endian length. Messages over 16 KiB are rejected before allocation. The host keeps stdout for the protocol. The host's pipe round trip times out after 1.5 seconds and the extension's after two.

## Pipe

The desktop app is the only pipe server.

- The endpoint name includes the Windows user SID and session ID.
- It rejects remote clients and has a protected DACL that grants access to the current user only.
- It runs at most 16 handlers at once and drops idle peers.
- The native host validates each request before forwarding it, and checks that each reply answers it.

## Extension permissions

The extension asks for `nativeMessaging`, `activeTab`, and `scripting`. `activeTab` lets it read the address of the tab you opened the popup on, and inject the content script there, only after you click its toolbar button. Access to websites is optional and only needed for suggestions. `picker.html` is the only web-accessible resource, behind a per-session dynamic URL.

## Limits

- Software running as your Windows user can reach the pipe. Without the pairing key, it gets only the status and challenges. With the vault unlocked, it can also ask for a pairing, which you have to approve in Cairn.
- The pairing key is in the browser profile on disk. Software that can read that profile and drive WebCrypto in the extension's context, or that reads the browser's memory, can use the key while the vault is unlocked. Nothing on a desktop protects an unlocked vault from malware running as you.
- A click in the popup or the picker is the only approval for a fill. Cairn doesn't ask again.
- The page owns the picker's host element, so it can cover the picker, make it transparent, or move it under the pointer. The picker ignores clicks unless Chromium reports it fully visible for 400 ms. A script running on the login's own site, through XSS for example, can still read a filled password field.
- A page sees the icon in its own DOM, so it learns that you have a login for it.
- The password crosses the native host and the service worker in memory, and the page receives it in its input field. Strings in JavaScript can't be wiped.
