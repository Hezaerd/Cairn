import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer, Match, Option } from "effect";
import { BrowserKey, generateKeys, keyPair } from "@cairn/client/BrowserKey";
import { CairnClient, CairnClientLive } from "@cairn/client/CairnClient";
import { chromiumTransport, type NativeRuntime } from "@cairn/client/ChromiumTransport";
import { DEV_HOST_NAME, signedMessage } from "@cairn/contracts";

function event() {
  const listeners = new Set<(...args: any[]) => void>();

  return {
    addListener: (listener: (...args: any[]) => void) => listeners.add(listener),
    removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener),
    emit: (...args: any[]) => {
      for (const listener of listeners) listener(...args);
    },
    get size() {
      return listeners.size;
    },
  };
}

function fakeRuntime(
  mode: "status" | "missing" | "disconnected" | "invalid" | "mismatch" | "silent" | "unavailable",
) {
  let connections = 0;
  const ports: any[] = [];

  let lastError: chrome.runtime.LastError | undefined;

  const runtime = {
    get lastError() {
      return lastError;
    },
    connectNative: (hostName: string) => {
      assert.equal(hostName, DEV_HOST_NAME);
      connections++;

      const port = {
        onMessage: event(),
        onDisconnect: event(),
        closed: false,
        disconnect() {
          this.closed = true;
        },
        postMessage(request: any) {
          queueMicrotask(() => {
            if (mode === "silent") return;

            if (mode === "missing" || mode === "disconnected") {
              lastError = {
                message:
                  mode === "missing"
                    ? "Specified native messaging host not found."
                    : "Native host has exited.",
              };
              this.onDisconnect.emit();
              lastError = undefined;
            } else {
              this.onMessage.emit(
                Match.value(mode).pipe(
                  Match.when("invalid", () => ({ secret: "no" })),
                  Match.when("unavailable", () => ({
                    version: 1,
                    requestId: request.requestId,
                    type: "Error",
                    code: "AppUnavailable",
                  })),
                  Match.orElse(() => ({
                    version: 1,
                    requestId: mode === "mismatch" ? "other-id" : request.requestId,
                    type: "Status",
                    appVersion: "0.1.0",
                  })),
                ),
              );
            }
          });
        },
      };

      ports.push(port);

      return port;
    },
  };

  return {
    runtime,
    ports,
    get connections() {
      return connections;
    },
  };
}

/** Keeps the key in memory, as IndexedDB would keep it in the extension. */
function memoryKey() {
  let stored: CryptoKeyPair | undefined;

  return Layer.succeed(
    BrowserKey,
    BrowserKey.of({
      load: Effect.suspend(() =>
        stored ? Effect.map(keyPair(stored), Option.some) : Effect.succeed(Option.none()),
      ),
      create: Effect.gen(function* () {
        stored = yield* generateKeys;

        return yield* keyPair(stored);
      }),
    }),
  );
}

const client = (runtime: NativeRuntime, key = memoryKey()) =>
  CairnClientLive.pipe(Layer.provide(Layer.merge(chromiumTransport(runtime, DEV_HOST_NAME), key)));

const program = (runtime: NativeRuntime) =>
  Effect.gen(function* () {
    const client = yield* CairnClient;

    return yield* client.getStatus;
  }).pipe(
    Effect.provide(client(runtime)),
    Effect.match({ onSuccess: () => "Connected", onFailure: (error) => error.code }),
  );

for (const [mode, expected] of [
  ["status", "Connected"],
  ["missing", "HostUnavailable"],
  ["disconnected", "ConnectionLost"],
  ["invalid", "InvalidResponse"],
  ["mismatch", "InvalidResponse"],
  ["silent", "RequestTimeout"],
  ["unavailable", "AppUnavailable"],
] as const) {
  test(`transport: ${mode} and resource cleanup`, async () => {
    const fake = fakeRuntime(mode);
    assert.equal(await Effect.runPromise(program(fake.runtime)), expected);
    assert.ok(
      fake.ports.every((p) => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0),
    );
  });
}

test("independent concurrent requests and a fresh worker scope", async () => {
  const fake = fakeRuntime("status");
  assert.deepEqual(
    await Promise.all([
      Effect.runPromise(program(fake.runtime)),
      Effect.runPromise(program(fake.runtime)),
    ]),
    ["Connected", "Connected"],
  );
  assert.equal(await Effect.runPromise(program(fake.runtime)), "Connected");
  assert.equal(fake.connections, 3);
  assert.ok(
    fake.ports.every((p) => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0),
  );
});

test("interruption closes the native connection", async () => {
  const fake = fakeRuntime("silent");
  const controller = new AbortController();
  const result = Effect.runPromise(program(fake.runtime), { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(result);
  assert.ok(
    fake.ports.every((p) => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0),
  );
});

/**
 * Plays the desktop app: issues challenges, records the paired key once
 * "approved", and answers only requests signed by it.
 */
function fakeApp() {
  const challenges = new Set<string>();
  let pending: string | undefined;
  let paired: CryptoKey | undefined;

  const reply = async (request: any) => {
    const header = { version: 1, requestId: request.requestId };
    const error = (code: string) => ({ ...header, type: "Error", code });

    if (request.type === "GetChallenge") {
      const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "base64url",
      );

      challenges.add(challenge);

      return { ...header, type: "Challenge", challenge };
    }

    if (request.type === "Pair") {
      pending = request.publicKey;

      return { ...header, type: "PairingRequested", nonce: "A".repeat(43) };
    }

    if (!challenges.delete(request.challenge)) return error("Unauthorized");

    if (!paired) return error("NotPaired");

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      paired,
      Buffer.from(request.signature, "base64url"),
      new TextEncoder().encode(signedMessage(request)),
    );

    if (!valid) return error("Unauthorized");

    return request.type === "ListLogins"
      ? {
          ...header,
          type: "Logins",
          logins: [{ id: "0123456789abcdef0123456789abcdef", name: "Example", username: "u" }],
        }
      : { ...header, type: "Login", username: "u", password: "synthetic" };
  };

  const runtime: NativeRuntime = {
    connectNative: () => {
      const port = {
        onMessage: event(),
        onDisconnect: event(),
        disconnect() {},
        postMessage(request: any) {
          void reply(request).then((response) => port.onMessage.emit(response));
        },
      };

      return port;
    },
  };

  return {
    runtime,
    approve: async () => {
      paired = await crypto.subtle.importKey(
        "raw",
        Buffer.from(pending!, "base64url"),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    },
  };
}

test("pairing, then signed requests for logins", async () => {
  const app = fakeApp();
  const key = memoryKey();

  const run = <A>(use: (client: CairnClient["Service"]) => Effect.Effect<A, any>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* CairnClient);
      }).pipe(
        Effect.provide(client(app.runtime, key)),
        Effect.mapError((error) => error.code),
        Effect.flip,
        Effect.map((code) => ({ code })),
        Effect.catch((value) => Effect.succeed(value)),
      ),
    );

  const origin = "https://example.com";
  assert.equal(await run((c) => c.hasKey), false);
  assert.deepEqual(await run((c) => c.listLogins(origin)), { code: "NotPaired" });

  const code = await run((c) => c.pair("Helium (Windows)"));
  assert.match(String(code), /^\d{4} \d{4}$/);
  assert.equal(await run((c) => c.hasKey), true);
  // A key the app hasn't approved yet gets nothing.
  assert.deepEqual(await run((c) => c.listLogins(origin)), { code: "NotPaired" });

  await app.approve();
  assert.deepEqual(await run((c) => c.listLogins(origin)), [
    { id: "0123456789abcdef0123456789abcdef", name: "Example", username: "u" },
  ]);
  assert.deepEqual(await run((c) => c.getLogin(origin, "0123456789abcdef0123456789abcdef")), {
    username: "u",
    password: "synthetic",
  });

  // A different browser's key is refused even with a fresh challenge.
  assert.deepEqual(
    await Effect.runPromise(
      Effect.gen(function* () {
        const other = yield* CairnClient;
        yield* other.pair("Other");

        return yield* other.listLogins(origin);
      }).pipe(
        Effect.provide(client(app.runtime)),
        Effect.match({ onSuccess: () => "Allowed", onFailure: (error) => error.code }),
      ),
    ),
    "Unauthorized",
  );
});
