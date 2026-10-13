import { type FormEvent } from "react";
import { Schema } from "effect";
import { NewEntry } from "./vault/VaultClient";
import { useVault } from "./vault/useVault";

export default function App() {
  const vault = useVault();
  const { snapshot, busy, error, adding, revealed } = vault;
  const unlocked = snapshot.status === "unlocked";
  const creating = snapshot.status === "missing";

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

  function saveEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const entry = Schema.decodeUnknownSync(NewEntry)(Object.fromEntries(new FormData(form)));
    form.reset();
    vault.save(entry);
  }

  return (
    <main className="vault-shell">
      <header className="vault-header">
        <div>
          <span className="eyebrow">CAIRN / COFFRE LOCAL</span>
          <h1>Ton espace privé.</h1>
        </div>
        {unlocked && (
          <button className="secondary" onClick={vault.lock}>
            Verrouiller
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapshot.status === "loading" ? (
        <section className="panel">
          <p role="status">Ouverture de Cairn…</p>
          {error && <button onClick={vault.retry}>Réessayer</button>}
        </section>
      ) : snapshot.status === "recovery" ? (
        <section className="panel auth-panel">
          <h2>Une sauvegarde est disponible.</h2>
          <p>
            Le coffre principal est introuvable. Ferme Cairn et restaure le fichier
            backups/previous.cairn dans le dossier du coffre avant de continuer.
          </p>
          <p>Emplacement : %LOCALAPPDATA%\com.hezaerd.cairn</p>
          <button onClick={vault.retry}>Vérifier à nouveau</button>
        </section>
      ) : unlocked ? (
        <>
          <section className="section-heading">
            <div>
              <h2>Identifiants</h2>
              <p>{snapshot.entries.length} enregistré(s) sur cet ordinateur</p>
            </div>
            <button disabled={busy} onClick={() => vault.setAdding(true)}>
              Ajouter un identifiant
            </button>
          </section>
          {adding && (
            <form className="panel entry-form" onSubmit={saveEntry}>
              <h2>Nouvel identifiant</h2>
              <label>
                Nom
                <input
                  name="name"
                  required
                  maxLength={256}
                  autoFocus
                  autoComplete="off"
                  placeholder="Ex. Compte personnel"
                />
              </label>
              <label>
                Site
                <input
                  name="site"
                  maxLength={2048}
                  autoComplete="off"
                  placeholder="https://exemple.com"
                />
              </label>
              <label>
                Identifiant
                <input name="username" maxLength={1024} autoComplete="off" />
              </label>
              <label>
                Mot de passe
                <input
                  name="password"
                  type="password"
                  required
                  maxLength={4096}
                  autoComplete="new-password"
                />
              </label>
              <label>
                Notes
                <textarea name="notes" maxLength={16384} rows={3} />
              </label>
              <div className="actions">
                <button disabled={busy} type="submit">
                  Enregistrer
                </button>
                <button type="button" className="secondary" onClick={() => vault.setAdding(false)}>
                  Annuler
                </button>
              </div>
            </form>
          )}
          {snapshot.entries.length === 0 ? (
            <section className="panel empty">
              <h2>Le coffre est prêt.</h2>
              <p>
                Ajoute ton premier identifiant. Il sera enregistré dans le coffre chiffré de cet
                ordinateur.
              </p>
            </section>
          ) : (
            <ul className="entries">
              {snapshot.entries.map((entry) => (
                <li className="panel" key={entry.id}>
                  <div className="entry-heading">
                    <div>
                      <h2>{entry.name}</h2>
                      <p>{entry.username || "Sans identifiant"}</p>
                      {entry.site && <p className="site">{entry.site}</p>}
                    </div>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => vault.reveal(entry.id)}
                    >
                      {revealed?.id === entry.id ? "Masquer" : "Afficher le mot de passe"}
                    </button>
                  </div>
                  {revealed?.id === entry.id && (
                    <div className="secret">
                      <code>{revealed.password}</code>
                      {revealed.notes && <p>{revealed.notes}</p>}
                      <small>Masqué automatiquement après 30 secondes.</small>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {busy && <p role="status">Traitement en cours…</p>}
        </>
      ) : (
        <section className="panel auth-panel" key={snapshot.status}>
          <span className="eyebrow">{creating ? "PREMIÈRE OUVERTURE" : "COFFRE VERROUILLÉ"}</span>
          <h2>{creating ? "Crée ton coffre." : "Bienvenue chez toi."}</h2>
          <p>
            {creating
              ? "Choisis une phrase secrète d'au moins 12 caractères. Elle protège l'accès à tous tes identifiants et ne peut pas être réinitialisée."
              : "Saisis ton mot de passe maître pour accéder à tes identifiants."}
          </p>
          <form onSubmit={authenticate}>
            <label>
              Mot de passe maître
              <input
                name="password"
                type="password"
                required
                minLength={creating ? 12 : 1}
                maxLength={1024}
                autoFocus
                autoComplete={creating ? "new-password" : "current-password"}
                disabled={busy}
              />
            </label>
            {creating && (
              <label>
                Confirmer le mot de passe
                <input
                  name="confirmation"
                  type="password"
                  required
                  minLength={12}
                  maxLength={1024}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
            )}
            <button disabled={busy} type="submit">
              {busy ? "Ouverture…" : creating ? "Créer le coffre" : "Déverrouiller"}
            </button>
          </form>
        </section>
      )}
      <footer>Stockage local chiffré · Verrouillage après 5 min sans accès au coffre</footer>
    </main>
  );
}
