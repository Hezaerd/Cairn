# Browser bridge

The extension reaches the desktop app in two hops:

```text
popup -> service worker -> native host (stdio) -> desktop app (named pipe)
```

The service worker only accepts messages from its own popup. The extension asks for `nativeMessaging` and no website permissions. Each popup request opens its own native connection, and nothing is saved in browser storage.

## Protocol

The only operation is `GetStatus`.

- A request has `version: 1`, an ASCII request ID of 1 to 64 characters, and `type: "GetStatus"`.
- A reply echoes the ID, with either `type: "Status"` and `appVersion`, or `type: "Error"` and a code.
- Unknown fields, operations, and versions are rejected. An invalid request with no usable ID gets an error with a null ID.

Both hops send UTF-8 JSON behind a four-byte little-endian length. Messages over 16 KiB are rejected before allocation. The host keeps stdout for the protocol. The host's pipe round trip times out after 1.5 seconds and the extension's after two.

## Pipe

The desktop app is the only pipe server.

- The endpoint name includes the Windows user SID and session ID.
- It rejects remote clients and has a protected DACL that grants access to the current user only.
- It runs at most 16 handlers at once and drops idle peers.
- It answers `GetStatus` only. The native host validates each reply and its ID.

## Limits

These controls don't authenticate peers against other software running as the same Windows user. The Native Messaging origin allowlist isn't profile pairing. Don't expose secrets through this endpoint until pairing, authenticated sessions, and per-operation authorization exist.
