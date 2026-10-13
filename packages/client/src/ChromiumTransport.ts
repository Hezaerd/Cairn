import { Effect, Layer } from "effect";
import { HOST_NAME, MAX_MESSAGE_BYTES, REQUEST_TIMEOUT_MS, decodeResponse, type Response } from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { NativeTransport } from "./NativeTransport";

export type NativeRuntime = Pick<typeof chrome.runtime, "connectNative" | "lastError">;

export function chromiumTransport(runtime: NativeRuntime) {
  return Layer.effect(NativeTransport, Effect.gen(function* () {
    const connection = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const port = runtime.connectNative(HOST_NAME);
          const state: { disconnected?: CairnClientError } = {};
          const onDisconnect = () => {
            const message = runtime.lastError?.message ?? "";
            state.disconnected = new CairnClientError({
              code: /not found|not registered|forbidden|failed to start|not supported/i.test(message)
                ? "HostUnavailable" : "ConnectionLost",
            });
          };
          port.onDisconnect.addListener(onDisconnect);
          return { port, state, onDisconnect };
        },
        catch: () => new CairnClientError({ code: "HostUnavailable" }),
      }),
      ({ port, onDisconnect }) => Effect.sync(() => {
        port.onDisconnect.removeListener(onDisconnect);
        port.disconnect();
      }),
    );
    return NativeTransport.of({
      request: (request) => Effect.callback<Response, CairnClientError>((resume) => {
        const { port, state } = connection;
        if (state.disconnected) {
          resume(Effect.fail(state.disconnected));
          return;
        }
        let settled = false;
        let cleanup = () => {};
        const finish = (result: Effect.Effect<Response, CairnClientError>) => {
          if (settled) return;
          settled = true;
          cleanup();
          resume(result);
        };
        const onMessage = (message: unknown) => {
          try {
            if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES) throw new Error();
            const response = decodeResponse(message);
            if (response.requestId !== request.requestId) throw new Error();
            finish(Effect.succeed(response));
          } catch {
            finish(Effect.fail(new CairnClientError({ code: "InvalidResponse" })));
          }
        };
        const onDisconnect = () => finish(Effect.fail(
          state.disconnected ?? new CairnClientError({ code: "ConnectionLost" }),
        ));
        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);
        cleanup = () => {
          port.onMessage.removeListener(onMessage);
          port.onDisconnect.removeListener(onDisconnect);
        };
        try { port.postMessage(request); }
        catch { finish(Effect.fail(new CairnClientError({ code: "ConnectionLost" }))); }
        return Effect.sync(() => {
          settled = true;
          cleanup();
        });
      }).pipe(Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT_MS,
        orElse: () => Effect.fail(new CairnClientError({ code: "RequestTimeout" })),
      })),
    });
  }));
}
