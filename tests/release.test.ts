import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RELEASE_EXTENSION_ID, RELEASE_KEY } from "../apps/extension/release";

import installer from "../apps/desktop-rune/packaging/tauri.conf.json";

test("the installer preserves the Cairn identity and updater key", () => {
  const updaterKey = readFileSync(
    new URL("../apps/desktop-rune/packaging/updater.pub", import.meta.url),
    "utf8",
  ).trim();

  assert.equal(installer.productName, "Cairn");
  assert.equal(installer.identifier, "com.hezaerd.cairn");
  assert.deepEqual(installer.bundle.targets, ["nsis"]);
  assert.equal(installer.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(installer.bundle.windows.webviewInstallMode.type, "skip");
  assert.equal(installer.bundle.windows.allowDowngrades, false);
  assert.equal(
    updaterKey,
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk4ODYxQkU5NzNGNzNDMkMKUldRc1BQZHo2UnVHbU9keU1Zck5ycXFXRjk2K2o4WmlINHg1czJjK3VUVUdsOURzVVQ2VUZpd3EK",
  );
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
