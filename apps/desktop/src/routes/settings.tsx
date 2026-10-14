import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExtensionSettings } from "@/connector/ExtensionSettings";
import { useT } from "@/i18n/I18nProvider";
import { ColorSchemePicker } from "@/theme/ColorSchemePicker";
import { UpdateSettings } from "@/updater/UpdateSettings";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const t = useT();

  return (
    <main className="flex h-dvh flex-col overflow-hidden" aria-label={t.settings.title}>
      <div className="flex min-h-[57px] items-center gap-2 border-b px-4 py-2.5 max-[680px]:px-3">
        <Button variant="ghost" size="icon-sm" asChild>
          <Link to="/" aria-label={t.settings.back} title={t.settings.back}>
            <ArrowLeft />
          </Link>
        </Button>
        <SettingsIcon size={16} />
        <h1 className="font-semibold">{t.settings.title}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[760px] gap-4 px-6 py-6 max-[680px]:px-4">
          <section aria-labelledby="appearance" className="grid gap-3">
            <h2 id="appearance" className="text-[11px] text-muted-foreground">
              {t.settings.appearance}
            </h2>
            <div className="grid gap-3 rounded-lg border bg-muted/50 p-4">
              <h3 id="color-scheme" className="text-sm">
                {t.settings.colorScheme}
              </h3>
              <ColorSchemePicker labelledBy="color-scheme" />
            </div>
          </section>
          <section aria-labelledby="updates" className="grid gap-3">
            <h2 id="updates" className="text-[11px] text-muted-foreground">
              {t.settings.updates}
            </h2>
            <div className="rounded-lg border bg-muted/50 p-4">
              <UpdateSettings labelledBy="update-channel" />
            </div>
          </section>
          <section aria-labelledby="extension" className="grid gap-3">
            <h2 id="extension" className="text-[11px] text-muted-foreground">
              {t.settings.extension}
            </h2>
            <div className="rounded-lg border bg-muted/50 p-4">
              <ExtensionSettings labelledBy="extension-folder" />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
