import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { Effect, Layer, Option, Schema } from "effect";
import {
  EntrySecret,
  EntrySummary,
  ErrorCode,
  VaultClient,
  VaultError,
  VaultStatus,
} from "./VaultClient";

const decodeError = Schema.decodeUnknownOption(ErrorCode);

export function request<A>(command: string, schema: Schema.Codec<A>, args?: InvokeArgs) {
  return Effect.tryPromise({
    try: () => invoke(command, args),
    catch: (cause) =>
      new VaultError({ code: Option.getOrElse(decodeError(cause), () => "Unavailable") }),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(response),
        catch: () => new VaultError({ code: "InvalidResponse" }),
      }),
    ),
  );
}

export const VaultClientLive = Layer.succeed(
  VaultClient,
  VaultClient.of({
    status: request("vault_status", VaultStatus),
    create: (password) => request("create_vault", Schema.Null, { password }).pipe(Effect.asVoid),
    unlock: (password) => request("unlock_vault", Schema.Null, { password }).pipe(Effect.asVoid),
    lock: request("lock_vault", Schema.Null).pipe(Effect.asVoid),
    list: request("list_entries", Schema.Array(EntrySummary)),
    save: (entry) => request("save_entry", Schema.Null, { entry }).pipe(Effect.asVoid),
    update: (id, entry) => request("update_entry", Schema.Null, { id, entry }).pipe(Effect.asVoid),
    remove: (id) => request("delete_entry", Schema.Null, { id }).pipe(Effect.asVoid),
    reveal: (id) => request("reveal_password", EntrySecret, { id }),
  }),
);
