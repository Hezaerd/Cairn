import { useEffect, useRef, useState, type FormEvent } from "react";
import { Effect, Match } from "effect";
import {
  decodeSaveResult,
  MAX_PICKER_HEIGHT,
  type ClientErrorCode,
  type SaveRequest,
  type SaveResult,
} from "@cairn/contracts";
import { useTrustedVisibility } from "../frame/visibility";
import { t } from "../popup/i18n";

// Offers to save a login the user just submitted, in a frame the page can't
// read. It shows the site and the username, never the password, and the name
// of the login it would update.

type State = { type: "Loading" } | { type: "Saving" } | SaveResult;

const send = (request: SaveRequest) =>
  Effect.tryPromise(() => chrome.runtime.sendMessage(request)).pipe(
    Effect.flatMap((response) => Effect.try(() => decodeSaveResult(response))),
    Effect.timeout("5 seconds"),
    Effect.match({
      onSuccess: (result): State => result,
      onFailure: (): State => ({ type: "Unavailable", code: "ConnectionLost" }),
    }),
  );

const post = (request: SaveRequest) => void Effect.runPromise(send(request));

const dismiss = () => post({ type: "Dismiss" });

/** The default name of a new login: its host, without a leading `www.`. */
const defaultName = (host: string) => host.replace(/^www\./, "");

const problem = (code: ClientErrorCode) =>
  Match.value(code).pipe(
    Match.when("NotFound", () => t("saveExpired")),
    Match.when("AppUnavailable", () => t("openApp")),
    Match.orElse((code) => t("connectionFailed", code)),
  );

export default function Save() {
  const [state, setState] = useState<State>({ type: "Loading" });
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const main = useRef<HTMLElement>(null);
  const trusted = useTrustedVisibility(main);

  useEffect(() => {
    const controller = new AbortController();

    void Effect.runPromise(send({ type: "GetOffer" }), { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;

        // Cairn already holds it, now that it could tell.
        if (result.type === "Known") return dismiss();

        if (result.type === "New") setName(defaultName(result.host));
        setState(result);
      },
      () => {
        /* Unmount interrupts the request. */
      },
    );

    return () => controller.abort();
  }, [attempt]);

  // The content script sizes the frame to the banner.
  useEffect(() => {
    const element = main.current;

    if (!element) return;

    const observer = new ResizeObserver(() =>
      post({
        type: "Resize",
        height: Math.min(Math.ceil(element.getBoundingClientRect().height), MAX_PICKER_HEIGHT),
      }),
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    addEventListener("keydown", onKey);

    return () => removeEventListener("keydown", onKey);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();

    if (!trusted() || (state.type !== "New" && state.type !== "Changed")) return;

    const request: SaveRequest =
      state.type === "New" ? { type: "Save", name: name.trim() } : { type: "Update" };

    setState({ type: "Saving" });
    void Effect.runPromise(send(request)).then(setState);
  }

  const retry = () => {
    setState({ type: "Loading" });
    setAttempt((value) => value + 1);
  };

  const later = (
    <button type="button" className="secondary" onClick={dismiss}>
      {t("notNow")}
    </button>
  );

  return (
    <main className="save" ref={main}>
      {(state.type === "Loading" || state.type === "Saving") && (
        <p className="detail">{t("connecting")}</p>
      )}
      {state.type === "Saved" && (
        <p className="detail" role="status">
          {t("saved")}
        </p>
      )}
      {state.type === "Locked" && (
        <section>
          <p className="detail">{t("saveLocked")}</p>
          <div className="actions">
            <button type="button" onClick={retry}>
              {t("retry")}
            </button>
            {later}
          </div>
        </section>
      )}
      {state.type === "Unavailable" && (
        <section>
          <p className="detail">{problem(state.code)}</p>
          <div className="actions">{later}</div>
        </section>
      )}
      {(state.type === "New" || state.type === "Changed") && (
        <form onSubmit={submit}>
          <h2>{state.type === "New" ? t("saveTitle") : t("updateTitle")}</h2>
          <p className="login">
            <strong>{state.type === "New" ? state.host : state.name}</strong>
            <span>{state.username || t("noUsername")}</span>
          </p>
          {state.type === "New" && (
            <label>
              {t("saveName")}
              <input
                value={name}
                maxLength={256}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <div className="actions">
            <button type="submit" disabled={state.type === "New" && !name.trim()}>
              {state.type === "New" ? t("save") : t("update")}
            </button>
            {later}
          </div>
        </form>
      )}
    </main>
  );
}
