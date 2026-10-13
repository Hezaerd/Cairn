import { Context, Effect } from "effect";
import type { StatusRequest, Response } from "@cairn/contracts";
import type { CairnClientError } from "@cairn/contracts/errors";

export class NativeTransport extends Context.Service<
  NativeTransport,
  {
    readonly request: (request: StatusRequest) => Effect.Effect<Response, CairnClientError>;
  }
>()("cairn/NativeTransport") {}
