import { Data } from "effect";
import type { ClientErrorCode } from "./protocol";

export class CairnClientError extends Data.TaggedError("CairnClientError")<{
  readonly code: ClientErrorCode;
}> {}
