import { useState, type FormEvent, type ReactNode } from "react";
import { Match, Schema } from "effect";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, LockKeyhole, Pencil, Plus, Search, Trash2 } from "lucide-react";
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
import { ThemeToggle } from "./theme/ThemeToggle";

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
  const notes = existing ? existing.notes : "";

  return (
    <>
      <FormField id="entry-name" label="Nom">
        <Input
          id="entry-name"
          name="name"
          required
          maxLength={256}
          autoComplete="off"
          placeholder="Ex. GitHub personnel"
          defaultValue={existing?.entry.name}
        />
      </FormField>
      <FormField id="entry-site" label="Site">
        <Input
          id="entry-site"
          name="site"
          maxLength={2048}
          autoComplete="off"
          placeholder="https://exemple.com"
          defaultValue={existing?.entry.site}
        />
      </FormField>
      <FormField id="entry-username" label="Identifiant">
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
            Mot de passe
            {existing && <Optional>laisser vide pour le conserver</Optional>}
          </>
        }
      >
        <Input
          id="entry-password"
          name="password"
          type="password"
          required={!existing}
          maxLength={4096}
          autoComplete="new-password"
        />
      </FormField>
      <FormField
        id="entry-notes"
        label={
          <>
            Notes <Optional>facultatif</Optional>
          </>
        }
      >
        {notes === null ? (
          <FieldDescription className="text-[11px]">
            Les notes restent inchangées. Affiche le mot de passe avant de modifier pour les éditer.
          </FieldDescription>
        ) : (
          <Textarea id="entry-notes" name="notes" maxLength={16384} rows={3} defaultValue={notes} />
        )}
      </FormField>
    </>
  );
}

function EntryDialog({ vault }: { vault: Vault }) {
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
          Ajouter un identifiant
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nouvel identifiant</DialogTitle>
          <DialogDescription>Enregistré dans le coffre de cet ordinateur.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-4">
          <EntryFields />
          <DialogFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={() => vault.setAdding(false)}>
              Annuler
            </Button>
            <Button disabled={vault.busy} type="submit">
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
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
      <DialogContent className="max-h-[calc(100dvh-32px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier l'identifiant</DialogTitle>
          <DialogDescription>
            La version précédente reste dans la sauvegarde du coffre.
          </DialogDescription>
        </DialogHeader>
        {editing && (
          <form onSubmit={update} className="grid gap-4">
            <EntryFields existing={{ entry, notes: editing.notes }} />
            <DialogFooter className="flex-row justify-end">
              <Button type="button" variant="outline" onClick={vault.stopEdit}>
                Annuler
              </Button>
              <Button disabled={vault.busy} type="submit">
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
  return (
    <Dialog
      open={vault.deleting === entry.id}
      onOpenChange={(open) => vault.setDeleting(open ? entry.id : null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer « {entry.name} » ?</DialogTitle>
          <DialogDescription>
            L'identifiant disparaît du coffre. La sauvegarde de la version précédente le garde
            jusqu'à la prochaine modification.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => vault.setDeleting(null)}>
            Annuler
          </Button>
          <Button
            disabled={vault.busy}
            variant="destructive"
            onClick={() => vault.remove(entry.id)}
          >
            Supprimer
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
          <h1 className="font-semibold">Identifiants</h1>
          <span className="text-xs text-muted-foreground">{vault.snapshot.entries.length}</span>
        </div>
        <ThemeToggle />
        <EntryDialog vault={vault} />
        <Button variant="outline" size="sm" onClick={vault.lock}>
          <LockKeyhole />
          Verrouiller
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)] max-[680px]:grid-cols-[210px_minmax(0,1fr)]">
        <aside
          className="flex min-h-0 flex-col border-r bg-muted"
          aria-label="Liste des identifiants"
        >
          <div className="relative mx-3 mt-4 mb-3">
            <Search size={15} className="absolute top-[9px] left-2.5 text-muted-foreground" />
            <Input
              className="h-8 bg-background pl-8 dark:bg-background"
              aria-label="Rechercher les identifiants"
              placeholder="Rechercher"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                vault.hideSecret();
              }}
            />
          </div>
          <div className="px-4 pb-2.5 text-[11px] text-muted-foreground">Tous les identifiants</div>
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
                  <span className="flex min-w-0 flex-col gap-0.5 *:truncate">
                    <strong className="text-xs font-semibold">{entry.name}</strong>
                    <span className="text-[11px] text-muted-foreground">
                      {entry.username || entry.site || "Sans identifiant"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {entries.length === 0 && (
            <p className="p-4 text-xs text-muted-foreground">
              {query ? "Aucun résultat" : "Aucun identifiant"}
            </p>
          )}
        </aside>
        <section className="flex overflow-y-auto" aria-label="Détails de l'identifiant">
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
                  <p className="mt-1 text-xs text-muted-foreground">Identifiant</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={vault.busy}
                    onClick={() => vault.startEdit(selected.id)}
                  >
                    <Pencil />
                    Modifier
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={vault.busy}
                    aria-label="Supprimer l'identifiant"
                    title="Supprimer l'identifiant"
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
                <DetailField label="Identifiant">
                  {selected.username || "Non renseigné"}
                </DetailField>
                <DetailField
                  label="Mot de passe"
                  hint={secret && "Masqué automatiquement après 30 secondes."}
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
                    aria-label={secret ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    title={secret ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                    onClick={() => vault.reveal(selected.id)}
                  >
                    {secret ? <EyeOff /> : <Eye />}
                  </Button>
                </DetailField>
                <DetailField label="Site">{selected.site || "Non renseigné"}</DetailField>
                <DetailField label="Notes" className="whitespace-pre-wrap">
                  {secret
                    ? secret.notes || "Aucune note"
                    : "Affiche le mot de passe pour lire les notes."}
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
                  {query ? "Aucun identifiant trouvé" : "Aucun identifiant"}
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  {query
                    ? "Essaie un autre nom, site ou identifiant."
                    : "Ajoute un identifiant pour le retrouver ici."}
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
    <section className="flex flex-1 items-center justify-center overflow-y-auto p-8">
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
  const creating = vault.snapshot.status === "missing";

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = Schema.decodeUnknownSync(Schema.String)(data.get("password"));

    if (creating && password !== data.get("confirmation")) {
      toast.error("Les deux mots de passe ne correspondent pas.", { id: "master-password-error" });

      return;
    }

    form.reset();
    vault.authenticate(password);
  }

  return (
    <AuthView>
      <AuthPanel
        title={creating ? "Créer un coffre" : "Coffre verrouillé"}
        icon={<LockKeyhole className="mb-5 text-muted-foreground" size={28} strokeWidth={1.3} />}
      >
        <AuthText>
          {creating
            ? "Choisis un mot de passe maître d’au moins 12 caractères. Il ne peut pas être réinitialisé."
            : "Saisis ton mot de passe maître pour ouvrir le coffre."}
        </AuthText>
        <form onSubmit={authenticate} className="grid gap-4.5">
          <FormField id="master-password" label="Mot de passe maître">
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
            <FormField id="confirmation" label="Confirmer le mot de passe">
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
            {vault.busy ? "Ouverture…" : creating ? "Créer le coffre" : "Déverrouiller"}
          </Button>
        </form>
      </AuthPanel>
    </AuthView>
  );
}

export default function App() {
  const vault = useVault();

  return (
    <main className="flex h-dvh flex-col overflow-hidden" aria-label="Cairn">
      {vault.error && (
        <p className="shrink-0 border-b px-4 py-2.5 text-xs text-destructive" role="alert">
          {vault.error}
        </p>
      )}
      {Match.value(vault.snapshot.status).pipe(
        Match.when("unlocked", () => <Credentials vault={vault} />),
        Match.when("loading", () => (
          <AuthView>
            <p role="status">Ouverture de Cairn…</p>
            {vault.error && <Button onClick={vault.retry}>Réessayer</Button>}
          </AuthView>
        )),
        Match.when("recovery", () => (
          <AuthView>
            <AuthPanel title="Sauvegarde disponible">
              <AuthText>
                Le coffre principal est introuvable. Ferme Cairn et restaure backups/previous.cairn
                dans le dossier du coffre.
              </AuthText>
              <AuthText>%LOCALAPPDATA%\com.hezaerd.cairn</AuthText>
              <Button onClick={vault.retry}>Vérifier à nouveau</Button>
            </AuthPanel>
          </AuthView>
        )),
        Match.orElse(() => <Authentication key={vault.snapshot.status} vault={vault} />),
      )}
    </main>
  );
}
