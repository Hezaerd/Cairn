import { useContext, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Effect, Option, Schema } from "effect";
import { toast } from "sonner";
import { Globe, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "../i18n/I18nProvider";
import { VaultRuntime } from "../vault/runtime";
import type { VaultError } from "../vault/VaultClient";
import { BrowserService, PairingRequest, type PairedBrowser } from "./BrowserService";

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
      <DialogContent>
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

/** Lists paired browsers so you can remove one. */
export function BrowsersDialog() {
  const t = useT();
  const run = useBrowsers();
  const [browsers, setBrowsers] = useState<ReadonlyArray<PairedBrowser> | null>(null);

  const load = Effect.gen(function* () {
    return yield* (yield* BrowserService).list;
  });

  function remove(browser: PairedBrowser) {
    run(
      Effect.gen(function* () {
        const service = yield* BrowserService;
        yield* service.remove(browser.id);

        return yield* service.list;
      }),
      (list) => {
        setBrowsers(list);
        toast.success(t.browsers.removed(browser.name));
      },
    );
  }

  return (
    <Dialog
      open={browsers !== null}
      onOpenChange={(open) => (open ? run(load, setBrowsers) : setBrowsers(null))}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t.browsers.open} title={t.browsers.open}>
          <Globe />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.browsers.title}</DialogTitle>
          <DialogDescription>{t.browsers.description}</DialogDescription>
        </DialogHeader>
        {browsers?.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t.browsers.empty}</p>
        ) : (
          <ul className="grid gap-1">
            {browsers?.map((browser) => (
              <li key={browser.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Globe size={16} className="shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <strong className="truncate text-xs font-semibold">{browser.name}</strong>
                  <span className="text-2xs text-muted-foreground">
                    {t.browsers.pairedOn(new Date(browser.pairedAt * 1000))}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.browsers.remove(browser.name)}
                  title={t.browsers.remove(browser.name)}
                  onClick={() => remove(browser)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
