import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { ArrowLeft, Palette, Settings as SettingsIcon, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/I18nProvider";

export const Route = createFileRoute("/settings")({ component: Settings });

const sectionLink =
  "relative mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs hover:bg-accent aria-[current=page]:bg-selection aria-[current=page]:font-semibold aria-[current=page]:before:absolute aria-[current=page]:before:left-0 aria-[current=page]:before:h-[18px] aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-xs aria-[current=page]:before:bg-primary [&_svg]:text-muted-foreground";

function Settings() {
  const t = useT();

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label={t.settings.title}>
      <div className="flex min-h-[57px] items-center gap-2 border-b px-4 py-2.5 max-[680px]:px-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t.settings.back} title={t.settings.back}>
            <ArrowLeft />
          </Link>
        </Button>
        <SettingsIcon size={16} />
        <h1 className="font-semibold">{t.settings.title}</h1>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-[680px]:grid-cols-[170px_minmax(0,1fr)]">
        <nav className="border-r bg-muted px-1.5 py-3" aria-label={t.settings.sections}>
          <Link to="/settings/general" className={sectionLink}>
            <SlidersHorizontal size={16} />
            {t.settings.general}
          </Link>
          <Link to="/settings/appearance" className={sectionLink}>
            <Palette size={16} />
            {t.settings.appearance}
          </Link>
        </nav>
        <div className="min-h-0 overflow-y-auto">
          <div className="mx-auto grid max-w-[760px] gap-4 px-6 py-6 max-[680px]:px-4">
            <Outlet />
          </div>
        </div>
      </div>
    </main>
  );
}
