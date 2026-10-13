import { useContext, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Effect } from "effect";
import { toast } from "sonner";
import {
  VaultClient,
  VaultError,
  type EntrySummary,
  type EntryUpdate,
  type ErrorCode,
  type NewEntry,
  type VaultStatus,
} from "./VaultClient";
import { VaultRuntime } from "./runtime";

interface Snapshot {
  status: VaultStatus | "loading";
  entries: ReadonlyArray<EntrySummary>;
}

interface RevealedPassword {
  id: string;
  password: string;
  notes: string;
}

interface EditTarget {
  id: string;
  /** Notes are editable only when they were revealed before opening the editor. */
  notes: string | null;
}

const messages: Record<ErrorCode, string> = {
  Storage:
    "Impossible de lire ou d'enregistrer le coffre. Vérifie l'espace disque et les permissions, puis déverrouille-le à nouveau.",
  InUse: "Le coffre est déjà ouvert dans une autre instance de Cairn.",
  AlreadyExists: "Un coffre existe déjà. Déverrouille-le pour continuer.",
  Missing: "Le fichier du coffre est introuvable.",
  Locked: "Le coffre est verrouillé. Déverrouille-le pour continuer.",
  InvalidInput:
    "Vérifie les champs et leur longueur. Le mot de passe maître doit comporter au moins 12 caractères.",
  InvalidVault:
    "Le fichier du coffre est endommagé ou son format est invalide. Il n'a pas été remplacé.",
  UnsupportedVersion: "Ce coffre nécessite une autre version de Cairn.",
  UnlockFailed: "Mot de passe incorrect ou coffre endommagé.",
  Randomness: "Windows n'a pas pu générer les données aléatoires nécessaires. Réessaie.",
  ChangedOnDisk:
    "Le coffre a été modifié sur disque. Verrouille-le puis déverrouille-le avant de continuer.",
  Unavailable: "Impossible de joindre le coffre. Ouvre Cairn dans l'application Windows.",
  InvalidResponse: "La réponse de l'application est invalide. Redémarre Cairn.",
};

const loadSnapshot = Effect.gen(function* () {
  const vault = yield* VaultClient;
  const status = yield* vault.status;
  const entries = status === "unlocked" ? yield* vault.list : [];

  return { status, entries };
});

function useRuntime() {
  const runtime = useContext(VaultRuntime);

  if (!runtime) throw new Error("Vault runtime is missing");

  return runtime;
}

export function useVault() {
  const runtime = useRuntime();
  const [snapshot, setSnapshot] = useState<Snapshot>({ status: "loading", entries: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedPassword | null>(null);
  const epoch = useRef(0);
  const revealEpoch = useRef(0);

  function hideSecret() {
    revealEpoch.current++;
    setRevealed(null);
  }

  function clearSession() {
    epoch.current++;
    setSnapshot({ status: "locked", entries: [] });
    setRevealed(null);
    setAdding(false);
    setEditing(null);
    setDeleting(null);
    setBusy(false);
  }

  function execute<A>(
    effect: Effect.Effect<A, VaultError, VaultClient>,
    success: (value: A) => void,
    clearOnFailure = false,
    onError: (message: string) => void = setError,
  ) {
    const current = ++epoch.current;
    setBusy(true);
    setError(null);
    void runtime
      .runPromise(
        effect.pipe(
          Effect.match({
            onSuccess: (value) => {
              if (epoch.current !== current) return;
              setBusy(false);
              success(value);
            },
            onFailure: (failure) => {
              if (epoch.current !== current) return;
              setBusy(false);

              if (clearOnFailure || failure.code === "Locked" || failure.code === "Storage")
                clearSession();
              onError(messages[failure.code]);
            },
          }),
        ),
      )
      .catch(() => {
        if (epoch.current !== current) return;
        clearSession();
        onError(messages.Unavailable);
      });
  }

  useEffect(() => {
    let disposed = false;

    const subscription = listen("vault-locked", () => {
      if (!disposed) clearSession();
    });

    void subscription.then(
      () => {
        if (!disposed) execute(loadSnapshot, setSnapshot);
      },
      () => {
        if (!disposed) setError(messages.Unavailable);
      },
    );

    return () => {
      disposed = true;
      epoch.current++;
      void subscription.then(
        (unlisten) => unlisten(),
        () => {},
      );
    };
  }, [runtime]);

  useEffect(() => {
    if (!revealed) return;
    const timeout = window.setTimeout(() => setRevealed(null), 30_000);

    return () => window.clearTimeout(timeout);
  }, [revealed]);

  function authenticate(password: string) {
    toast.dismiss("master-password-error");
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;

        if (snapshot.status === "missing") yield* vault.create(password);
        else yield* vault.unlock(password);

        return yield* loadSnapshot;
      }),
      setSnapshot,
      false,
      (message) => toast.error(message, { id: "master-password-error" }),
    );
  }

  function save(entry: NewEntry) {
    setAdding(false);
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.save(entry);

        return yield* loadSnapshot;
      }),
      setSnapshot,
      true,
    );
  }

  function startEdit(id: string) {
    setEditing({ id, notes: revealed?.id === id ? revealed.notes : null });
    hideSecret();
  }

  function update(id: string, entry: EntryUpdate) {
    setEditing(null);
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.update(id, entry);

        return yield* loadSnapshot;
      }),
      setSnapshot,
      true,
    );
  }

  function remove(id: string) {
    setDeleting(null);
    hideSecret();
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.remove(id);

        return yield* loadSnapshot;
      }),
      setSnapshot,
      true,
    );
  }

  function lock() {
    clearSession();
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.lock;

        return yield* loadSnapshot;
      }),
      setSnapshot,
    );
  }

  function reveal(id: string) {
    if (revealed?.id === id) {
      setRevealed(null);

      return;
    }

    hideSecret();
    const currentReveal = revealEpoch.current;
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;

        return yield* vault.reveal(id);
      }),
      (secret) => {
        if (revealEpoch.current === currentReveal) setRevealed({ id, ...secret });
      },
    );
  }

  return {
    snapshot,
    busy,
    error,
    adding,
    editing,
    deleting,
    revealed,
    authenticate,
    save,
    startEdit,
    stopEdit: () => setEditing(null),
    update,
    setDeleting,
    remove,
    lock,
    reveal,
    setAdding,
    hideSecret,
    retry: () => execute(loadSnapshot, setSnapshot),
  };
}
