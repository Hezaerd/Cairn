import { Context, Effect, type Option } from "effect";
import { CairnClientError } from "@cairn/contracts/errors";

/** The key that identifies this browser to Cairn once you approve the pairing. */
export interface KeyPair {
  /** Raw uncompressed P-256 point, base64url. */
  readonly publicKey: string;
  /** SHA-256 of the raw public key, base64url. */
  readonly clientId: string;
  /** The code Cairn shows when it asks you to approve this browser. */
  readonly code: string;
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

/** Eight digits from the key's SHA-256. Must match `pairing_code` in the desktop app. */
export function pairingCode(digest: Uint8Array) {
  const value = new DataView(digest.buffer, digest.byteOffset, 4).getUint32(0) % 100_000_000;
  const digits = value.toString().padStart(8, "0");

  return `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

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
        code: pairingCode(digest),
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
