import { Effect, Layer } from "effect";
import { CairnClient, CairnClientLive } from "@cairn/client/CairnClient";
import { chromiumTransport } from "@cairn/client/ChromiumTransport";
import type { PopupResult } from "@cairn/contracts";

// Each popup request owns a short-lived native connection. No secrets or state
// survive in the worker, and its suspension does not require recovery logic.
chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("index.html")) return false;
  if (typeof message !== "object" || message === null ||
      Object.keys(message).length !== 1 || !("type" in message) || message.type !== "GetStatus") return false;

  const program = Effect.gen(function* () {
    const client = yield* CairnClient;
    return yield* client.getStatus;
  }).pipe(
    Effect.provide(CairnClientLive.pipe(Layer.provide(chromiumTransport(chrome.runtime)))),
    Effect.match({
      onSuccess: (status): PopupResult => ({ type: "Connected", appVersion: status.appVersion }),
      onFailure: (error): PopupResult => ({ type: "Unavailable", code: error.code }),
    }),
  );
  void Effect.runPromise(program).then(sendResponse, () => sendResponse({ type: "Unavailable", code: "ConnectionLost" }));
  return true;
});
