import { useRef, type FormEvent, type ReactNode } from "react";
import { Schema } from "effect";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
import { EntryUpdate, NewEntry, type EntrySummary } from "./VaultClient";
import type { useVault } from "./useVault";
import { PasswordGenerator } from "../generator/PasswordGenerator";
import { useT } from "../i18n/I18nProvider";

type Vault = ReturnType<typeof useVault>;

export function FormField({
  id,
  label,
  children,
}: {
  id: string;
  label: ReactNode;
  children: ReactNode;
}) {
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

export function EntryDialog({ vault }: { vault: Vault }) {
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

export function EditDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
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

export function DeleteDialog({ vault, entry }: { vault: Vault; entry: EntrySummary }) {
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

export function DetailField({
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
