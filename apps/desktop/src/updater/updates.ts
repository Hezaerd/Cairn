import { invoke, isTauri, type InvokeArgs } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";
import { toast } from "sonner";
import type { Messages } from "../i18n/en-US";

export class UpdateError extends Data.TaggedError("UpdateError") {}

export const UpdateChannel = Schema.Literals(["stable", "nightly"]);

export type UpdateChannel = typeof UpdateChannel.Type;

const UpdateStatus = Schema.Struct({
  version: Schema.String,
  channel: UpdateChannel,
  enabled: Schema.Boolean,
  available: Schema.NullOr(Schema.String),
});

export type UpdateStatus = typeof UpdateStatus.Type;

function command<A>(name: string, schema: Schema.Codec<A>, args?: InvokeArgs) {
  return Effect.tryPromise({
    try: () => invoke(name, args),
    catch: () => new UpdateError(),
  }).pipe(
    Effect.flatMap((response) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(response),
        catch: () => new UpdateError(),
      }),
    ),
  );
}

export const updateStatus = command("update_status", UpdateStatus);

export const setUpdateChannel = (channel: UpdateChannel) =>
  command("update_set_channel", Schema.Null, { channel }).pipe(Effect.asVoid);

/** Resolves to the waiting version, or `null` when Cairn is up to date. */
export const checkForUpdate = command("update_check", Schema.NullOr(Schema.String));

export const installUpdate = Effect.tryPromise({
  try: () => invoke("update_install"),
  catch: () => new UpdateError(),
});

function offer(version: string, t: Messages["update"]) {
  toast(t.available(version), {
    id: "update-available",
    duration: Infinity,
    description: t.description,
    action: {
      label: t.install,
      onClick: () => {
        toast.loading(t.downloading, { id: "update-available" });
        void Effect.runPromise(
          installUpdate.pipe(
            Effect.catch(() =>
              Effect.sync(() => toast.error(t.failed, { id: "update-available" })),
            ),
          ),
        );
      },
    },
  });
}

/** A failed check stays silent: being offline shouldn't nag. */
export function checkForUpdateOnLaunch(t: Messages["update"]) {
  if (!isTauri()) return;

  void Effect.runPromise(
    checkForUpdate.pipe(
      Effect.tap((version) => Effect.sync(() => version && offer(version, t))),
      Effect.ignore,
    ),
  );
}
