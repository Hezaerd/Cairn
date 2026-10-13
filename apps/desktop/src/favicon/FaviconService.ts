import { invoke } from "@tauri-apps/api/core";
import { Context, Data, Effect, Layer, Schema } from "effect";

const CachedIcon = Schema.NullOr(
  Schema.Struct({
    session: Schema.String,
    image: Schema.NullOr(Schema.String),
    stale: Schema.Boolean,
  }),
);

class FaviconError extends Data.TaggedError("FaviconError") {}

export class FaviconService extends Context.Service<
  FaviconService,
  {
    readonly cached: (id: string) => Effect.Effect<typeof CachedIcon.Type, FaviconError>;
    readonly refresh: (id: string, session: string) => Effect.Effect<string | null, FaviconError>;
  }
>()("cairn/FaviconService") {}

function request<A>(command: string, schema: Schema.Codec<A>, args: Record<string, string>) {
  return Effect.tryPromise({
    try: () => invoke(command, args),
    catch: () => new FaviconError(),
  }).pipe(
    Effect.flatMap((value) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(value),
        catch: () => new FaviconError(),
      }),
    ),
  );
}

export const FaviconServiceLive = Layer.succeed(
  FaviconService,
  FaviconService.of({
    cached: (id) => request("favicon_cached", CachedIcon, { id }),
    refresh: (id, session) =>
      request("favicon_refresh", Schema.NullOr(Schema.String), { id, session }),
  }),
);
