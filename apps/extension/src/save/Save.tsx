import { useEffect, useRef, useState, type FormEvent } from "react";
import { Effect, Match } from "effect";
import {
  decodeSaveResult,
  MAX_PICKER_HEIGHT,
  type ClientErrorCode,
  type SaveRequest,
  type SaveResult,
} from "@cairn/contracts";
import { CircleCheck } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { Input } from "@cairn/ui/components/input";
import { Field, FieldLabel } from "@cairn/ui/components/field";
import {
  ListItemContent,
  ListItemDescription,
  ListItemTitle,
} from "@cairn/ui/components/list-item";
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
    <Button type="button" variant="outline" size="sm" onClick={dismiss}>
      {t("notNow")}
    </Button>
  );

  return (
    <main className="p-3.5" ref={main}>
      {(state.type === "Loading" || state.type === "Saving") && (
        <p className="text-xs text-muted-foreground">{t("connecting")}</p>
      )}
      {state.type === "Saved" && (
        <p className="flex items-center gap-2 text-xs" role="status">
          <CircleCheck className="size-4 text-primary" />
          {t("saved")}
        </p>
      )}
      {state.type === "Locked" && (
        <section className="grid gap-3">
          <p className="text-xs/relaxed text-muted-foreground">{t("saveLocked")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" onClick={retry}>
              {t("retry")}
            </Button>
            {later}
          </div>
        </section>
      )}
      {state.type === "Unavailable" && (
        <section className="grid gap-3">
          <p className="text-xs/relaxed text-muted-foreground">{problem(state.code)}</p>
          <div className="flex justify-end gap-2">{later}</div>
        </section>
      )}
      {(state.type === "New" || state.type === "Changed") && (
        <form className="grid gap-3" onSubmit={submit}>
          <h2 className="text-xs font-semibold">
            {state.type === "New" ? t("saveTitle") : t("updateTitle")}
          </h2>
          <p className="flex rounded-md border bg-muted px-2.5 py-2">
            <ListItemContent>
              <ListItemTitle>{state.type === "New" ? state.host : state.name}</ListItemTitle>
              <ListItemDescription>{state.username || t("noUsername")}</ListItemDescription>
            </ListItemContent>
          </p>
          {state.type === "New" && (
            <Field>
              <FieldLabel htmlFor="save-name">{t("saveName")}</FieldLabel>
              <Input
                id="save-name"
                value={name}
                maxLength={256}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="submit" size="sm" disabled={state.type === "New" && !name.trim()}>
              {state.type === "New" ? t("save") : t("update")}
            </Button>
            {later}
          </div>
        </form>
      )}
    </main>
  );
}
