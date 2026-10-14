import { KeyRound } from "lucide-react";
import {
  ListItem,
  ListItemContent,
  ListItemDescription,
  ListItemTitle,
} from "@cairn/ui/components/list-item";
import { t } from "./i18n";

interface Props {
  readonly name: string;
  readonly username: string;
  readonly onFill: () => void;
}

/** A login in a list, styled like the app's list of logins. Clicking it fills the page. */
export function Login({ name, username, onFill }: Props) {
  return (
    <ListItem type="button" size="sm" onClick={onFill}>
      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-background text-muted-foreground">
        <KeyRound className="size-3.5" />
      </span>
      <ListItemContent>
        <ListItemTitle>{name}</ListItemTitle>
        <ListItemDescription>{username || t("noUsername")}</ListItemDescription>
      </ListItemContent>
    </ListItem>
  );
}
