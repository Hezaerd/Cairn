import { useEffect, useState } from "react";
import { Effect } from "effect";
import { toast } from "@cairn/ui/components/sonner";
import { Copy } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { useT } from "../i18n/I18nProvider";
import { VaultClient, type TotpCode } from "../vault/VaultClient";
import { useRuntime } from "../vault/useVault";

interface Current extends TotpCode {
  expiresAt: number;
}

/** Splits a code in halves, as authenticator apps show it: 123 456. */
function grouped(code: string) {
  const half = Math.ceil(code.length / 2);

  return `${code.slice(0, half)} ${code.slice(half)}`;
}

/**
 * The entry's current code, fetched again when it expires. Key it by the
 * entry so another entry starts without the previous code. Reading it doesn't
 * count as activity, so leaving an entry selected never keeps the vault open.
 */
export function OneTimeCode({ id }: { id: string }) {
  const t = useT();
  const runtime = useRuntime();
  const [current, setCurrent] = useState<Current | null>(null);
  const [failed, setFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let disposed = false;
    let timeout: number | undefined;

    void runtime
      .runPromise(
        Effect.gen(function* () {
          return yield* (yield* VaultClient).code(id);
        }),
      )
      .then(
        (code) => {
          if (disposed) return;
          const expiresAt = Date.now() + code.remaining * 1000;
          setCurrent({ ...code, expiresAt });
          setFailed(false);
          timeout = window.setTimeout(
            () => setGeneration((value) => value + 1),
            code.remaining * 1000,
          );
        },
        () => {
          if (!disposed) setFailed(true);
        },
      );

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [runtime, id, generation]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);

    return () => window.clearInterval(interval);
  }, []);

  if (failed) return <span className="text-muted-foreground">{t.common.notSet}</span>;

  if (!current) return <span className="font-mono text-muted-foreground">••• •••</span>;

  const seconds = Math.max(0, Math.ceil((current.expiresAt - now) / 1000));
  const progress = Math.min(1, seconds / current.period);

  function copy() {
    if (!current) return;
    navigator.clipboard.writeText(current.code).then(
      () => toast.success(t.credentials.codeCopied, { id: "code-copied" }),
      () => toast.error(t.credentials.copyFailed),
    );
  }

  return (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <code className="font-mono text-lg tracking-wider tabular-nums">
          {grouped(current.code)}
        </code>
        <span
          className="flex items-center gap-1.5 text-2xs text-muted-foreground tabular-nums"
          title={t.credentials.codeChanges(seconds)}
        >
          <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" className="stroke-border" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              strokeWidth="2.5"
              strokeDasharray={`${progress * 50.27} 50.27`}
              className={seconds <= 5 ? "stroke-destructive" : "stroke-primary"}
            />
          </svg>
          <span className="sr-only">{t.credentials.codeChanges(seconds)}</span>
          <span aria-hidden>{seconds}</span>
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t.credentials.copyCode}
        title={t.credentials.copyCode}
        onClick={copy}
      >
        <Copy />
      </Button>
    </>
  );
}
