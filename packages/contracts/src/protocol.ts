import { Schema } from "effect";

export const HOST_NAME = "com.hezaerd.cairn";
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 16 * 1024;
export const REQUEST_TIMEOUT_MS = 2_000;

export const RequestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}(?![\s\S])/));
export const StatusRequest = Schema.Struct({
  version: Schema.Literal(PROTOCOL_VERSION),
  requestId: RequestId,
  type: Schema.Literal("GetStatus"),
});
export type StatusRequest = typeof StatusRequest.Type;
export const StatusResponse = Schema.Struct({
  version: Schema.Literal(PROTOCOL_VERSION),
  requestId: RequestId,
  type: Schema.Literal("Status"),
  appVersion: Schema.String.check(Schema.isPattern(/^[0-9]+\.[0-9]+\.[0-9]+(?![\s\S])/)),
});
export type StatusResponse = typeof StatusResponse.Type;
export const ErrorCode = Schema.Literals([
  "InvalidRequest", "UnsupportedVersion", "AppUnavailable", "RequestTimeout", "ProtocolMismatch",
]);
export const ErrorResponse = Schema.Struct({
  version: Schema.Literal(PROTOCOL_VERSION),
  requestId: Schema.Union([RequestId, Schema.Null]),
  type: Schema.Literal("Error"),
  code: ErrorCode,
});
export const Response = Schema.Union([StatusResponse, ErrorResponse]);
export type Response = typeof Response.Type;

// Never silently strip unrecognized fields at a process boundary.
export const decodeRequest = Schema.decodeUnknownSync(StatusRequest, { onExcessProperty: "error" });
export const decodeResponse = Schema.decodeUnknownSync(Response, { onExcessProperty: "error" });

export const ClientErrorCode = Schema.Literals([
  ...ErrorCode.literals, "HostUnavailable", "ConnectionLost", "InvalidResponse",
]);
export type ClientErrorCode = typeof ClientErrorCode.Type;
export const PopupResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Connected"), appVersion: StatusResponse.fields.appVersion }),
  Schema.Struct({ type: Schema.Literal("Unavailable"), code: ClientErrorCode }),
]);
export type PopupResult = typeof PopupResult.Type;
export const decodePopupResult = Schema.decodeUnknownSync(PopupResult, { onExcessProperty: "error" });
