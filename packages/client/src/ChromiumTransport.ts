import { Effect, Layer } from "effect";
import {
  HOST_NAME,
  MAX_MESSAGE_BYTES,
  REQUEST_TIMEOUT_MS,
  decodeResponse,
  replyTypes,
  type Request,
  type Response,
} from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { NativeTransport } from "./NativeTransport";

// Only the port operations used by this adapter are required from the browser
// or from an in-memory transport in tests.
export interface NativePort {
  readonly onMessage: Pick<chrome.runtime.Port["onMessage"], "addListener" | "removeListener">;
  readonly onDisconnect: Pick<
    chrome.runtime.Port["onDisconnect"],
    "addListener" | "removeListener"
  >;
  readonly postMessage: (request: Request) => void;
  readonly disconnect: () => void;
}

export interface NativeRuntime {
  readonly connectNative: (hostName: string) => NativePort;
  readonly lastError?: chrome.runtime.LastError;
}

interface ConnectionState {
  disconnected?: CairnClientError;
}

export function chromiumTransport(runtime: NativeRuntime) {
  return Layer.effect(
    NativeTransport,
    Effect.gen(function* () {
      const connection = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            const port = runtime.connectNative(HOST_NAME);
            const state: ConnectionState = {};

            const onDisconnect = () => {
              const message = runtime.lastError?.message ?? "";
              state.disconnected = new CairnClientError({
                code: /not found|not registered|forbidden|failed to start|not supported/i.test(
                  message,
                )
                  ? "HostUnavailable"
                  : "ConnectionLost",
              });
            };

            port.onDisconnect.addListener(onDisconnect);

            return { port, state, onDisconnect };
          },
          catch: () => new CairnClientError({ code: "HostUnavailable" }),
        }),
        ({ port, onDisconnect }) =>
          Effect.sync(() => {
            port.onDisconnect.removeListener(onDisconnect);
            port.disconnect();
          }),
      );

      return NativeTransport.of({
        request: (request) =>
          Effect.callback<Response, CairnClientError>((resume) => {
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

            const onMessage: Parameters<NativePort["onMessage"]["addListener"]>[0] = (message) => {
              try {
                if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_MESSAGE_BYTES)
                  throw new Error();
                const response = decodeResponse(message);

                if (
                  response.requestId !== request.requestId ||
                  (response.type !== "Error" && response.type !== replyTypes[request.type])
                )
                  throw new Error();
                finish(Effect.succeed(response));
              } catch {
                finish(Effect.fail(new CairnClientError({ code: "InvalidResponse" })));
              }
            };

            const onDisconnect = () =>
              finish(
                Effect.fail(state.disconnected ?? new CairnClientError({ code: "ConnectionLost" })),
              );

            port.onMessage.addListener(onMessage);
            port.onDisconnect.addListener(onDisconnect);
            cleanup = () => {
              port.onMessage.removeListener(onMessage);
              port.onDisconnect.removeListener(onDisconnect);
            };

            try {
              port.postMessage(request);
            } catch {
              finish(Effect.fail(new CairnClientError({ code: "ConnectionLost" })));
            }

            return Effect.sync(() => {
              settled = true;
              cleanup();
            });
          }).pipe(
            Effect.timeoutOrElse({
              duration: REQUEST_TIMEOUT_MS,
              orElse: () => Effect.fail(new CairnClientError({ code: "RequestTimeout" })),
            }),
          ),
      });
    }),
  );
}
