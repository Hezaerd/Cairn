import { Effect, Option, Schema } from "effect";

/**
 * A field of a persisted store that decodes to `fallback` when it's missing or
 * no longer valid, so one bad field doesn't reset the others.
 */
export function storedField<S extends Schema.Top>(schema: S, fallback: S["Type"]) {
  const valid = Schema.catchDecoding<S>(() => Effect.succeed(Option.some(fallback)))(schema);

  return Schema.withDecodingDefaultType<typeof valid>(Effect.succeed(fallback))(valid);
}
