import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Effect } from "effect";
import {
  base64url,
  generateKeys,
  keyPair,
  pairingCode,
  pairingDigits,
  passwordProof,
} from "@cairn/client/BrowserKey";
import { signedMessage } from "@cairn/contracts";

// Made by WebCrypto; the desktop app's auth tests verify the same file in Rust.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/protocol/signature.json", import.meta.url), "utf8"),
);

const decode = (value: string) => new Uint8Array(Buffer.from(value, "base64url"));

test("the extension derives the same client ID and code as the app", async () => {
  const raw = decode(fixture.publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
  assert.equal(base64url(digest), fixture.clientId);
  assert.equal(
    await Effect.runPromise(pairingCode(fixture.publicKey, fixture.nonce)),
    fixture.code,
  );
  assert.notEqual(
    await Effect.runPromise(pairingCode(fixture.publicKey, "B".repeat(43))),
    fixture.code,
  );
  assert.equal(pairingDigits(new Uint8Array([0, 0, 0, 7])), "0000 0007");
});

test("signed messages match the bytes the app checks", async () => {
  assert.equal(
    signedMessage({
      version: 1,
      requestId: "test-1",
      type: "GetLogin",
      origin: "https://example.com",
      entryId: "0123456789abcdef0123456789abcdef",
      clientId: fixture.clientId,
      challenge: "A".repeat(43),
    }),
    fixture.message,
  );

  const key = await crypto.subtle.importKey(
    "raw",
    decode(fixture.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );

  assert.ok(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decode(fixture.signature),
      new TextEncoder().encode(fixture.message),
    ),
  );
});

test("password proofs match the HMAC the app checks", async () => {
  // The desktop app's saving tests verify the same file in Rust.
  const proof = JSON.parse(
    readFileSync(new URL("./fixtures/protocol/proof.json", import.meta.url), "utf8"),
  );

  assert.equal(
    await Effect.runPromise(passwordProof(proof.challenge, proof.password)),
    proof.proof,
  );
  assert.notEqual(
    await Effect.runPromise(passwordProof(proof.challenge, `${proof.password}!`)),
    proof.proof,
  );
});

test("save requests sign every field", () => {
  const auth = { version: 1 as const, requestId: "test-1", clientId: fixture.clientId };
  const challenge = "A".repeat(43);

  assert.equal(
    signedMessage({
      ...auth,
      challenge,
      type: "SaveLogin",
      origin: "https://example.com",
      name: "Example",
      username: "me",
      password: "pass\nword",
    }),
    `cairn-bridge-v1\n${challenge}\nSaveLogin\nhttps://example.com\nExample\nme\npass\nword`,
  );
  assert.equal(
    signedMessage({
      ...auth,
      challenge,
      type: "CheckLogin",
      origin: "https://example.com",
      username: "me",
      proof: "B".repeat(43),
    }),
    `cairn-bridge-v1\n${challenge}\nCheckLogin\nhttps://example.com\n${"B".repeat(43)}\nme`,
  );
});

test("generated keys can't be exported and sign in the expected format", async () => {
  const keys = await Effect.runPromise(generateKeys);
  await assert.rejects(crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const pair = await Effect.runPromise(keyPair(keys));
  assert.equal(decode(pair.publicKey).length, 65);
  const signature = await Effect.runPromise(pair.sign("message"));
  assert.equal(decode(signature).length, 64);
});
