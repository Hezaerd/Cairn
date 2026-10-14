import { useEffect, useState } from "react";
import { Effect } from "effect";
import { decodePopupResult, type PopupRequest, type PopupResult } from "@cairn/contracts";
import { Button } from "@cairn/ui/components/button";
import { Checkbox } from "@cairn/ui/components/checkbox";
import { Label } from "@cairn/ui/components/label";
import { SITES } from "../sites";
import { t } from "./i18n";
import { Login } from "./Login";

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
    <main className="grid">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        {/* A mask paints the mark in the text color, so it follows the theme. */}
        <span
          aria-hidden
          className="size-4 bg-current mask-mark mask-contain mask-center mask-no-repeat"
        />
        <h1 className="mr-auto text-sm font-semibold">Cairn</h1>
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {t("connected")}
        </p>
      </header>
      {state.type === "Unpaired" && (
        <section className="grid gap-3 p-4">
          <p className="text-xs/relaxed text-muted-foreground">{t("pairIntro")}</p>
          <Button size="sm" className="justify-self-start" onClick={pair}>
            {t("pair")}
          </Button>
        </section>
      )}
      {state.type === "Pairing" && (
        <section className="grid gap-3 p-4">
          <p className="text-xs/relaxed text-muted-foreground">{t("pairingCode")}</p>
          <p className="rounded-md border bg-muted py-2 text-center font-mono text-display font-semibold tracking-widest">
            {state.code}
          </p>
          <p className="text-xs/relaxed text-muted-foreground">{t("pairingThen")}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={refresh}>
              {t("refresh")}
            </Button>
            <Button size="sm" variant="outline" onClick={pair}>
              {t("pairAgain")}
            </Button>
          </div>
        </section>
      )}
      {state.type === "Locked" && (
        <section className="grid gap-3 p-4">
          <p className="text-xs/relaxed text-muted-foreground">{t("locked")}</p>
          <Button size="sm" className="justify-self-start" onClick={refresh}>
            {t("refresh")}
          </Button>
        </section>
      )}
      {state.type === "NoSite" && (
        <section className="p-4">
          <p className="text-xs/relaxed text-muted-foreground">{t("noSite")}</p>
        </section>
      )}
      {state.type === "Logins" && (
        <section className="grid gap-1 px-1.5 pt-3 pb-1.5">
          <h2 className="truncate px-2.5 text-2xs text-muted-foreground">
            {t("loginsFor", state.host)}
          </h2>
          {state.logins.length === 0 ? (
            <p className="px-2.5 pb-2 text-xs/relaxed text-muted-foreground">
              {t("noLogins", state.host)}
            </p>
          ) : (
            <ul className="grid max-h-65 gap-0.5 overflow-y-auto">
              {state.logins.map((login) => (
                <li key={login.id}>
                  <Login
                    name={login.name}
                    username={login.username}
                    onFill={() => fill(login.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {notice && (
            <p className="px-2.5 pb-1 text-xs text-destructive" role="alert">
              {notice}
            </p>
          )}
        </section>
      )}
      {(state.type === "Logins" || state.type === "NoSite" || state.type === "Locked") && (
        <SuggestionsToggle />
      )}
      {state.type !== "Filled" && state.type !== "NoForm" && (
        <footer className="border-t px-4 py-2 text-2xs text-muted-foreground">
          {t("appVersion", state.appVersion)}
        </footer>
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
    <div className="flex items-start gap-2.5 border-t px-4 py-3">
      <Checkbox
        id="suggestions"
        className="mt-px"
        aria-describedby="suggestions-detail"
        checked={enabled}
        onCheckedChange={(checked) => void toggle(checked === true)}
      />
      <div className="grid gap-1">
        <Label htmlFor="suggestions">{t("suggestions")}</Label>
        <p id="suggestions-detail" className="text-2xs/snug text-muted-foreground">
          {t("suggestionsDetail")}
        </p>
      </div>
    </div>
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
    <main className="grid min-h-50 content-center justify-items-center gap-1.5 p-6 text-center">
      <h1 className="text-subtitle font-semibold">Cairn</h1>
      <p role="status" aria-live="polite" className="text-sm">
        {state.type === "Loading"
          ? t("connecting")
          : installationError
            ? t("hostMissing")
            : t("unavailable")}
      </p>
      <p className="text-xs/relaxed text-muted-foreground">
        {state.type === "Loading"
          ? t("searching")
          : installationError
            ? t("registerHost")
            : state.code === "AppUnavailable"
              ? t("openApp")
              : state.code === "PairingConflict"
                ? t("pairingConflict")
                : t("connectionFailed", state.code)}
      </p>
      <Button size="sm" className="mt-3" disabled={state.type === "Loading"} onClick={onRetry}>
        {t("retry")}
      </Button>
    </main>
  );
}
