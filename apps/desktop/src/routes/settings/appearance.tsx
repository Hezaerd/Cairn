import { createFileRoute } from "@tanstack/react-router";
import { useT } from "@/i18n/I18nProvider";
import { ColorSchemePicker } from "@/theme/ColorSchemePicker";

export const Route = createFileRoute("/settings/appearance")({ component: Appearance });

function Appearance() {
  const t = useT();

  return (
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
  );
}
