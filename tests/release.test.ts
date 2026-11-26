import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RELEASE_EXTENSION_ID, RELEASE_KEY } from "../apps/extension/release";

import tauri from "../apps/desktop/src-tauri/tauri.conf.json";
import rune from "../apps/desktop-rune/packaging/tauri.conf.json";

test("the Rune installer keeps the Cairn identity, version and signing key", () => {
  const manifest = readFileSync(
    new URL("../apps/desktop-rune/Cargo.toml", import.meta.url),
    "utf8",
  );

  const runeKey = readFileSync(
    new URL("../apps/desktop-rune/packaging/updater.pub", import.meta.url),
    "utf8",
  ).trim();

  assert.equal(/^version = "([^"]+)"$/m.exec(manifest)?.[1], tauri.version);
  assert.equal(rune.productName, tauri.productName);
  assert.equal(rune.identifier, tauri.identifier);
  assert.deepEqual(rune.bundle.targets, tauri.bundle.targets);
  assert.equal(rune.bundle.windows.nsis.installMode, tauri.bundle.windows.nsis.installMode);
  assert.equal(rune.bundle.windows.webviewInstallMode.type, "skip");
  assert.equal(rune.bundle.windows.allowDowngrades, false);
  assert.equal(runeKey, tauri.plugins.updater.pubkey);
});

test("the release extension ID is the one Chromium derives from its key", () => {
  const der = Buffer.from(RELEASE_KEY, "base64");

  // Chromium hashes the DER SubjectPublicKeyInfo and maps hex digits 0-f to a-p.
  const id = createHash("sha256")
    .update(der)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));

  assert.equal(id, RELEASE_EXTENSION_ID);
  assert.equal(
    createPublicKey({ key: der, format: "der", type: "spki" }).asymmetricKeyDetails?.modulusLength,
    2048,
  );
});
