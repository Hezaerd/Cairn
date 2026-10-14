import { useEffect, useRef, useState, type RefObject } from "react";
import { Effect } from "effect";
import {
  decodePickerResult,
  MAX_PICKER_HEIGHT,
  type PickerRequest,
  type PickerResult,
} from "@cairn/contracts";
import { t } from "../popup/i18n";

// The list of logins shown under a login field, in a frame the page can't
// read. A page can still hide or cover the frame to trick a click, so a click
// only counts once the frame has been fully visible for a moment.

const MIN_VISIBLE_MS = 400;

type State = { type: "Loading" } | PickerResult;

const send = (request: PickerRequest) =>
  Effect.tryPromise(() => chrome.runtime.sendMessage(request)).pipe(
    Effect.flatMap((response) => Effect.try(() => decodePickerResult(response))),
    Effect.timeout("5 seconds"),
    Effect.match({
      onSuccess: (result): State => result,
      onFailure: (): State => ({ type: "Unavailable", code: "ConnectionLost" }),
    }),
  );

const post = (request: PickerRequest) => void Effect.runPromise(send(request));

// Intersection Observer v2, which TypeScript's DOM types don't declare yet.
interface VisibilityInit extends IntersectionObserverInit {
  readonly trackVisibility: boolean;
  readonly delay: number;
}

interface VisibilityEntry extends IntersectionObserverEntry {
  readonly isVisible?: boolean;
}

/**
 * Whether the element has been visible long enough to accept a click. Chromium
 * reports it hidden when anything covers it, or when it or the page around it
 * is transparent, filtered, or transformed.
 */
function useTrustedVisibility(ref: RefObject<HTMLElement | null>) {
  const since = useRef<number | null>(null);

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const init: VisibilityInit = { threshold: [0, 1], trackVisibility: true, delay: 100 };

    const observer = new IntersectionObserver((entries) => {
      // SAFETY: Chromium adds `isVisible` when `trackVisibility` is set.
      const visible = (entries.at(-1) as VisibilityEntry | undefined)?.isVisible === true;

      if (!visible) since.current = null;
      else since.current ??= performance.now();
    }, init);

    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return () => since.current !== null && performance.now() - since.current >= MIN_VISIBLE_MS;
}

export default function Picker() {
  const [state, setState] = useState<State>({ type: "Loading" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const main = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trusted = useTrustedVisibility(main);

  useEffect(() => {
    const controller = new AbortController();

    void Effect.runPromise(send({ type: "GetSuggestions" }), { signal: controller.signal }).then(
      (result) => {
        if (!controller.signal.aborted) setState(result);
      },
      () => {
        /* Unmount interrupts the request. */
      },
    );

    return () => controller.abort();
  }, [attempt]);

  // The content script sizes the frame to the list.
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
      if (event.key === "Escape") post({ type: "Close" });
    };

    // Arrow Down in the field moves focus here.
    const onFocus = () => list.current?.querySelector("button")?.focus();
    addEventListener("keydown", onKey);
    addEventListener("focus", onFocus);

    return () => {
      removeEventListener("keydown", onKey);
      removeEventListener("focus", onFocus);
    };
  }, []);

  function fill(entryId: string) {
    if (!trusted()) return;

    setNotice(null);

    void Effect.runPromise(send({ type: "Fill", entryId })).then((result) => {
      if (result.type === "NoForm") setNotice(t("noForm"));
      else if (result.type !== "Filled") setState(result);
    });
  }

  const retry = () => {
    setState({ type: "Loading" });
    setAttempt((value) => value + 1);
  };

  return (
    <main className="picker" ref={main}>
      {state.type === "Loading" && <p className="detail">{t("connecting")}</p>}
      {state.type === "Locked" && (
        <section>
          <p className="detail">{t("locked")}</p>
          <button onClick={retry}>{t("refresh")}</button>
        </section>
      )}
      {state.type === "Unavailable" && (
        <section>
          <p className="detail">
            {state.code === "AppUnavailable" ? t("openApp") : t("connectionFailed", state.code)}
          </p>
          <button onClick={retry}>{t("retry")}</button>
        </section>
      )}
      {state.type === "Logins" && (
        <>
          <h2>{t("loginsFor", state.host)}</h2>
          {state.logins.length === 0 ? (
            <p className="detail">{t("noLogins", state.host)}</p>
          ) : (
            <ul className="logins" ref={list}>
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
        </>
      )}
    </main>
  );
}
