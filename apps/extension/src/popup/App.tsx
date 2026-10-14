import { useEffect, useState } from "react";
import { Effect } from "effect";
import { decodePopupResult, type PopupRequest, type PopupResult } from "@cairn/contracts";
import { SITES } from "../sites";
import { t } from "./i18n";

type State = { type: "Loading" } | PopupResult;

const send = (request: PopupRequest) =>
  Effect.tryPromise(() => chrome.runtime.sendMessage(request)).pipe(
    Effect.flatMap((response) => Effect.try(() => decodePopupResult(response))),
    Effect.timeout("5 seconds"),
    Effect.match({
      onSuccess: (result): State => result,
      onFailure: (): State => ({ type: "Unavailable", code: "ConnectionLost" }),
    }),
  );

/** The tab the popup was opened over. Opening the popup grants `activeTab` for it. */
const activeTab = Effect.tryPromise(() =>
  chrome.tabs.query({ active: true, currentWindow: true }),
).pipe(
  Effect.map(([tab]) => tab?.id ?? chrome.tabs.TAB_ID_NONE),
  Effect.orElseSucceed(() => chrome.tabs.TAB_ID_NONE),
);

const readState = Effect.flatMap(activeTab, (tabId) => send({ type: "GetState", tabId }));

function run(effect: Effect.Effect<State>, signal: AbortSignal, update: (state: State) => void) {
  void Effect.runPromise(effect, { signal }).then(
    (result) => {
      if (!signal.aborted) update(result);
    },
    () => {
      /* Unmount interrupts the UI fiber. */
    },
  );
}

export default function App() {
  const [state, setState] = useState<State>({ type: "Loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ type: "Loading" });
    run(readState, controller.signal, setState);

    return () => controller.abort();
  }, [attempt]);

  const refresh = () => setAttempt((value) => value + 1);

  function pair() {
    setState({ type: "Loading" });
    run(send({ type: "Pair" }), new AbortController().signal, setState);
  }

  function fill(entryId: string) {
    setNotice(null);
    run(
      Effect.flatMap(activeTab, (tabId) => send({ type: "Fill", tabId, entryId })),
      new AbortController().signal,
      (result) => {
        if (result.type === "Filled") window.close();
        else if (result.type === "NoForm") setNotice(t("noForm"));
        else setState(result);
      },
    );
  }

  if (state.type === "Loading" || state.type === "Unavailable")
    return <Status state={state} onRetry={refresh} />;

  return (
    <main className="panel">
      <header>
        <h1>Cairn</h1>
        <p role="status" aria-live="polite">
          {t("connected")}
        </p>
      </header>
      {state.type === "Unpaired" && (
        <section>
          <p className="detail">{t("pairIntro")}</p>
          <button onClick={pair}>{t("pair")}</button>
        </section>
      )}
      {state.type === "Pairing" && (
        <section>
          <p className="detail">{t("pairingCode")}</p>
          <p className="code">{state.code}</p>
          <p className="detail">{t("pairingThen")}</p>
          <div className="actions">
            <button onClick={refresh}>{t("refresh")}</button>
            <button className="secondary" onClick={pair}>
              {t("pairAgain")}
            </button>
          </div>
        </section>
      )}
      {state.type === "Locked" && (
        <section>
          <p className="detail">{t("locked")}</p>
          <button onClick={refresh}>{t("refresh")}</button>
        </section>
      )}
      {state.type === "NoSite" && (
        <section>
          <p className="detail">{t("noSite")}</p>
        </section>
      )}
      {state.type === "Logins" && (
        <section>
          <h2>{t("loginsFor", state.host)}</h2>
          {state.logins.length === 0 ? (
            <p className="detail">{t("noLogins", state.host)}</p>
          ) : (
            <ul className="logins">
              {state.logins.map((login) => (
                <li key={login.id}>
                  <button className="login" onClick={() => fill(login.id)}>
                    <strong>{login.name}</strong>
                    <span>{login.username || t("noUsername")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {notice && (
            <p className="detail" role="alert">
              {notice}
            </p>
          )}
        </section>
      )}
      {(state.type === "Logins" || state.type === "NoSite" || state.type === "Locked") && (
        <SuggestionsToggle />
      )}
      {state.type !== "Filled" && state.type !== "NoForm" && (
        <footer>{t("appVersion", state.appVersion)}</footer>
      )}
    </main>
  );
}

/**
 * Turns suggestions in login fields on or off. They need access to every
 * website, which Chromium asks the user for.
 */
function SuggestionsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    void chrome.permissions.contains({ origins: SITES }).then(setEnabled);
  }, []);

  async function toggle(on: boolean) {
    const changed = await (
      on
        ? chrome.permissions.request({ origins: SITES })
        : chrome.permissions.remove({ origins: SITES })
    ).catch(() => false);

    if (changed) setEnabled(on);
  }

  if (enabled === null) return null;

  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => void toggle(event.target.checked)}
      />
      <span>
        {t("suggestions")}
        <small>{t("suggestionsDetail")}</small>
      </span>
    </label>
  );
}

function Status({
  state,
  onRetry,
}: {
  state: Extract<State, { type: "Loading" | "Unavailable" }>;
  onRetry: () => void;
}) {
  const installationError = state.type === "Unavailable" && state.code === "HostUnavailable";

  return (
    <main className="welcome">
      <h1>Cairn</h1>
      <p role="status" aria-live="polite">
        {state.type === "Loading"
          ? t("connecting")
          : installationError
            ? t("hostMissing")
            : t("unavailable")}
      </p>
      <p className="detail">
        {state.type === "Loading"
          ? t("searching")
          : installationError
            ? t("registerHost")
            : state.code === "AppUnavailable"
              ? t("openApp")
              : t("connectionFailed", state.code)}
      </p>
      <button disabled={state.type === "Loading"} onClick={onRetry}>
        {t("retry")}
      </button>
    </main>
  );
}
