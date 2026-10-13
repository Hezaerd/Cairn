import { invoke, isTauri } from "@tauri-apps/api/core";
import { Data, Effect, Schema } from "effect";
import { toast } from "sonner";

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

function offer(version: string) {
  toast(`Cairn ${version} est disponible`, {
    id: "update-available",
    duration: Infinity,
    description: "Cairn se fermera pendant l'installation.",
    action: {
      label: "Installer",
      onClick: () => {
        toast.loading("Téléchargement de la mise à jour…", { id: "update-available" });
        void Effect.runPromise(
          installUpdate.pipe(
            Effect.catch(() =>
              Effect.sync(() =>
                toast.error("La mise à jour a échoué.", { id: "update-available" }),
              ),
            ),
          ),
        );
      },
    },
  });
}

/** A failed check stays silent: being offline shouldn't nag. */
export function checkForUpdateOnLaunch() {
  if (!isTauri()) return;

  void Effect.runPromise(
    checkForUpdate.pipe(
      Effect.tap((version) => Effect.sync(() => version && offer(version))),
      Effect.ignore,
    ),
  );
}
