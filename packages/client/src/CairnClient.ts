import { Context, Effect, Layer } from "effect";
import { PROTOCOL_VERSION, type StatusResponse } from "@cairn/contracts";
import { CairnClientError } from "@cairn/contracts/errors";
import { NativeTransport } from "./NativeTransport";

export class CairnClient extends Context.Service<CairnClient, {
  readonly getStatus: Effect.Effect<StatusResponse, CairnClientError>;
}>()("cairn/CairnClient") {}

export const CairnClientLive = Layer.effect(CairnClient, Effect.gen(function* () {
  const transport = yield* NativeTransport;
  return CairnClient.of({
    getStatus: Effect.gen(function* () {
      const response = yield* transport.request({
        version: PROTOCOL_VERSION, requestId: crypto.randomUUID(), type: "GetStatus",
      });
      if (response.type === "Error") return yield* Effect.fail(new CairnClientError({ code: response.code }));
      return response;
    }),
  });
}));
