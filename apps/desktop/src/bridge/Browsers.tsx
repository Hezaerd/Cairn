import { useContext, useEffect, useState, type FormEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { Effect, Option, Schema } from "effect";
import { toast } from "@cairn/ui/components/sonner";
import { Check, Globe, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cairn/ui/components/dialog";
import { CardDescription } from "@cairn/ui/components/card";
import { Input } from "@cairn/ui/components/input";
import {
  ListItemContent,
  ListItemDescription,
  ListItemTitle,
} from "@cairn/ui/components/list-item";
import { useT } from "../i18n/I18nProvider";
import { VaultRuntime } from "../vault/runtime";
import type { VaultError } from "../vault/VaultClient";
import { BrowserService, PairingRequest, browserName, type PairedBrowser } from "./BrowserService";

function useBrowsers() {
  const runtime = useContext(VaultRuntime);
  const t = useT();

  if (!runtime) throw new Error("Vault runtime is missing");

  return <A,>(effect: Effect.Effect<A, VaultError, BrowserService>, done: (value: A) => void) =>
    void runtime.runPromise(
      effect.pipe(
        Effect.match({
          onSuccess: done,
          onFailure: (error) => toast.error(t.errors[error.code]),
        }),
      ),
    );
}

const decodeRequest = Schema.decodeUnknownOption(PairingRequest);

/** Asks you to approve a browser that wants to pair, while the vault is unlocked. */
export function PairingDialog() {
  const t = useT();
  const run = useBrowsers();
  const [request, setRequest] = useState<PairingRequest | null>(null);

  useEffect(() => {
    let disposed = false;

    const subscription = listen("pairing-requested", (event) => {
      const next = decodeRequest(event.payload);

      if (!disposed && Option.isSome(next)) setRequest(next.value);
    });

    // A second browser asked while one waited; Cairn refused both.
    const conflict = listen("pairing-conflict", () => {
      if (disposed) return;

      setRequest(null);
      toast.warning(t.browsers.conflict);
    });

    run(
      Effect.gen(function* () {
        return yield* (yield* BrowserService).pending;
      }),
      (pending) => {
        if (!disposed && pending) setRequest(pending);
      },
    );

    return () => {
      disposed = true;

      for (const listener of [subscription, conflict])
        void listener.then(
          (unlisten) => unlisten(),
          () => {},
        );
    };
  }, []);

  function answer(accept: boolean) {
    if (!request) return;
    setRequest(null);
    run(
      Effect.gen(function* () {
        yield* (yield* BrowserService).answer(request.code, accept);
      }),
      () => {
        if (accept) toast.success(t.browsers.paired(request.name));
      },
    );
  }

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.browsers.requestTitle}</DialogTitle>
          <DialogDescription>
            {request && t.browsers.requestDescription(request.name)}
          </DialogDescription>
        </DialogHeader>
        <p className="py-2 text-center font-mono text-display font-semibold tracking-widest">
          {request?.code}
        </p>
        <p className="text-xs text-muted-foreground">{t.browsers.requestHint}</p>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => answer(false)}>
            {t.browsers.refuse}
          </Button>
          <Button onClick={() => answer(true)}>{t.browsers.approve}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lists paired browsers so you can name or remove one. */
export function PairedBrowsers() {
  const t = useT();
  const run = useBrowsers();
  const [browsers, setBrowsers] = useState<ReadonlyArray<PairedBrowser> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    run(
      Effect.gen(function* () {
        return yield* (yield* BrowserService).list;
      }),
      setBrowsers,
    );
  }, []);

  function rename(event: FormEvent<HTMLFormElement>, browser: PairedBrowser) {
    event.preventDefault();

    const label = Schema.decodeUnknownSync(Schema.String)(
      new FormData(event.currentTarget).get("label"),
    );

    setEditing(null);

    if (label.trim() === browserName(browser)) return;

    run(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        yield* service.rename(browser.id, label);

        return yield* service.list;
      }),
      (list) => {
        setBrowsers(list);
        toast.success(t.browsers.renamed);
      },
    );
  }

  function remove(browser: PairedBrowser) {
    run(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        yield* service.remove(browser.id);

        return yield* service.list;
      }),
      (list) => {
        setBrowsers(list);
        toast.success(t.browsers.removed(browserName(browser)));
      },
    );
  }

  if (browsers === null) return null;

  if (browsers.length === 0) return <CardDescription>{t.browsers.empty}</CardDescription>;

  return (
    <ul className="grid gap-1">
      {browsers.map((browser) => {
        const name = browserName(browser);

        return (
          <li key={browser.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <Globe size={16} className="shrink-0 text-muted-foreground" />
            {editing === browser.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1"
                onSubmit={(event) => rename(event, browser)}
              >
                <Input
                  name="label"
                  aria-label={t.browsers.renameLabel}
                  defaultValue={name}
                  placeholder={browser.name}
                  maxLength={256}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setEditing(null);
                  }}
                  className="h-8"
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.browsers.saveName}
                  title={t.browsers.saveName}
                >
                  <Check />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.browsers.cancelRename}
                  title={t.browsers.cancelRename}
                  onClick={() => setEditing(null)}
                >
                  <X />
                </Button>
              </form>
            ) : (
              <>
                <ListItemContent>
                  <ListItemTitle>{name}</ListItemTitle>
                  <ListItemDescription>
                    {browser.label !== null && `${browser.name} · `}
                    {t.browsers.pairedOn(new Date(browser.pairedAt * 1000))}
                  </ListItemDescription>
                </ListItemContent>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.browsers.rename(name)}
                  title={t.browsers.rename(name)}
                  onClick={() => setEditing(browser.id)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.browsers.remove(name)}
                  title={t.browsers.remove(name)}
                  onClick={() => remove(browser)}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
