import { Context, Effect, type Option } from "effect";
import { CairnClientError } from "@cairn/contracts/errors";

/** The key that identifies this browser to Cairn once you approve the pairing. */
export interface KeyPair {
  /** Raw uncompressed P-256 point, base64url. */
  readonly publicKey: string;
  /** SHA-256 of the raw public key, base64url. */
  readonly clientId: string;
  readonly sign: (message: string) => Effect.Effect<string, CairnClientError>;
}

export class BrowserKey extends Context.Service<
  BrowserKey,
  {
    readonly load: Effect.Effect<Option.Option<KeyPair>, CairnClientError>;
    /** Replaces any stored key with a new one. */
    readonly create: Effect.Effect<KeyPair, CairnClientError>;
  }
>()("cairn/BrowserKey") {}

const keyError = () => new CairnClientError({ code: "KeyUnavailable" });

export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const fromBase64url = (value: string) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) =>
    char.charCodeAt(0),
  );

/**
 * HMAC-SHA256 of a password, keyed with a challenge. Lets Cairn tell whether
 * it holds the password without receiving it. Must match `proves` in the
 * desktop app.
 */
export const passwordProof = (challenge: string, password: string) =>
  Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        "raw",
        fromBase64url(challenge),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );

      return base64url(
        new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(password))),
      );
    },
    catch: keyError,
  });

/** Eight digits from a digest's first four bytes. */
export function pairingDigits(digest: Uint8Array) {
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0) % 100_000_000;
  const digits = value.toString().padStart(8, "0");

  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

/**
 * The code Cairn shows when it asks you to approve this browser: digits from
 * the SHA-256 of Cairn's nonce and the raw public key. Must match
 * `pairing_code` in the desktop app.
 */
export const pairingCode = (publicKey: string, nonce: string) =>
  Effect.tryPromise({
    try: async () => {
      const nonceBytes = fromBase64url(nonce);
      const keyBytes = fromBase64url(publicKey);
      const input = new Uint8Array(nonceBytes.length + keyBytes.length);
      input.set(nonceBytes);
      input.set(keyBytes, nonceBytes.length);

      return pairingDigits(new Uint8Array(await crypto.subtle.digest("SHA-256", input)));
    },
    catch: keyError,
  });

/** The private key can't be exported: WebCrypto only lets this extension sign with it. */
export const generateKeys = Effect.tryPromise({
  try: () =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]),
  catch: keyError,
});

export const keyPair = (keys: CryptoKeyPair) =>
  Effect.tryPromise({
    try: async (): Promise<KeyPair> => {
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));

      return {
        publicKey: base64url(raw),
        clientId: base64url(digest),
        sign: (message) =>
          Effect.tryPromise({
            try: async () =>
              base64url(
                new Uint8Array(
                  await crypto.subtle.sign(
                    { name: "ECDSA", hash: "SHA-256" },
                    keys.privateKey,
                    new TextEncoder().encode(message),
                  ),
                ),
              ),
            catch: keyError,
          }),
      };
    },
    catch: keyError,
  });
