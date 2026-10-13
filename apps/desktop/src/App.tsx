import { useState, type FormEvent } from "react";
import { Match, Schema } from "effect";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ThemeToggle } from "./theme/ThemeToggle";
import { useT } from "./i18n/I18nProvider";

type Vault = ReturnType<typeof useVault>;

/** Without `existing`, the fields describe a new entry. */
function EntryFields({ existing }: { existing?: { entry: EntrySummary; notes: string | null } }) {
  const t = useT();
  const notes = existing ? existing.notes : "";

  return (
    <>
      <div className="field">
        <Label htmlFor="entry-name">{t.entry.name}</Label>
        <Input
          id="entry-name"
          name="name"
          required
          maxLength={256}
          autoComplete="off"
          placeholder={t.entry.namePlaceholder}
          defaultValue={existing?.entry.name}
        />
      </div>
      <div className="field">
        <Label htmlFor="entry-site">{t.entry.site}</Label>
        <Input
          id="entry-site"
          name="site"
          maxLength={2048}
          autoComplete="off"
          placeholder={t.entry.sitePlaceholder}
          defaultValue={existing?.entry.site}
        />
      </div>
      <div className="field">
        <Label htmlFor="entry-username">{t.entry.username}</Label>
        <Input
          id="entry-username"
          name="username"
          maxLength={1024}
          autoComplete="off"
          defaultValue={existing?.entry.username}
        />
      </div>
      <div className="field">
        <Label htmlFor="entry-password">
          {t.entry.password}
          {existing && <span className="optional">{t.entry.keepPassword}</span>}
        </Label>
        <Input
          id="entry-password"
          name="password"
          type="password"
          required={!existing}
          maxLength={4096}
          autoComplete="new-password"
        />
      </div>
      <div className="field">
        <Label htmlFor="entry-notes">
          {t.entry.notes} <span className="optional">{t.entry.optional}</span>
        </Label>
        {notes === null ? (
          <p className="field-hint">{t.entry.notesUnchanged}</p>
        ) : (
          <Textarea id="entry-notes" name="notes" maxLength={16384} rows={3} defaultValue={notes} />
        )}
      </div>
    </>
  );
}

function EntryDialog({ vault }: { vault: Vault }) {
  const t = useT();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = Schema.decodeUnknownSync(NewEntry)(Object.fromEntries(new FormData(form)));
    form.reset();
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
      <DialogContent className="entry-dialog">
        <DialogHeader>
          <DialogTitle>{t.add.title}</DialogTitle>
          <DialogDescription>{t.add.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="entry-form">
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

    const changes = Schema.decodeUnknownSync(EntryUpdate)({
      name: data.get("name"),
      site: data.get("site"),
      username: data.get("username"),
      password: password === "" ? null : password,
      notes: data.get("notes"),
    });

    vault.update(entry.id, changes);
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && vault.stopEdit()}>
      <DialogContent className="entry-dialog">
        <DialogHeader>
          <DialogTitle>{t.edit.title}</DialogTitle>
          <DialogDescription>{t.edit.description}</DialogDescription>
        </DialogHeader>
        {editing && (
          <form onSubmit={update} className="entry-form">
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
      <div className="toolbar">
        <div className="toolbar-title">
          <KeyRound size={16} />
          <h1>{t.credentials.title}</h1>
          <span className="count">{vault.snapshot.entries.length}</span>
        </div>
        <ThemeToggle />
        <EntryDialog vault={vault} />
        <Button variant="outline" size="sm" onClick={vault.lock}>
          <LockKeyhole />
          {t.credentials.lock}
        </Button>
      </div>
      <div className="workspace">
        <aside className="credential-pane" aria-label={t.credentials.list}>
          <div className="search-field">
            <Search size={15} />
            <Input
              aria-label={t.credentials.search}
              placeholder={t.credentials.searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                vault.hideSecret();
              }}
            />
          </div>
          <div className="list-label">{t.credentials.all}</div>
          <ul className="credential-list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <button
                  className="credential-row"
                  aria-current={selected?.id === entry.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(entry.id);
                    vault.hideSecret();
                  }}
                >
                  <SiteIcon key={entry.site} id={entry.id} name={entry.name} />
                  <span className="row-text">
                    <strong>{entry.name}</strong>
                    <span>{entry.username || entry.site || t.credentials.noUsername}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {entries.length === 0 && (
            <p className="list-empty">{query ? t.credentials.noResults : t.credentials.empty}</p>
          )}
        </aside>
        <section className="detail-pane" aria-label={t.credentials.details}>
          {selected ? (
            <article className="credential-detail">
              <header className="detail-heading">
                <SiteIcon
                  key={`${selected.id}:${selected.site}`}
                  id={selected.id}
                  name={selected.name}
                  large
                />
                <div className="detail-title">
                  <h2>{selected.name}</h2>
                  <p>{t.credentials.kind}</p>
                </div>
                <div className="detail-actions">
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
              <dl className="detail-fields">
                <div>
                  <dt>{t.entry.username}</dt>
                  <dd>{selected.username || t.common.notSet}</dd>
                </div>
                <div>
                  <dt>{t.entry.password}</dt>
                  <dd className="password-value">
                    <code>{secret ? secret.password : "••••••••••••"}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={vault.busy}
                      aria-label={secret ? t.credentials.hidePassword : t.credentials.showPassword}
                      title={secret ? t.credentials.hidePassword : t.credentials.showPassword}
                      onClick={() => vault.reveal(selected.id)}
                    >
                      {secret ? <EyeOff /> : <Eye />}
                    </Button>
                  </dd>
                  {secret && <p className="field-hint">{t.credentials.autoHide}</p>}
                </div>
                <div>
                  <dt>{t.entry.site}</dt>
                  <dd>{selected.site || t.common.notSet}</dd>
                </div>
                <div>
                  <dt>{t.entry.notes}</dt>
                  <dd className="notes">
                    {secret ? secret.notes || t.credentials.noNotes : t.credentials.notesHidden}
                  </dd>
                </div>
              </dl>
            </article>
          ) : (
            <div className="empty-detail">
              <KeyRound size={28} strokeWidth={1.25} />
              <h2>{query ? t.credentials.notFound : t.credentials.empty}</h2>
              <p>{query ? t.credentials.notFoundHint : t.credentials.emptyHint}</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
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
    <section className="auth-view">
      <div className="auth-form">
        <LockKeyhole className="auth-icon" size={28} strokeWidth={1.3} />
        <h1>{creating ? t.auth.createTitle : t.auth.lockedTitle}</h1>
        <p>{creating ? t.auth.createDescription : t.auth.unlockDescription}</p>
        <form onSubmit={authenticate}>
          <div className="field">
            <Label htmlFor="master-password">{t.auth.masterPassword}</Label>
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
          </div>
          {creating && (
            <div className="field">
              <Label htmlFor="confirmation">{t.auth.confirmation}</Label>
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
            </div>
          )}
          <Button disabled={vault.busy} type="submit">
            {vault.busy ? t.auth.opening : creating ? t.auth.create : t.auth.unlock}
          </Button>
        </form>
      </div>
    </section>
  );
}

export default function App() {
  const vault = useVault();
  const t = useT();

  return (
    <main className="vault-shell" aria-label="Cairn">
      {vault.error && (
        <p className="error" role="alert">
          {t.errors[vault.error]}
        </p>
      )}
      {Match.value(vault.snapshot.status).pipe(
        Match.when("unlocked", () => <Credentials vault={vault} />),
        Match.when("loading", () => (
          <section className="auth-view">
            <p role="status">{t.app.loading}</p>
            {vault.error && <Button onClick={vault.retry}>{t.common.retry}</Button>}
          </section>
        )),
        Match.when("recovery", () => (
          <section className="auth-view">
            <div className="auth-form">
              <h1>{t.app.recoveryTitle}</h1>
              <p>{t.app.recoveryDescription}</p>
              <p>%LOCALAPPDATA%\com.hezaerd.cairn</p>
              <Button onClick={vault.retry}>{t.app.checkAgain}</Button>
            </div>
          </section>
        )),
        Match.orElse(() => <Authentication key={vault.snapshot.status} vault={vault} />),
      )}
    </main>
  );
}
