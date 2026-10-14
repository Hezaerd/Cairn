import { KeyRound } from "lucide-react";
import { t } from "./i18n";

interface Props {
  readonly name: string;
  readonly username: string;
  readonly onFill: () => void;
}

/** A login in a list, styled like the app's list of logins. Clicking it fills the page. */
export function Login({ name, username, onFill }: Props) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2.5 rounded-md p-2 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onClick={onFill}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
        <KeyRound className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 *:truncate">
        <strong className="text-xs font-semibold">{name}</strong>
        <span className="text-2xs text-muted-foreground">{username || t("noUsername")}</span>
      </span>
    </button>
  );
}
