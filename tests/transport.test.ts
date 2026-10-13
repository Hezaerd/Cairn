import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { CairnClient, CairnClientLive } from "@cairn/client/CairnClient";
import { chromiumTransport, type NativeRuntime } from "@cairn/client/ChromiumTransport";

function event() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (listener: (...args: any[]) => void) => listeners.add(listener),
    removeListener: (listener: (...args: any[]) => void) => listeners.delete(listener),
    emit: (...args: any[]) => { for (const listener of [...listeners]) listener(...args); },
    get size() { return listeners.size; },
  };
}

function fakeRuntime(mode: "status" | "missing" | "disconnected" | "invalid" | "mismatch" | "silent" | "unavailable") {
  let connections = 0;
  const ports: any[] = [];
  const runtime = {
    lastError: undefined as { message: string } | undefined,
    connectNative: () => {
      connections++;
      const port = {
        onMessage: event(), onDisconnect: event(), closed: false,
        disconnect() { this.closed = true; },
        postMessage(request: any) {
          queueMicrotask(() => {
            if (mode === "silent") return;
            if (mode === "missing" || mode === "disconnected") {
              runtime.lastError = { message: mode === "missing" ? "Specified native messaging host not found." : "Native host has exited." };
              this.onDisconnect.emit();
              runtime.lastError = undefined;
            } else {
              this.onMessage.emit(mode === "invalid" ? { secret: "no" } : mode === "unavailable" ? {
                version: 1, requestId: request.requestId, type: "Error", code: "AppUnavailable",
              } : { version: 1, requestId: mode === "mismatch" ? "other-id" : request.requestId, type: "Status", appVersion: "0.1.0" });
            }
          });
        },
      };
      ports.push(port);
      return port;
    },
  };
  return { runtime: runtime as unknown as NativeRuntime, ports, get connections() { return connections; } };
}

const program = (runtime: NativeRuntime) => Effect.gen(function* () {
  const client = yield* CairnClient;
  return yield* client.getStatus;
}).pipe(
  Effect.provide(CairnClientLive.pipe(Layer.provide(chromiumTransport(runtime)))),
  Effect.match({ onSuccess: () => "Connected", onFailure: (error) => error.code }),
);

for (const [mode, expected] of [
  ["status", "Connected"], ["missing", "HostUnavailable"], ["disconnected", "ConnectionLost"],
  ["invalid", "InvalidResponse"], ["mismatch", "InvalidResponse"],
  ["silent", "RequestTimeout"], ["unavailable", "AppUnavailable"],
] as const) {
  test(`transport: ${mode} and resource cleanup`, async () => {
    const fake = fakeRuntime(mode);
    assert.equal(await Effect.runPromise(program(fake.runtime)), expected);
    assert.ok(fake.ports.every(p => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0));
  });
}

test("independent concurrent requests and a fresh worker scope", async () => {
  const fake = fakeRuntime("status");
  assert.deepEqual(await Promise.all([Effect.runPromise(program(fake.runtime)), Effect.runPromise(program(fake.runtime))]), ["Connected", "Connected"]);
  assert.equal(await Effect.runPromise(program(fake.runtime)), "Connected");
  assert.equal(fake.connections, 3);
  assert.ok(fake.ports.every(p => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0));
});

test("interruption closes the native connection", async () => {
  const fake = fakeRuntime("silent");
  const controller = new AbortController();
  const result = Effect.runPromise(program(fake.runtime), { signal: controller.signal });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(result);
  assert.ok(fake.ports.every(p => p.closed && p.onMessage.size === 0 && p.onDisconnect.size === 0));
});
