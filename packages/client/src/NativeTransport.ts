import { Context, Effect } from "effect";
import type { Request, Response } from "@cairn/contracts";
import type { CairnClientError } from "@cairn/contracts/errors";

export class NativeTransport extends Context.Service<
  NativeTransport,
  {
    readonly request: (request: Request) => Effect.Effect<Response, CairnClientError>;
  }
>()("cairn/NativeTransport") {}
