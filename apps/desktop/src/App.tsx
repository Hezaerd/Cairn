import { useState, type FormEvent } from "react";
import { Match, Schema } from "effect";
import { Eye, EyeOff, KeyRound, LockKeyhole, Plus, Search } from "lucide-react";
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
import { NewEntry } from "./vault/VaultClient";
import { useVault } from "./vault/useVault";
import { SiteIcon } from "./favicon/SiteIcon";

type Vault = ReturnType<typeof useVault>;

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
      <DialogContent className="entry-dialog">
        <DialogHeader>
          <DialogTitle>Nouvel identifiant</DialogTitle>
          <DialogDescription>Enregistré dans le coffre de cet ordinateur.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="entry-form">
          <div className="field">
            <Label htmlFor="entry-name">Nom</Label>
            <Input
              id="entry-name"
              name="name"
              required
              maxLength={256}
              autoComplete="off"
              placeholder="Ex. GitHub personnel"
            />
          </div>
          <div className="field">
            <Label htmlFor="entry-site">Site</Label>
            <Input
              id="entry-site"
              name="site"
              maxLength={2048}
              autoComplete="off"
              placeholder="https://exemple.com"
            />
          </div>
          <div className="field">
            <Label htmlFor="entry-username">Identifiant</Label>
            <Input id="entry-username" name="username" maxLength={1024} autoComplete="off" />
          </div>
          <div className="field">
            <Label htmlFor="entry-password">Mot de passe</Label>
            <Input
              id="entry-password"
              name="password"
              type="password"
              required
              maxLength={4096}
              autoComplete="new-password"
            />
          </div>
          <div className="field">
            <Label htmlFor="entry-notes">
              Notes <span className="optional">facultatif</span>
            </Label>
            <Textarea id="entry-notes" name="notes" maxLength={16384} rows={3} />
          </div>
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
      <div className="toolbar">
        <div className="toolbar-title">
          <KeyRound size={16} />
          <h1>Identifiants</h1>
          <span className="count">{vault.snapshot.entries.length}</span>
        </div>
        <EntryDialog vault={vault} />
        <Button variant="outline" size="sm" onClick={vault.lock}>
          <LockKeyhole />
          Verrouiller
        </Button>
      </div>
      <div className="workspace">
        <aside className="credential-pane" aria-label="Liste des identifiants">
          <div className="search-field">
            <Search size={15} />
            <Input
              aria-label="Rechercher les identifiants"
              placeholder="Rechercher"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                vault.hideSecret();
              }}
            />
          </div>
          <div className="list-label">Tous les identifiants</div>
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
                  <SiteIcon id={entry.id} name={entry.name} />
                  <span className="row-text">
                    <strong>{entry.name}</strong>
                    <span>{entry.username || entry.site || "Sans identifiant"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {entries.length === 0 && (
            <p className="list-empty">{query ? "Aucun résultat" : "Aucun identifiant"}</p>
          )}
        </aside>
        <section className="detail-pane" aria-label="Détails de l'identifiant">
          {selected ? (
            <article className="credential-detail">
              <header className="detail-heading">
                <SiteIcon key={selected.id} id={selected.id} name={selected.name} large />
                <div>
                  <h2>{selected.name}</h2>
                  <p>Identifiant</p>
                </div>
              </header>
              <dl className="detail-fields">
                <div>
                  <dt>Identifiant</dt>
                  <dd>{selected.username || "Non renseigné"}</dd>
                </div>
                <div>
                  <dt>Mot de passe</dt>
                  <dd className="password-value">
                    <code>{secret ? secret.password : "••••••••••••"}</code>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={vault.busy}
                      aria-label={secret ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                      title={secret ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                      onClick={() => vault.reveal(selected.id)}
                    >
                      {secret ? <EyeOff /> : <Eye />}
                    </Button>
                  </dd>
                  {secret && (
                    <p className="field-hint">Masqué automatiquement après 30 secondes.</p>
                  )}
                </div>
                <div>
                  <dt>Site</dt>
                  <dd>{selected.site || "Non renseigné"}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd className="notes">
                    {secret
                      ? secret.notes || "Aucune note"
                      : "Affiche le mot de passe pour lire les notes."}
                  </dd>
                </div>
              </dl>
            </article>
          ) : (
            <div className="empty-detail">
              <KeyRound size={28} strokeWidth={1.25} />
              <h2>{query ? "Aucun identifiant trouvé" : "Aucun identifiant"}</h2>
              <p>
                {query
                  ? "Essaie un autre nom, site ou identifiant."
                  : "Ajoute un identifiant pour le retrouver ici."}
              </p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Authentication({ vault }: { vault: Vault }) {
  const creating = vault.snapshot.status === "missing";

  function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = Schema.decodeUnknownSync(Schema.String)(data.get("password"));

    if (creating && password !== data.get("confirmation")) {
      vault.setError("Les deux mots de passe ne correspondent pas.");

      return;
    }

    form.reset();
    vault.authenticate(password);
  }

  return (
    <section className="auth-view">
      <div className="auth-form">
        <LockKeyhole className="auth-icon" size={28} strokeWidth={1.3} />
        <h1>{creating ? "Créer un coffre" : "Coffre verrouillé"}</h1>
        <p>
          {creating
            ? "Choisis un mot de passe maître d’au moins 12 caractères. Il ne peut pas être réinitialisé."
            : "Saisis ton mot de passe maître pour ouvrir le coffre."}
        </p>
        <form onSubmit={authenticate}>
          <div className="field">
            <Label htmlFor="master-password">Mot de passe maître</Label>
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
              <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
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
            {vault.busy ? "Ouverture…" : creating ? "Créer le coffre" : "Déverrouiller"}
          </Button>
        </form>
      </div>
    </section>
  );
}

export default function App() {
  const vault = useVault();

  return (
    <main className="vault-shell" aria-label="Cairn">
      {vault.error && (
        <p className="error" role="alert">
          {vault.error}
        </p>
      )}
      {Match.value(vault.snapshot.status).pipe(
        Match.when("unlocked", () => <Credentials vault={vault} />),
        Match.when("loading", () => (
          <section className="auth-view">
            <p role="status">Ouverture de Cairn…</p>
            {vault.error && <Button onClick={vault.retry}>Réessayer</Button>}
          </section>
        )),
        Match.when("recovery", () => (
          <section className="auth-view">
            <div className="auth-form">
              <h1>Sauvegarde disponible</h1>
              <p>
                Le coffre principal est introuvable. Ferme Cairn et restaure backups/previous.cairn
                dans le dossier du coffre.
              </p>
              <p>%LOCALAPPDATA%\com.hezaerd.cairn</p>
              <Button onClick={vault.retry}>Vérifier à nouveau</Button>
            </div>
          </section>
        )),
        Match.orElse(() => <Authentication key={vault.snapshot.status} vault={vault} />),
      )}
      <footer className="statusbar">
        <span>
          <LockKeyhole size={12} />
          Coffre local
        </span>
        <span role="status">
          {vault.busy ? "Traitement en cours…" : "Verrouillage automatique après 5 min"}
        </span>
      </footer>
    </main>
  );
}
