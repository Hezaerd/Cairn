import { Schema } from "effect";
import { MAX_PICKER_HEIGHT } from "./picker";

export { MAX_PICKER_HEIGHT, type PageCommand } from "./picker";

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

/** C0 and C1 control characters and DEL, as Rust's `char::is_control` defines them. */
const isControl = (char: string) => {
  const code = char.codePointAt(0) ?? 0;

  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
};

/** Text without control characters, so it can't break a signed message's lines. */
const Line = Schema.String.check(Schema.makeFilter((value: string) => ![...value].some(isControl)));

/** May be empty, on a page that asks for the password alone. */
export const Username = Line.check(Schema.isMaxLength(1024));

export const Password = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));

/** HMAC-SHA256 of a password, keyed with the request's challenge. */
export const Proof = base64url(32);

export const CheckLoginRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("CheckLogin"),
  origin: Origin,
  username: Username,
  proof: Proof,
  ...auth,
});

export const SaveLoginRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("SaveLogin"),
  origin: Origin,
  name: Line.check(
    Schema.isMaxLength(256),
    Schema.makeFilter((name: string) => name.trim().length > 0),
  ),
  username: Username,
  password: Password,
  ...auth,
});

export const UpdateLoginRequest = Schema.Struct({
  ...header,
  type: Schema.Literal("UpdateLogin"),
  origin: Origin,
  entryId: EntryId,
  password: Password,
  ...auth,
});

export const Request = Schema.Union([
  StatusRequest,
  ChallengeRequest,
  PairRequest,
  ListLoginsRequest,
  GetLoginRequest,
  CheckLoginRequest,
  SaveLoginRequest,
  UpdateLoginRequest,
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

/** The code comes from the SHA-256 of `nonce` and the browser's key. */
export const PairingRequestedResponse = Schema.Struct({
  ...header,
  type: Schema.Literal("PairingRequested"),
  nonce: base64url(32),
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

const checkHeader = { ...header, type: Schema.Literal("LoginCheck") };

/** `entry` is the login whose password changed, sent only with `Changed`. */
export const LoginCheckResponse = Schema.Union([
  Schema.Struct({ ...checkHeader, result: Schema.Literals(["New", "Known"]) }),
  Schema.Struct({ ...checkHeader, result: Schema.Literal("Changed"), entry: LoginSummary }),
]);

export type LoginCheck = typeof LoginCheckResponse.Type;

export const SavedResponse = Schema.Struct({ ...header, type: Schema.Literal("Saved") });

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
  /** Another browser asked to pair at the same time, so Cairn refused both. */
  "PairingConflict",
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
  LoginCheckResponse,
  SavedResponse,
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
  CheckLogin: "LoginCheck",
  SaveLogin: "Saved",
  UpdateLogin: "Saved",
} as const satisfies Record<Request["type"], Response["type"]>;

// Never silently strip unrecognized fields at a process boundary.
export const decodeRequest = Schema.decodeUnknownSync(Request, { onExcessProperty: "error" });

export const decodeResponse = Schema.decodeUnknownSync(Response, { onExcessProperty: "error" });

type Unsigned<T extends { readonly signature: string }> = Omit<T, "signature">;

/**
 * The bytes a paired extension signs. Must match `signed_message` in
 * `crates/protocol`. Only the last field can contain a newline.
 */
export function signedMessage(
  request:
    | Unsigned<typeof ListLoginsRequest.Type>
    | Unsigned<typeof GetLoginRequest.Type>
    | Unsigned<typeof CheckLoginRequest.Type>
    | Unsigned<typeof SaveLoginRequest.Type>
    | Unsigned<typeof UpdateLoginRequest.Type>,
) {
  const start = `cairn-bridge-v1\n${request.challenge}\n${request.type}\n${request.origin}\n`;

  switch (request.type) {
    case "ListLogins":
      return start;
    case "GetLogin":
      return `${start}${request.entryId}`;
    case "CheckLogin":
      return `${start}${request.proof}\n${request.username}`;
    case "SaveLogin":
      return `${start}${request.name}\n${request.username}\n${request.password}`;
    case "UpdateLogin":
      return `${start}${request.entryId}\n${request.password}`;
  }
}

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

/** Messages from the content script in a page's top frame to the service worker. */
export const PageRequest = Schema.Union([
  /** The page shows a login form. */
  Schema.Struct({ type: Schema.Literal("FormFound") }),
  /** The user focused a login field or clicked its icon, so the picker may open. */
  Schema.Struct({ type: Schema.Literal("OpenPicker") }),
  Schema.Struct({ type: Schema.Literal("ClosePicker") }),
  /** The user submitted a login or sign-up form with these values. */
  Schema.Struct({ type: Schema.Literal("Submitted"), username: Username, password: Password }),
  /** The submitted form went away, or a new page shows no login form. */
  Schema.Struct({ type: Schema.Literal("FormGone") }),
]);

export type PageRequest = typeof PageRequest.Type;

export const decodePageRequest = Schema.decodeUnknownResult(PageRequest, {
  onExcessProperty: "error",
});

/**
 * What the content script may know about the site: whether Cairn has logins
 * for it, never which ones. `Offer` asks it to open the save banner.
 */
export const PageResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("Matches") }),
  Schema.Struct({ type: Schema.Literal("Locked") }),
  Schema.Struct({ type: Schema.Literal("None") }),
  Schema.Struct({ type: Schema.Literal("Offer") }),
]);

export type PageResult = typeof PageResult.Type;

/** Messages from the picker frame to the service worker. */
export const PickerRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("GetSuggestions") }),
  Schema.Struct({ type: Schema.Literal("Fill"), entryId: EntryId }),
  Schema.Struct({ type: Schema.Literal("Close") }),
  Schema.Struct({
    type: Schema.Literal("Resize"),
    height: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_PICKER_HEIGHT })),
  }),
]);

export type PickerRequest = typeof PickerRequest.Type;

export const decodePickerRequest = Schema.decodeUnknownResult(PickerRequest, {
  onExcessProperty: "error",
});

export const PickerResult = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Logins"),
    host: Schema.String,
    logins: Schema.Array(LoginSummary),
  }),
  Schema.Struct({ type: Schema.Literal("Locked") }),
  Schema.Struct({ type: Schema.Literal("Unavailable"), code: ClientErrorCode }),
  Schema.Struct({ type: Schema.Literal("Filled") }),
  Schema.Struct({ type: Schema.Literal("NoForm") }),
  Schema.Struct({ type: Schema.Literal("Done") }),
]);

export type PickerResult = typeof PickerResult.Type;

export const decodePickerResult = Schema.decodeUnknownSync(PickerResult, {
  onExcessProperty: "error",
});

/** Messages from the save banner to the service worker. */
export const SaveRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("GetOffer") }),
  Schema.Struct({ type: Schema.Literal("Save"), name: SaveLoginRequest.fields.name }),
  Schema.Struct({ type: Schema.Literal("Update") }),
  Schema.Struct({ type: Schema.Literal("Dismiss") }),
  Schema.Struct({
    type: Schema.Literal("Resize"),
    height: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_PICKER_HEIGHT })),
  }),
]);

export type SaveRequest = typeof SaveRequest.Type;

export const decodeSaveRequest = Schema.decodeUnknownResult(SaveRequest, {
  onExcessProperty: "error",
});

/**
 * `New` offers to save a login, `Changed` to update the password of the
 * login named `name`. `Known` means there's nothing to save.
 */
export const SaveResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("New"), host: Schema.String, username: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("Changed"),
    host: Schema.String,
    username: Schema.String,
    name: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("Known") }),
  Schema.Struct({ type: Schema.Literal("Locked") }),
  Schema.Struct({ type: Schema.Literal("Unavailable"), code: ClientErrorCode }),
  Schema.Struct({ type: Schema.Literal("Saved") }),
  Schema.Struct({ type: Schema.Literal("Done") }),
]);

export type SaveResult = typeof SaveResult.Type;

export const decodeSaveResult = Schema.decodeUnknownSync(SaveResult, {
  onExcessProperty: "error",
});
