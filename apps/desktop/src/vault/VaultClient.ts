import { Context, Data, Effect, Schema } from "effect";

export const VaultStatus = Schema.Literals(["missing", "locked", "unlocked", "recovery"]);

export type VaultStatus = typeof VaultStatus.Type;

export const EntrySummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
});

export type EntrySummary = typeof EntrySummary.Type;

export const EntrySecret = Schema.Struct({ password: Schema.String, notes: Schema.String });

export type EntrySecret = typeof EntrySecret.Type;

export const NewEntry = Schema.Struct({
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
  password: Schema.String,
  notes: Schema.String,
});

export type NewEntry = typeof NewEntry.Type;

/** A null password or notes keeps the stored value. */
export const EntryUpdate = Schema.Struct({
  name: Schema.String,
  site: Schema.String,
  username: Schema.String,
  password: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
});

export type EntryUpdate = typeof EntryUpdate.Type;

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
  }
>()("cairn/VaultClient") {}
