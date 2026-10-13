# Cairn

Cairn is a personal password manager for Windows: a Tauri desktop app that holds an encrypted local vault, and a Chromium extension for Helium that talks to it through a Native Messaging host. Hezaerd builds it for their own use.

## Working with me

Use the requested outcome and constraints to choose the workflow. Continue through implementation, relevant verification, and fixes until the result is complete or a concrete blocker prevents progress. Ask only when missing information materially affects the result and can't reasonably be inferred.

Read what the task needs. [Development](docs/development.md) covers setup, the extension, and tests; [vault](docs/vault.md) covers storage, encryption, and site icons; [browser bridge](docs/browser-bridge.md) covers the protocol and the pipe. Don't treat these as a required reading list.

## Project boundaries

- The repository is a pnpm workspace and a Cargo workspace. Add an app's dependencies to that app; keep only repository-wide tooling in the root `package.json`.
- `apps/desktop` is the Tauri app. Its Rust side is in `apps/desktop/src-tauri`, and its UI uses the shadcn/ui components in `src/components/ui`. Reuse them and the tokens in `src/App.css`.
- `apps/extension` is the popup and service worker. The service worker only accepts messages from its own popup. Keep its permissions to `nativeMessaging`.
- `packages/contracts` holds the Effect Schema wire contracts and typed errors. `packages/client` holds the Effect services and the Native Messaging adapter.
- `crates/vault` holds the vault format, crypto, sessions, and storage, and doesn't depend on Tauri. `crates/favicon` downloads site icons and owns their cache. `crates/protocol`, `crates/local-bridge`, and `crates/native-host` carry the status bridge.
- Each app keeps its routes in `src/routes`. Don't edit the generated `src/routeTree.gen.ts` files.

## Security rules

- Passwords and notes reach the UI only on an explicit reveal. Never put a credential, the master password, or a key in logs, errors, browser storage, or the favicon cache.
- Don't change the vault file format, key derivation parameters, or nonce handling without a version bump and a migration path. Existing vaults must keep opening.
- The bridge answers `GetStatus` only. Don't expose vault data through it before pairing, authenticated sessions, and per-operation authorization exist.
- Tests use synthetic data under `.local`. Never open the personal vault or a personal browser profile.

## Effect

The TypeScript packages use Effect v4. Most examples online, and most of what you remember, describe Effect v3, whose APIs differ. Check an API in the installed `effect` source before using it.

- Declare services as `Context.Service` classes, as `CairnClient` and `NativeTransport` do.
- Fail with tagged errors, not thrown `Error`s.
- Validate data that crosses a boundary with Schema.

## Verification

Run `pnpm check` and `pnpm test` before calling a change done, with Cairn closed. When a change touches the vault, the bridge, or the UI flow, also run the matching end-to-end test from [development](docs/development.md#tests). Fix the cause of a lint failure instead of weakening a rule.

## Documentation and pull requests

Keep README.md to an introduction, quick start, and links. Put procedures in `docs/development.md` and behavior in the topic docs. Update a doc when a change makes it wrong; don't add implementation diaries or scratch plans.

Write commits and PR titles as Conventional Commits: `feat: …`, `fix: …`, `chore: …`, `docs: …`. PRs target `main`. Explain the problem, the result, and what you actually checked. Attach screenshots for visual changes to the PR instead of committing them.
