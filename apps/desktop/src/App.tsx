import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Match, Schema } from "effect";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Settings,
  Timer,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EntryUpdate, NewEntry, type EntrySummary } from "./vault/VaultClient";
import { useVault } from "./vault/useVault";
import { SiteIcon } from "./favicon/SiteIcon";
import { PasswordGenerator } from "./generator/PasswordGenerator";
import { BrowsersDialog, PairingDialog } from "./bridge/Browsers";
import { AddCodesDialog } from "./authenticator/AddCodes";
import { OneTimeCode } from "./authenticator/OneTimeCode";
import { useT } from "./i18n/I18nProvider";

type Vault = ReturnType<typeof useVault>;

function FormField({ id, label, children }: { id: string; label: ReactNode; children: ReactNode }) {
  return (
    <Field className="gap-2 *:data-[slot=input]:h-[34px] *:data-[slot=input]:border-b-muted-foreground">
      <FieldLabel htmlFor={id} className="w-full text-xs font-normal">
        {label}
      </FieldLabel>
      {children}
    </Field>
  );
}

function Optional({ children }: { children: ReactNode }) {
  return <span className="ml-auto text-[11px] text-muted-foreground">{children}</span>;
}

/** Without `existing`, the fields describe a new entry. */
function EntryFields({ existing }: { existing?: { entry: EntrySummary; notes: string | null } }) {
  const t = useT();
  const notes = existing ? existing.notes : "";
  const password = useRef<HTMLInputElement>(null);

  return (
    <>
      <FormField id="entry-name" label={t.entry.name}>
        <Input
          id="entry-name"
          name="name"
          required
          maxLength={256}
          autoComplete="off"
          placeholder={t.entry.namePlaceholder}
          defaultValue={existing?.entry.name}
        />
      </FormField>
      <FormField id="entry-site" label={t.entry.site}>
        <Input
          id="entry-site"
          name="site"
          maxLength={2048}
          autoComplete="off"
          placeholder={t.entry.sitePlaceholder}
          defaultValue={existing?.entry.site}
        />
        <FieldDescription className="text-[11px]">{t.entry.siteHint}</FieldDescription>
      </FormField>
      <FormField id="entry-username" label={t.entry.username}>
        <Input
          id="entry-username"
          name="username"
          maxLength={1024}
          autoComplete="off"
          defaultValue={existing?.entry.username}
        />
      </FormField>
      <FormField
        id="entry-password"
        label={
          <>
            {t.entry.password}
            {existing && <Optional>{t.entry.keepPassword}</Optional>}
          </>
        }
      >
        <div className="flex gap-2">
          <Input
            ref={password}
            id="entry-password"
            name="password"
            type="password"
            className="h-[34px] border-b-muted-foreground"
            maxLength={4096}
            autoComplete="new-password"
          />
          <PasswordGenerator
            onUse={(generated) => {
              if (!password.current) return;
              password.current.value = generated;
              password.current.focus();
            }}
          />
        </div>
      </FormField>
      <FormField
        id="entry-totp"
        label={
          <>
            {t.entry.totp}
            <Optional>{existing?.entry.hasTotp ? t.entry.keepTotp : t.entry.optional}</Optional>
          </>
        }
      >
        <Input
          id="entry-totp"
          name="totp"
          type="password"
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
        />
        <FieldDescription className="text-[11px]">{t.entry.totpHint}</FieldDescription>
        {existing?.entry.hasTotp && (
          <label className="flex items-center gap-2 text-xs">
            <Checkbox name="removeTotp" />
            {t.entry.removeTotp}
          </label>
        )}
      </FormField>
      <FormField
        id="entry-notes"
        label={
          <>
            {t.entry.notes} <Optional>{t.entry.optional}</Optional>
          </>
        }
      >
        {notes === null ? (
          <FieldDescription className="text-[11px]">{t.entry.notesUnchanged}</FieldDescription>
        ) : (
          <Textarea id="entry-notes" name="notes" maxLength={16384} rows={3} defaultValue={notes} />
        )}
      </FormField>
    </>
  );
}

function EntryDialog({ vault }: { vault: Vault }) {
  const t = useT();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = Schema.decodeUnknownSync(NewEntry)(Object.fromEntries(new FormData(form)));

    if (!entry.password && !entry.totp.trim()) {
      toast.error(t.entry.needsSecret, { id: "entry-error" });

      return;
    }

    vault.save(entry);
  }

  return (
    <Dialog
      open={vault.adding}
      onOpenChange={(open) => {
        vault.hideSecret();
        vault.setAdding(open);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={vault.busy} size="sm">
          <Plus />
          {t.add.open}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-96px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.add.title}</DialogTitle>
          <DialogDescription>{t.add.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <EntryFields />
          <DialogFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={() => vault.setAdding(false)}>
              {t.common.cancel}
            </Button>
            <Button disabled={vault.busy} type="submit">
              {t.common.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
  const t = useT();
  const editing = vault.editing?.id === entry.id ? vault.editing : null;

  function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = data.get("password");
    const totp = data.get("totp");

    const changes = Schema.decodeUnknownSync(EntryUpdate)({
      name: data.get("name"),
      site: data.get("site"),
      username: data.get("username"),
      password: password === "" ? null : password,
      notes: data.get("notes"),
      // An empty key keeps the stored one; removing it sends an empty key.
      totp: data.get("removeTotp") ? "" : totp === "" ? null : totp,
    });

    if (changes.totp === "" && !entry.hasPassword && !changes.password) {
      toast.error(t.entry.needsSecret, { id: "entry-error" });

      return;
    }

    vault.update(entry.id, changes);
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && vault.stopEdit()}>
      <DialogContent className="max-h-[calc(100dvh-96px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.edit.title}</DialogTitle>
          <DialogDescription>{t.edit.description}</DialogDescription>
        </DialogHeader>
        {editing && (
          <form onSubmit={update} className="grid gap-4">
            <EntryFields existing={{ entry, notes: editing.notes }} />
            <DialogFooter className="flex-row justify-end">
              <Button type="button" variant="outline" onClick={vault.stopEdit}>
                {t.common.cancel}
              </Button>
              <Button disabled={vault.busy} type="submit">
                {t.common.save}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
  const t = useT();

  return (
    <Dialog
      open={vault.deleting === entry.id}
      onOpenChange={(open) => vault.setDeleting(open ? entry.id : null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.remove.title(entry.name)}</DialogTitle>
          <DialogDescription>{t.remove.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => vault.setDeleting(null)}>
            {t.common.cancel}
          </Button>
          <Button
            disabled={vault.busy}
            variant="destructive"
            onClick={() => vault.remove(entry.id)}
          >
            {t.remove.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-t py-4">
      <dt className="mb-[7px] text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-h-5 wrap-anywhere", className)}>{children}</dd>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Credentials({ vault }: { vault: Vault }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = vault.snapshot.entries.filter((entry) =>
    [entry.name, entry.username, entry.site].some((value) =>
      value.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ),
  );

  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const secret = vault.revealed?.id === selected?.id ? vault.revealed : null;

  return (
    <>
      <div className="flex min-h-[57px] items-center gap-2 border-b px-4 py-2.5 max-[680px]:px-3">
        <div className="mr-auto flex items-center gap-2">
          <KeyRound size={16} />
          <h1 className="font-semibold">{t.credentials.title}</h1>
          <span className="text-xs text-muted-foreground">{vault.snapshot.entries.length}</span>
        </div>
        <AddCodesDialog vault={vault} />
        <BrowsersDialog />
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/settings" aria-label={t.settings.open} title={t.settings.open}>
            <Settings />
          </Link>
        </Button>
        <EntryDialog vault={vault} />
        <Button variant="outline" size="sm" onClick={vault.lock}>
          <LockKeyhole />
          {t.credentials.lock}
        </Button>
        <PairingDialog />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)] max-[680px]:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-muted" aria-label={t.credentials.list}>
          <div className="relative mx-3 mt-4 mb-3">
            <Search size={15} className="absolute top-[9px] left-2.5 text-muted-foreground" />
            <Input
              className="h-8 bg-background pl-8 dark:bg-background"
              aria-label={t.credentials.search}
              placeholder={t.credentials.searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                vault.hideSecret();
              }}
            />
          </div>
          <div className="px-4 pb-2.5 text-[11px] text-muted-foreground">{t.credentials.all}</div>
          <ul className="overflow-y-auto px-1.5 pb-1.5">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="relative mb-0.5 flex w-full items-center gap-2.5 rounded-md p-2.5 text-left hover:bg-accent aria-[current=true]:bg-selection aria-[current=true]:before:absolute aria-[current=true]:before:left-0 aria-[current=true]:before:h-[18px] aria-[current=true]:before:w-[3px] aria-[current=true]:before:rounded-xs aria-[current=true]:before:bg-primary"
                  aria-current={selected?.id === entry.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(entry.id);
                    vault.hideSecret();
                  }}
                >
                  <SiteIcon key={entry.site} id={entry.id} name={entry.name} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5 *:truncate">
                    <strong className="text-xs font-semibold">{entry.name}</strong>
                    <span className="text-[11px] text-muted-foreground">
                      {entry.username || entry.site || t.credentials.noUsername}
                    </span>
                  </span>
                  {entry.hasTotp && (
                    <Timer
                      size={13}
                      className="shrink-0 text-muted-foreground"
                      aria-label={t.credentials.hasCode}
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          {entries.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">
              {query ? t.credentials.noResults : t.credentials.empty}
            </p>
          )}
        </aside>
        <section className="flex overflow-y-auto" aria-label={t.credentials.details}>
          {selected ? (
            <article className="w-full max-w-[720px] p-8 max-[680px]:p-5.5">
              <header className="flex items-center gap-3.5 pb-7">
                <SiteIcon
                  key={`${selected.id}:${selected.site}`}
                  id={selected.id}
                  name={selected.name}
                  large
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl/[1.3] font-semibold wrap-anywhere">{selected.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selected.hasPassword ? t.credentials.kind : t.credentials.codeOnly}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={vault.busy}
                    onClick={() => vault.startEdit(selected.id)}
                  >
                    <Pencil />
                    {t.edit.open}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={vault.busy}
                    aria-label={t.remove.open}
                    title={t.remove.open}
                    onClick={() => {
                      vault.hideSecret();
                      vault.setDeleting(selected.id);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </header>
              <EditDialog vault={vault} entry={selected} />
              <DeleteDialog vault={vault} entry={selected} />
              <dl>
                <DetailField label={t.entry.username}>
                  {selected.username || t.common.notSet}
                </DetailField>
                <DetailField
                  label={t.entry.password}
                  hint={secret && t.credentials.autoHide}
                  className="flex items-center justify-between gap-3"
                >
                  <code className="min-w-0 font-mono wrap-anywhere">
                    {!selected.hasPassword
                      ? t.common.notSet
                      : secret
                        ? secret.password
                        : "••••••••••••"}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={vault.busy}
                    aria-label={secret ? t.credentials.hidePassword : t.credentials.showPassword}
                    title={secret ? t.credentials.hidePassword : t.credentials.showPassword}
                    onClick={() => vault.reveal(selected.id)}
                  >
                    {secret ? <EyeOff /> : <Eye />}
                  </Button>
                </DetailField>
                {selected.hasTotp && (
                  <DetailField
                    label={t.credentials.code}
                    className="flex items-center justify-between gap-3"
                  >
                    <OneTimeCode key={selected.id} id={selected.id} />
                  </DetailField>
                )}
                <DetailField label={t.entry.site}>{selected.site || t.common.notSet}</DetailField>
                <DetailField label={t.entry.notes} className="whitespace-pre-wrap">
                  {secret ? secret.notes || t.credentials.noNotes : t.credentials.notesHidden}
                </DetailField>
              </dl>
            </article>
          ) : (
            <Empty className="p-8 md:p-8">
              <EmptyHeader className="gap-1.5">
                <EmptyMedia className="text-muted-foreground">
                  <KeyRound size={28} strokeWidth={1.25} />
                </EmptyMedia>
                <EmptyTitle role="heading" aria-level={2} className="text-[15px] font-semibold">
                  {query ? t.credentials.notFound : t.credentials.empty}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  {query ? t.credentials.notFoundHint : t.credentials.emptyHint}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}

function AuthView({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-1 items-center justify-center overflow-y-auto p-8 pb-16">
      {children}
    </section>
  );
}

function AuthPanel({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="w-80 max-w-full">
      {icon}
      <h1 className="mb-2 text-[22px] font-semibold">{title}</h1>
      {children}
    </div>
  );
}

function AuthText({ children }: { children: ReactNode }) {
  return <p className="mb-6 leading-relaxed text-muted-foreground">{children}</p>;
}

function Authentication({ vault }: { vault: Vault }) {
  const t = useT();
  const creating = vault.snapshot.status === "missing";

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = Schema.decodeUnknownSync(Schema.String)(data.get("password"));

    if (creating && password !== data.get("confirmation")) {
      toast.error(t.auth.mismatch, { id: "master-password-error" });

      return;
    }

    form.reset();
    vault.authenticate(password);
  }

  return (
    <AuthView>
      <AuthPanel
        title={creating ? t.auth.createTitle : t.auth.lockedTitle}
        icon={<LockKeyhole className="mb-5 text-muted-foreground" size={28} strokeWidth={1.3} />}
      >
        <AuthText>{creating ? t.auth.createDescription : t.auth.unlockDescription}</AuthText>
        <form onSubmit={authenticate} className="grid gap-4.5">
          <FormField id="master-password" label={t.auth.masterPassword}>
            <Input
              id="master-password"
              name="password"
              type="password"
              required
              minLength={creating ? 12 : 1}
              maxLength={1024}
              autoFocus
              autoComplete={creating ? "new-password" : "current-password"}
              disabled={vault.busy}
            />
          </FormField>
          {creating && (
            <FormField id="confirmation" label={t.auth.confirmation}>
              <Input
                id="confirmation"
                name="confirmation"
                type="password"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
                disabled={vault.busy}
              />
            </FormField>
          )}
          <Button disabled={vault.busy} type="submit" className="mt-0.5">
            {vault.busy ? t.auth.opening : creating ? t.auth.create : t.auth.unlock}
          </Button>
        </form>
      </AuthPanel>
    </AuthView>
  );
}

export default function App() {
  const vault = useVault();
  const t = useT();

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Cairn">
      {vault.error && (
        <p className="shrink-0 border-b px-4 py-2.5 text-xs text-destructive" role="alert">
          {t.errors[vault.error]}
        </p>
      )}
      {Match.value(vault.snapshot.status).pipe(
        Match.when("unlocked", () => <Credentials vault={vault} />),
        Match.when("loading", () => (
          <AuthView>
            <p role="status">{t.app.loading}</p>
            {vault.error && <Button onClick={vault.retry}>{t.common.retry}</Button>}
          </AuthView>
        )),
        Match.when("recovery", () => (
          <AuthView>
            <AuthPanel title={t.app.recoveryTitle}>
              <AuthText>{t.app.recoveryDescription}</AuthText>
              <AuthText>%LOCALAPPDATA%\com.hezaerd.cairn</AuthText>
              <Button onClick={vault.retry}>{t.app.checkAgain}</Button>
            </AuthPanel>
          </AuthView>
        )),
        Match.orElse(() => <Authentication key={vault.snapshot.status} vault={vault} />),
      )}
    </main>
  );
}
