import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import {
  ArrowLeft,
  Palette,
  Puzzle,
  Settings as SettingsIcon,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@cairn/ui/components/button";
import { ListItem } from "@cairn/ui/components/list-item";
import { Toolbar } from "@cairn/ui/components/toolbar";
import { useT } from "@/i18n/I18nProvider";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const t = useT();

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t.settings.title}>
      <Toolbar>
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t.settings.back} title={t.settings.back}>
            <ArrowLeft />
          </Link>
        </Button>
        <SettingsIcon size={16} />
        <h1 className="font-semibold">{t.settings.title}</h1>
      </Toolbar>
      <div className="grid min-h-0 flex-1 grid-cols-settings max-compact:grid-cols-settings-narrow">
        <nav
          className="grid content-start gap-0.5 border-r bg-muted px-1.5 py-3"
          aria-label={t.settings.sections}
        >
          <ListItem size="sm" asChild>
            <Link to="/settings/general">
              <SlidersHorizontal size={16} />
              {t.settings.general}
            </Link>
          </ListItem>
          <ListItem size="sm" asChild>
            <Link to="/settings/appearance">
              <Palette size={16} />
              {t.settings.appearance}
            </Link>
          </ListItem>
          <ListItem size="sm" asChild>
            <Link to="/settings/extension">
              <Puzzle size={16} />
              {t.settings.extension}
            </Link>
          </ListItem>
        </nav>
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto grid max-w-190 gap-4 px-6 py-6 max-compact:px-4">
            <Outlet />
          </div>
        </div>
      </div>
    </main>
  );
}
