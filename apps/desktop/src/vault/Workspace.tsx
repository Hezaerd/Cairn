import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound, LockKeyhole, Search, Settings, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import type { EntrySummary } from "./VaultClient";
import type { useVault } from "./useVault";
import { SiteIcon } from "../favicon/SiteIcon";
import { PairingDialog } from "../bridge/Browsers";
import { useT } from "../i18n/I18nProvider";
import { showView, useNavigation } from "../store/navigation";

type Vault = ReturnType<typeof useVault>;

const tab =
  "flex items-center gap-2 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

/** The tabs for the two views, the view's own actions, and what both share. */
export function Toolbar({ vault, children }: { vault: Vault; children: ReactNode }) {
  const t = useT();
  const view = useNavigation((state) => state.view);
  const logins = vault.snapshot.entries.filter((entry) => entry.hasPassword).length;
  const codes = vault.snapshot.entries.filter((entry) => entry.hasTotp).length;

  return (
    <div className="flex min-h-[57px] items-center gap-2 border-b px-4 py-2.5 max-[680px]:px-3">
      <nav className="mr-auto flex items-center gap-1" aria-label={t.views.label}>
        <button
          type="button"
          className={tab}
          aria-current={view === "logins" ? "page" : undefined}
          onClick={() => showView("logins")}
        >
          <KeyRound size={16} />
          <span className="text-sm">{t.credentials.title}</span>
          <span className="text-xs font-normal text-muted-foreground">{logins}</span>
        </button>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <button
          type="button"
          className={tab}
          aria-current={view === "authenticator" ? "page" : undefined}
          onClick={() => showView("authenticator")}
        >
          <Timer size={16} />
          <span className="text-sm">{t.views.authenticator}</span>
          <span className="text-xs font-normal text-muted-foreground">{codes}</span>
        </button>
      </nav>
      {children}
      <Button variant="ghost" size="icon-sm" asChild>
        <Link to="/settings" aria-label={t.settings.open} title={t.settings.open}>
          <Settings />
        </Link>
      </Button>
      <Button variant="outline" size="sm" onClick={vault.lock}>
        <LockKeyhole />
        {t.credentials.lock}
      </Button>
      <PairingDialog />
    </div>
  );
}

/** The searchable list on the left of a view. */
export function EntryList({
  label,
  searchLabel,
  heading,
  empty,
  entries,
  selected,
  query,
  onQuery,
  onSelect,
  marker,
}: {
  label: string;
  searchLabel: string;
  heading: string;
  empty: string;
  entries: ReadonlyArray<EntrySummary>;
  selected: EntrySummary | undefined;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  marker?: (entry: EntrySummary) => ReactNode;
}) {
  const t = useT();

  return (
    <aside className="flex min-h-0 flex-col border-r bg-muted" aria-label={label}>
      <div className="relative mx-3 mt-4 mb-3">
        <Search size={15} className="absolute top-[9px] left-2.5 text-muted-foreground" />
        <Input
          className="h-8 bg-background pl-8 dark:bg-background"
          aria-label={searchLabel}
          placeholder={t.credentials.searchPlaceholder}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      <div className="px-4 pb-2.5 text-[11px] text-muted-foreground">{heading}</div>
      <ul className="overflow-y-auto px-1.5 pb-1.5">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              className="relative mb-0.5 flex w-full items-center gap-2.5 rounded-md p-2.5 text-left hover:bg-accent aria-[current=true]:bg-selection aria-[current=true]:before:absolute aria-[current=true]:before:left-0 aria-[current=true]:before:h-[18px] aria-[current=true]:before:w-[3px] aria-[current=true]:before:rounded-xs aria-[current=true]:before:bg-primary"
              aria-current={selected?.id === entry.id ? "true" : undefined}
              onClick={() => onSelect(entry.id)}
            >
              <SiteIcon key={entry.site} id={entry.id} name={entry.name} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 *:truncate">
                <strong className="text-xs font-semibold">{entry.name}</strong>
                <span className="text-[11px] text-muted-foreground">
                  {entry.username || entry.site || t.credentials.noUsername}
                </span>
              </span>
              {marker?.(entry)}
            </button>
          </li>
        ))}
      </ul>
      {entries.length === 0 && (
        <p className="p-4 text-xs text-muted-foreground">
          {query ? t.credentials.noResults : empty}
        </p>
      )}
    </aside>
  );
}

/** What the details pane shows without a selection. */
export function NoSelection({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="p-8 md:p-8">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia className="text-muted-foreground">{icon}</EmptyMedia>
        <EmptyTitle role="heading" aria-level={2} className="text-[15px] font-semibold">
          {title}
        </EmptyTitle>
        <EmptyDescription className="text-xs">{hint}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  );
}

/** Whether an entry's name, username, or site contains `query`, ignoring case. */
export function matches(entry: EntrySummary, query: string) {
  const needle = query.toLocaleLowerCase();

  return [entry.name, entry.username, entry.site].some((value) =>
    value.toLocaleLowerCase().includes(needle),
  );
}
