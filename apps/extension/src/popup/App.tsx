import { useEffect, useState } from "react";
import { Effect } from "effect";
import { decodePopupResult, type PopupResult } from "@cairn/contracts";
import "./style.css";

type State = { type: "Loading" } | PopupResult;

const readStatus = Effect.tryPromise(() => chrome.runtime.sendMessage({ type: "GetStatus" })).pipe(
  Effect.flatMap((response) => Effect.try(() => decodePopupResult(response))),
  Effect.timeout("3 seconds"),
  Effect.match({
    onSuccess: (result): State => result,
    onFailure: (): State => ({ type: "Unavailable", code: "ConnectionLost" }),
  }),
);

export default function App() {
  const [state, setState] = useState<State>({ type: "Loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ type: "Loading" });
    void Effect.runPromise(readStatus, { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setState(result);
      },
      () => {
        /* Unmount interrupts the UI fiber. */
      },
    );

    return () => controller.abort();
  }, [attempt]);
  const installationError = state.type === "Unavailable" && state.code === "HostUnavailable";

  return (
    <main className="welcome">
      <h1>Cairn</h1>
      <p role="status" aria-live="polite">
        {state.type === "Loading"
          ? "Connexion…"
          : state.type === "Connected"
            ? "Cairn connecté"
            : installationError
              ? "Connecteur à installer"
              : "Cairn indisponible"}
      </p>
      <p className="detail">
        {state.type === "Connected"
          ? `Application ${state.appVersion}`
          : state.type === "Loading"
            ? "Recherche de l’application Windows."
            : installationError
              ? "Enregistre le connecteur pour cette extension."
              : state.code === "AppUnavailable"
                ? "Ouvre Cairn sur Windows, puis réessaie."
                : `La connexion a échoué (${state.code}).`}
      </p>
      <button disabled={state.type === "Loading"} onClick={() => setAttempt((value) => value + 1)}>
        {state.type === "Connected" ? "Actualiser" : "Réessayer"}
      </button>
    </main>
  );
}
