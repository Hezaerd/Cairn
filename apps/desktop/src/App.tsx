import type { FormEvent, ReactNode } from "react";
import { Match, Schema } from "effect";
import { toast } from "@cairn/ui/components/sonner";
import { Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Timer, Trash2 } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { Input } from "@cairn/ui/components/input";
import { useVault } from "./vault/useVault";
import {
  DeleteDialog,
  DetailField,
  EditDialog,
  EntryDialog,
  FormField,
} from "./vault/EntryDialogs";
import { EntryList, NoSelection, Toolbar, matches } from "./vault/Workspace";
import { SiteIcon } from "./favicon/SiteIcon";
import { BrowsersDialog } from "./bridge/Browsers";
import { Authenticator } from "./authenticator/Authenticator";
import { OneTimeCode } from "./authenticator/OneTimeCode";
import { useT } from "./i18n/I18nProvider";
import { searchEntries, selectEntry, useNavigation } from "./store/navigation";

type Vault = ReturnType<typeof useVault>;

function Credentials({ vault }: { vault: Vault }) {
  const t = useT();
  const query = useNavigation((state) => state.query.logins);
  const selectedId = useNavigation((state) => state.selected.logins);

  // Entries that hold only an authenticator key live in the other view.
  const entries = vault.snapshot.entries.filter(
    (entry) => entry.hasPassword && matches(entry, query),
  );

  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];
  const secret = vault.revealed?.id === selected?.id ? vault.revealed : null;

  return (
    <>
      <Toolbar vault={vault}>
        <BrowsersDialog />
        <EntryDialog vault={vault} />
      </Toolbar>
      <div className="grid min-h-0 flex-1 grid-cols-sidebar max-[680px]:grid-cols-sidebar-narrow">
        <EntryList
          label={t.credentials.list}
          searchLabel={t.credentials.search}
          heading={t.credentials.all}
          empty={t.credentials.empty}
          entries={entries}
          selected={selected}
          query={query}
          onQuery={(next) => {
            searchEntries("logins", next);
            vault.hideSecret();
          }}
          onSelect={(id) => {
            selectEntry("logins", id);
            vault.hideSecret();
          }}
          marker={(entry) =>
            entry.hasTotp && (
              <Timer
                size={13}
                className="shrink-0 text-muted-foreground"
                aria-label={t.credentials.hasCode}
              />
            )
          }
        />
        <section className="flex overflow-y-auto" aria-label={t.credentials.details}>
          {selected ? (
            <article className="w-full max-w-180 p-8 max-[680px]:p-5.5">
              <header className="flex items-center gap-3.5 pb-7">
                <SiteIcon
                  key={`${selected.id}:${selected.site}`}
                  id={selected.id}
                  name={selected.name}
                  large
                />
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl/[1.3] font-semibold wrap-anywhere">{selected.name}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{t.credentials.kind}</p>
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
                    {secret ? secret.password : "••••••••••••"}
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
            <NoSelection
              icon={<KeyRound size={28} strokeWidth={1.25} />}
              title={query ? t.credentials.notFound : t.credentials.empty}
              hint={query ? t.credentials.notFoundHint : t.credentials.emptyHint}
            />
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
      <h1 className="mb-2 text-title font-semibold">{title}</h1>
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
  const view = useNavigation((state) => state.view);

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Cairn">
      {vault.error && (
        <p className="shrink-0 border-b px-4 py-2.5 text-xs text-destructive" role="alert">
          {t.errors[vault.error]}
        </p>
      )}
      {Match.value(vault.snapshot.status).pipe(
        Match.when("unlocked", () =>
          view === "authenticator" ? (
            <Authenticator vault={vault} />
          ) : (
            <Credentials vault={vault} />
          ),
        ),
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
