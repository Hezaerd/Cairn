import { invoke } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";

export class ConnectorError extends Data.TaggedError("ConnectorError") {}

const ExtensionFolder = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["dev", "missing"]) }),
  Schema.Struct({ state: Schema.Literal("installed"), path: Schema.String }),
]);

export type ExtensionFolder = typeof ExtensionFolder.Type;

/** Where the installer put the release extension. Debug builds report `dev`. */
export const extensionFolder = Effect.tryPromise({
  try: () => invoke("connector_extension_folder"),
  catch: () => new ConnectorError(),
}).pipe(
  Effect.flatMap((response) =>
    Effect.try({
      try: () => Schema.decodeUnknownSync(ExtensionFolder)(response),
      catch: () => new ConnectorError(),
    }),
  ),
);

export const openExtensionFolder = Effect.tryPromise({
  try: () => invoke("connector_open_extension_folder"),
  catch: () => new ConnectorError(),
});
