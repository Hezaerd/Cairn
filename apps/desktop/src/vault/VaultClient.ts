import { Context, Data, Effect, Schema } from "effect";

export const VaultStatus = Schema.Literals(["missing", "locked", "unlocked", "recovery"]);

export type VaultStatus = typeof VaultStatus.Type;

export const EntrySummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
  hasPassword: Schema.Boolean,
  hasTotp: Schema.Boolean,
});

export type EntrySummary = typeof EntrySummary.Type;

export const EntrySecret = Schema.Struct({ password: Schema.String, notes: Schema.String });

export type EntrySecret = typeof EntrySecret.Type;

/** The password may be empty when `totp`, a Base32 key or an `otpauth://` link, isn't. */
export const NewEntry = Schema.Struct({
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
  password: Schema.String,
  notes: Schema.String,
  totp: Schema.String,
});

export type NewEntry = typeof NewEntry.Type;

/** A null password, notes, or key keeps the stored value. An empty key removes it. */
export const EntryUpdate = Schema.Struct({
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
  password: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  totp: Schema.NullOr(Schema.String),
});

export type EntryUpdate = typeof EntryUpdate.Type;

/** An entry's current authenticator code, and the seconds it stays valid. */
export const TotpCode = Schema.Struct({
  code: Schema.String,
  period: Schema.Int,
  remaining: Schema.Int,
});

export type TotpCode = typeof TotpCode.Type;

/** An account read from an authenticator link, without its key. */
export const OtpPreview = Schema.Struct({ issuer: Schema.String, account: Schema.String });

export type OtpPreview = typeof OtpPreview.Type;

/** Rust checks the same bounds and refuses a selection without any character set. */
export const PasswordOptions = Schema.Struct({
  length: Schema.Int.check(Schema.isBetween({ minimum: 8, maximum: 128 })),
  lowercase: Schema.Boolean,
  uppercase: Schema.Boolean,
  digits: Schema.Boolean,
  symbols: Schema.Boolean,
  avoidAmbiguous: Schema.Boolean,
});

export type PasswordOptions = typeof PasswordOptions.Type;

export const ErrorCode = Schema.Literals([
  "Storage",
  "InUse",
  "AlreadyExists",
  "Missing",
  "Locked",
  "InvalidInput",
  "InvalidVault",
  "UnsupportedVersion",
  "UnlockFailed",
  "Randomness",
  "ChangedOnDisk",
  "Unavailable",
  "InvalidResponse",
]);

export type ErrorCode = typeof ErrorCode.Type;

export class VaultError extends Data.TaggedError("VaultError")<{
  readonly code: ErrorCode;
}> {}

export class VaultClient extends Context.Service<
  VaultClient,
  {
    readonly status: Effect.Effect<VaultStatus, VaultError>;
    readonly create: (password: string) => Effect.Effect<void, VaultError>;
    readonly unlock: (password: string) => Effect.Effect<void, VaultError>;
    readonly lock: Effect.Effect<void, VaultError>;
    readonly list: Effect.Effect<ReadonlyArray<EntrySummary>, VaultError>;
    readonly save: (entry: NewEntry) => Effect.Effect<void, VaultError>;
    readonly update: (id: string, entry: EntryUpdate) => Effect.Effect<void, VaultError>;
    readonly remove: (id: string) => Effect.Effect<void, VaultError>;
    readonly reveal: (id: string) => Effect.Effect<EntrySecret, VaultError>;
    readonly generate: (options: PasswordOptions) => Effect.Effect<string, VaultError>;
    readonly code: (id: string) => Effect.Effect<TotpCode, VaultError>;
    /** The links found in a picture's QR codes. */
    readonly scanQr: (image: Uint8Array) => Effect.Effect<string, VaultError>;
    readonly readOtp: (text: string) => Effect.Effect<ReadonlyArray<OtpPreview>, VaultError>;
    /** `targets[i]` is the entry that gets the i-th account's key, or null for a new entry. */
    readonly importOtp: (
      text: string,
      targets: ReadonlyArray<string | null>,
    ) => Effect.Effect<void, VaultError>;
  }
>()("cairn/VaultClient") {}
