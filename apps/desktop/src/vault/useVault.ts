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
import { useT } from "../i18n/I18nProvider";

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

const loadSnapshot = Effect.gen(function* () {
  const vault = yield* VaultClient;
  const status = yield* vault.status;
  const entries = status === "unlocked" ? yield* vault.list : [];

  return { status, entries };
});

export function useRuntime() {
  const runtime = useContext(VaultRuntime);

  if (!runtime) throw new Error("Vault runtime is missing");

  return runtime;
}

export function useVault() {
  const runtime = useRuntime();
  const t = useT();
  const [snapshot, setSnapshot] = useState<Snapshot>({ status: "loading", entries: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorCode | null>(null);
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
    onError: (code: ErrorCode) => void = setError,
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

              // Invalid input is refused before anything is written, so the session stays.
              if (
                (clearOnFailure && failure.code !== "InvalidInput") ||
                failure.code === "Locked" ||
                failure.code === "Storage"
              )
                clearSession();
              onError(failure.code);
            },
          }),
        ),
      )
      .catch(() => {
        if (epoch.current !== current) return;
        clearSession();
        onError("Unavailable");
      });
  }

  // The browser saved a login. Reload the list without touching what the
  // window is doing; a lock or another operation since then wins.
  useEffect(() => {
    let disposed = false;

    const subscription = listen("vault-changed", () => {
      const current = epoch.current;

      void runtime
        .runPromise(
          Effect.gen(function* () {
            const vault = yield* VaultClient;

            return yield* vault.list;
          }),
        )
        .then(
          (entries) => {
            if (!disposed && epoch.current === current)
              setSnapshot((snapshot) =>
                snapshot.status === "unlocked" ? { ...snapshot, entries } : snapshot,
              );
          },
          () => {},
        );
    });

    return () => {
      disposed = true;
      void subscription.then(
        (unlisten) => unlisten(),
        () => {},
      );
    };
  }, [runtime]);

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
        if (!disposed) setError("Unavailable");
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
      (code) => toast.error(t.errors[code], { id: "master-password-error" }),
    );
  }

  /** A refused field keeps the dialog open, so nothing typed is lost. */
  function refused(code: ErrorCode) {
    if (code === "InvalidInput") toast.error(t.entry.invalid, { id: "entry-error" });
    else setError(code);
  }

  function save(entry: NewEntry) {
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.save(entry);

        return yield* loadSnapshot;
      }),
      (next) => {
        setAdding(false);
        setSnapshot(next);
      },
      true,
      refused,
    );
  }

  /** Adds the accounts in `text`, then confirms how many. */
  function importOtp(text: string, targets: ReadonlyArray<string | null>, count: number) {
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.importOtp(text, targets);

        return yield* loadSnapshot;
      }),
      (next) => {
        setSnapshot(next);
        toast.success(t.authenticator.added(count));
      },
      true,
    );
  }

  function startEdit(id: string) {
    setEditing({ id, notes: revealed?.id === id ? revealed.notes : null });
    hideSecret();
  }

  function update(id: string, entry: EntryUpdate) {
    execute(
      Effect.gen(function* () {
        const vault = yield* VaultClient;
        yield* vault.update(id, entry);

        return yield* loadSnapshot;
      }),
      (next) => {
        setEditing(null);
        setSnapshot(next);
      },
      true,
      refused,
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
    importOtp,
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
