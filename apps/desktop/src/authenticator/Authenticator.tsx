import { useState } from "react";
import { Pencil, Timer, Trash2 } from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@cairn/ui/components/dialog";
import { useT } from "../i18n/I18nProvider";
import { SiteIcon } from "../favicon/SiteIcon";
import type { EntrySummary } from "../vault/VaultClient";
import type { useVault } from "../vault/useVault";
import { DetailField, EditDialog } from "../vault/EntryDialogs";
import { EntryList, NoSelection, Toolbar, matches } from "../vault/Workspace";
import { searchEntries, selectEntry, useNavigation } from "../store/navigation";
import { AddCodesDialog } from "./AddCodes";
import { OneTimeCode } from "./OneTimeCode";

type Vault = ReturnType<typeof useVault>;

/**
 * Removes an entry's authenticator key. A login keeps its password; an entry
 * that holds only the key leaves the vault.
 */
function RemoveCodeDialog({
  vault,
  entry,
  open,
  onOpenChange,
}: {
  vault: Vault;
  entry: EntrySummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();

  function remove() {
    onOpenChange(false);

    if (entry.hasPassword)
      vault.update(entry.id, {
        name: entry.name,
        site: entry.site,
        username: entry.username,
        password: null,
        notes: null,
        totp: "",
      });
    else vault.remove(entry.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close}>
        <DialogHeader>
          <DialogTitle>{t.authenticator.removeTitle(entry.name)}</DialogTitle>
          <DialogDescription>
            {entry.hasPassword
              ? t.authenticator.removeKeepsLogin
              : t.authenticator.removeDeletesEntry}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button disabled={vault.busy} variant="destructive" onClick={remove}>
            {t.authenticator.removeConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The entries that hold an authenticator key, laid out like the logins. */
export function Authenticator({ vault }: { vault: Vault }) {
  const t = useT();
  const query = useNavigation((state) => state.query.authenticator);
  const selectedId = useNavigation((state) => state.selected.authenticator);
  const [removing, setRemoving] = useState<string | null>(null);
  const entries = vault.snapshot.entries.filter((entry) => entry.hasTotp && matches(entry, query));
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0];

  return (
    <>
      <Toolbar vault={vault}>
        <AddCodesDialog vault={vault} />
      </Toolbar>
      <div className="grid min-h-0 flex-1 grid-cols-sidebar max-compact:grid-cols-sidebar-narrow">
        <EntryList
          label={t.authenticator.list}
          searchLabel={t.authenticator.search}
          heading={t.authenticator.all}
          empty={t.authenticator.empty}
          entries={entries}
          selected={selected}
          query={query}
          onQuery={(next) => searchEntries("authenticator", next)}
          onSelect={(id) => selectEntry("authenticator", id)}
        />
        <section className="flex overflow-y-auto" aria-label={t.authenticator.details}>
          {selected ? (
            <article className="w-full max-w-180 p-8 max-compact:p-5.5">
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
                    {selected.hasPassword ? t.authenticator.withLogin : t.credentials.codeOnly}
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
                    aria-label={t.authenticator.remove}
                    title={t.authenticator.remove}
                    onClick={() => setRemoving(selected.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </header>
              <EditDialog vault={vault} entry={selected} />
              <RemoveCodeDialog
                vault={vault}
                entry={selected}
                open={removing === selected.id}
                onOpenChange={(open) => setRemoving(open ? selected.id : null)}
              />
              <dl>
                <DetailField
                  label={t.credentials.code}
                  className="flex items-center justify-between gap-3"
                >
                  <OneTimeCode key={selected.id} id={selected.id} />
                </DetailField>
                <DetailField label={t.entry.username}>
                  {selected.username || t.common.notSet}
                </DetailField>
                <DetailField label={t.entry.site}>{selected.site || t.common.notSet}</DetailField>
              </dl>
            </article>
          ) : (
            <NoSelection
              icon={<Timer size={28} strokeWidth={1.25} />}
              title={query ? t.authenticator.notFound : t.authenticator.empty}
              hint={query ? t.credentials.notFoundHint : t.authenticator.emptyHint}
            />
          )}
        </section>
      </div>
    </>
  );
}
