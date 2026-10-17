import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";

export class StartupError extends Data.TaggedError("StartupError") {}

const StartupStatus = Schema.Struct({
  available: Schema.Boolean,
  enabled: Schema.Boolean,
});

export type StartupStatus = typeof StartupStatus.Type;

function command<A>(name: string, schema: Schema.Codec<A>, args?: InvokeArgs) {
  return Effect.tryPromise({
    try: () => invoke(name, args),
    catch: () => new StartupError(),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(response),
        catch: () => new StartupError(),
      }),
    ),
  );
}

export const startupStatus = command("startup_status", StartupStatus);

export const setStartup = (enabled: boolean) =>
  command("startup_set", Schema.Null, { enabled }).pipe(Effect.asVoid);
