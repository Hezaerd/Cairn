import { invoke, isTauri } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";
import { toast } from "sonner";
import type { Messages } from "../i18n/en-US";

class UpdateError extends Data.TaggedError("UpdateError") {}

const decodeVersion = Schema.decodeUnknownEffect(Schema.NullOr(Schema.String));

const checkForUpdate = Effect.tryPromise({
  try: () => invoke("update_check"),
  catch: () => new UpdateError(),
}).pipe(
  Effect.flatMap(decodeVersion),
  Effect.mapError(() => new UpdateError()),
);

const installUpdate = Effect.tryPromise({
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
