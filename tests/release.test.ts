import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { test } from "node:test";
import { RELEASE_EXTENSION_ID, RELEASE_KEY } from "../apps/extension/release";

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
