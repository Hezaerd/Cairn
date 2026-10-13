import { Schema } from "effect";

export const HOST_NAME = "com.hezaerd.cairn";

// `as const` keeps the literal type when the value lands in an object literal.
export const PROTOCOL_VERSION = 1 as const;

export const MAX_MESSAGE_BYTES = 16 * 1024;

export const REQUEST_TIMEOUT_MS = 2_000;

export const RequestId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,64}(?![\s\S])/));

/** Unpadded base64url of a fixed number of bytes. */
const base64url = (bytes: number) =>
  Schema.String.check(
    Schema.isPattern(new RegExp(`^[A-Za-z0-9_-]{${Math.ceil((bytes * 4) / 3)}}(?![\\s\\S])`)),
  );

export const PublicKey = base64url(65);

export const ClientId = base64url(32);

export const Challenge = base64url(32);

export const Signature = base64url(64);

export const EntryId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}(?![\s\S])/));

/** An `http` or `https` origin. The app parses it fully. */
export const Origin = Schema.String.check(
  Schema.isPattern(/^https?:\/\/[\x21-\x7e]{1,2040}(?![\s\S])/),
);

const header = {
  version: Schema.Literal(PROTOCOL_VERSION),
  requestId: RequestId,
};

const auth = {
  clientId: ClientId,
  challenge: Challenge,
  signature: Signature,
};

export const StatusRequest = Schema.Struct({ ...header, type: Schema.Literal("GetStatus") });

export const ChallengeRequest = Schema.Struct({ ...header, type: Schema.Literal("GetChallenge") });

export const PairRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("Pair"),
  publicKey: PublicKey,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});

export const ListLoginsRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("ListLogins"),
  origin: Origin,
  ...auth,
});

export const GetLoginRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("GetLogin"),
  origin: Origin,
  entryId: EntryId,
  ...auth,
});

export const Request = Schema.Union([
  StatusRequest,
  ChallengeRequest,
  PairRequest,
  ListLoginsRequest,
  GetLoginRequest,
]);

export type Request = typeof Request.Type;

export const StatusResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("Status"),
  appVersion: Schema.String.check(Schema.isPattern(/^[0-9]+\.[0-9]+\.[0-9]+(?![\s\S])/)),
});

export type StatusResponse = typeof StatusResponse.Type;

export const ChallengeResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("Challenge"),
  challenge: Challenge,
});

export const PairingRequestedResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("PairingRequested"),
});

export const LoginSummary = Schema.Struct({
  id: EntryId,
  name: Schema.String,
  username: Schema.String,
});

export type LoginSummary = typeof LoginSummary.Type;

export const LoginsResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("Logins"),
  logins: Schema.Array(LoginSummary),
});

export const LoginResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("Login"),
  username: Schema.String,
  password: Schema.String,
});

export const ErrorCode = Schema.Literals([
  "InvalidRequest",
  "UnsupportedVersion",
  "AppUnavailable",
  "RequestTimeout",
  "ProtocolMismatch",
  "VaultLocked",
  "NotPaired",
  "Unauthorized",
  "NotFound",
]);

export const ErrorResponse = Schema.Struct({
  version: Schema.Literal(PROTOCOL_VERSION),
  requestId: Schema.Union([RequestId, Schema.Null]),
  type: Schema.Literal("Error"),
  code: ErrorCode,
});

export const Response = Schema.Union([
  StatusResponse,
  ChallengeResponse,
  PairingRequestedResponse,
  LoginsResponse,
  LoginResponse,
  ErrorResponse,
]);

export type Response = typeof Response.Type;

/** The reply types each request accepts, besides `Error`. */
export const replyTypes = {
  GetStatus: "Status",
  GetChallenge: "Challenge",
  Pair: "PairingRequested",
  ListLogins: "Logins",
  GetLogin: "Login",
} as const satisfies Record<Request["type"], Response["type"]>;

// Never silently strip unrecognized fields at a process boundary.
export const decodeRequest = Schema.decodeUnknownSync(Request, { onExcessProperty: "error" });

export const decodeResponse = Schema.decodeUnknownSync(Response, { onExcessProperty: "error" });

/** The bytes a paired extension signs. Must match `signed_message` in `crates/protocol`. */
export const signedMessage = (
  request:
    | Omit<typeof ListLoginsRequest.Type, "signature">
    | Omit<typeof GetLoginRequest.Type, "signature">,
) =>
  request.type === "ListLogins"
    ? `cairn-bridge-v1\n${request.challenge}\nListLogins\n${request.origin}\n`
    : `cairn-bridge-v1\n${request.challenge}\nGetLogin\n${request.origin}\n${request.entryId}`;

export const ClientErrorCode = Schema.Literals([
  ...ErrorCode.literals,
  "HostUnavailable",
  "ConnectionLost",
  "InvalidResponse",
  "KeyUnavailable",
]);

export type ClientErrorCode = typeof ClientErrorCode.Type;

/** Messages from the popup to the service worker. */
export const PopupRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("GetState"), tabId: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("Pair") }),
  Schema.Struct({ type: Schema.Literal("Fill"), tabId: Schema.Int, entryId: EntryId }),
]);

export type PopupRequest = typeof PopupRequest.Type;

export const decodePopupRequest = Schema.decodeUnknownResult(PopupRequest, {
  onExcessProperty: "error",
});

const appVersion = StatusResponse.fields.appVersion;

export const PopupResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Unavailable"), code: ClientErrorCode }),
  Schema.Struct({ type: Schema.Literal("Unpaired"), appVersion }),
  Schema.Struct({ type: Schema.Literal("Pairing"), appVersion, code: Schema.String }),
  Schema.Struct({ type: Schema.Literal("Locked"), appVersion }),
  /** The tab isn't a website, or the extension can't read its address. */
  Schema.Struct({ type: Schema.Literal("NoSite"), appVersion }),
  Schema.Struct({
    type: Schema.Literal("Logins"),
    appVersion,
    host: Schema.String,
    logins: Schema.Array(LoginSummary),
  }),
  Schema.Struct({ type: Schema.Literal("Filled") }),
  Schema.Struct({ type: Schema.Literal("NoForm") }),
]);

export type PopupResult = typeof PopupResult.Type;

export const decodePopupResult = Schema.decodeUnknownSync(PopupResult, {
  onExcessProperty: "error",
});
