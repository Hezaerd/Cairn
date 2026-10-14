import { useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { Effect } from "effect";
import { ImageUp, ScanQrCode } from "lucide-react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "../i18n/I18nProvider";
import { VaultClient, type EntrySummary, type OtpPreview } from "../vault/VaultClient";
import { useRuntime, type useVault } from "../vault/useVault";

const NEW_ENTRY = "new";

interface Review {
  /** The links the accounts came from. Rust reads the keys from them again on import. */
  text: string;
  accounts: ReadonlyArray<OtpPreview>;
  targets: ReadonlyArray<string>;
}

function host(site: string) {
  try {
    return new URL(site.includes("://") ? site : `https://${site.replace(/^\*\./, "")}`).hostname;
  } catch {
    return site;
  }
}

/** The first login without a code whose name or site mentions the account's issuer. */
function guessTargets(accounts: ReadonlyArray<OtpPreview>, entries: ReadonlyArray<EntrySummary>) {
  const taken = new Set<string>();

  return accounts.map(({ issuer }) => {
    const needle = issuer.trim().toLocaleLowerCase();

    const match = needle
      ? entries.find(
          (entry) =>
            !entry.hasTotp &&
            !taken.has(entry.id) &&
            [entry.name, host(entry.site)].some((value) =>
              value.toLocaleLowerCase().includes(needle),
            ),
        )
      : undefined;

    if (!match) return NEW_ENTRY;
    taken.add(match.id);

    return match.id;
  });
}

/**
 * Adds authenticator keys from `otpauth://` links, Google Authenticator's
 * export, or a picture of their QR codes. The window holds the links only
 * while the dialog is open; Rust reads the keys and keeps them.
 */
export function AddCodesDialog({ vault }: { vault: ReturnType<typeof useVault> }) {
  const t = useT();
  const runtime = useRuntime();
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const entries = [...vault.snapshot.entries].sort((a, b) => a.name.localeCompare(b.name));

  function reset() {
    setLinks("");
    setReview(null);
    setReading(false);
    setMessage(null);
  }

  function read(text: string, failure: string) {
    setReading(true);
    setMessage(null);
    void runtime
      .runPromise(
        Effect.gen(function* () {
          return yield* (yield* VaultClient).readOtp(text);
        }),
      )
      .then(
        (accounts) => {
          setReading(false);
          setLinks("");
          setReview({ text, accounts, targets: guessTargets(accounts, vault.snapshot.entries) });
        },
        () => {
          setReading(false);
          setMessage(failure);
        },
      );
  }

  function scan(file: File) {
    setReading(true);
    setMessage(t.authenticator.scanning);
    void file
      .arrayBuffer()
      .then((buffer) =>
        runtime.runPromise(
          Effect.gen(function* () {
            return yield* (yield* VaultClient).scanQr(new Uint8Array(buffer));
          }),
        ),
      )
      .then(
        (text) => read(text, t.authenticator.invalid),
        () => {
          setReading(false);
          setMessage(t.authenticator.noCode);
        },
      );
  }

  function firstImage(files: FileList | null | undefined) {
    return Array.from(files ?? []).find((file) => file.type.startsWith("image/"));
  }

  function paste(event: ClipboardEvent) {
    const image = firstImage(event.clipboardData.files);

    if (!image || review || reading) return;
    event.preventDefault();
    scan(image);
  }

  function drop(event: DragEvent) {
    const image = firstImage(event.dataTransfer.files);

    if (!image || review || reading) return;
    event.preventDefault();
    scan(image);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!review) {
      read(links, t.authenticator.invalid);

      return;
    }

    const targets = review.targets.map((target) => (target === NEW_ENTRY ? null : target));
    vault.importOtp(review.text, targets, review.accounts.length);
    close();
  }

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        vault.hideSecret();

        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={vault.busy}
          aria-label={t.authenticator.open}
          title={t.authenticator.open}
        >
          <ScanQrCode />
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-96px)] overflow-y-auto"
        onPaste={paste}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <DialogHeader>
          <DialogTitle>{t.authenticator.title}</DialogTitle>
          <DialogDescription>
            {review ? t.authenticator.found(review.accounts.length) : t.authenticator.description}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {review ? (
            <ul className="grid gap-2">
              {review.accounts.map((account, index) => {
                const target = review.targets[index];
                const replaces = entries.some((entry) => entry.id === target && entry.hasTotp);

                return (
                  <li
                    key={index}
                    className="flex items-center gap-3 rounded-md border bg-muted/50 p-2.5 max-[680px]:flex-col max-[680px]:items-stretch"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 *:truncate">
                      <strong className="text-xs font-semibold">
                        {account.issuer || t.authenticator.noIssuer}
                      </strong>
                      <span className="text-[11px] text-muted-foreground">
                        {account.account || t.common.notSet}
                        {replaces && ` · ${t.authenticator.replaces}`}
                      </span>
                    </span>
                    <Select
                      value={target}
                      onValueChange={(value) =>
                        setReview({
                          ...review,
                          targets: review.targets.map((current, position) =>
                            position === index ? value : current,
                          ),
                        })
                      }
                    >
                      <SelectTrigger
                        className="w-52 max-[680px]:w-full"
                        aria-label={`${t.authenticator.target}: ${account.issuer || account.account}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NEW_ENTRY}>{t.authenticator.newEntry}</SelectItem>
                        <SelectSeparator />
                        {entries.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed p-6 text-xs text-muted-foreground hover:bg-accent has-disabled:cursor-default">
                <ImageUp size={22} strokeWidth={1.5} />
                {t.authenticator.choose}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/bmp"
                  className="sr-only"
                  disabled={reading}
                  onChange={(event) => {
                    const image = firstImage(event.currentTarget.files);
                    event.currentTarget.value = "";

                    if (image) scan(image);
                  }}
                />
              </label>
              <Field className="gap-2">
                <FieldLabel htmlFor="otp-links" className="text-xs font-normal">
                  {t.authenticator.links}
                </FieldLabel>
                <Textarea
                  id="otp-links"
                  rows={3}
                  value={links}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="otpauth://totp/…"
                  disabled={reading}
                  onChange={(event) => setLinks(event.target.value)}
                />
              </Field>
            </>
          )}
          {message && (
            <p className="text-xs text-muted-foreground" role="status">
              {message}
            </p>
          )}
          <DialogFooter className="flex-row justify-end">
            {review ? (
              <Button type="button" variant="outline" onClick={reset}>
                {t.authenticator.back}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={close}>
                {t.common.cancel}
              </Button>
            )}
            <Button type="submit" disabled={vault.busy || reading || (!review && !links.trim())}>
              {review ? t.authenticator.add(review.accounts.length) : t.authenticator.read}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
