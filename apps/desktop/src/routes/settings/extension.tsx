import { createFileRoute } from "@tanstack/react-router";
import { ExtensionSettings } from "@/connector/ExtensionSettings";
import { useT } from "@/i18n/I18nProvider";

export const Route = createFileRoute("/settings/extension")({ component: Extension });

function Extension() {
  const t = useT();

  return (
    <section aria-labelledby="extension" className="grid gap-3">
      <h2 id="extension" className="text-2xs text-muted-foreground">
        {t.settings.extension}
      </h2>
      <div className="rounded-lg border bg-muted/50 p-4">
        <ExtensionSettings labelledBy="extension-folder" />
      </div>
    </section>
  );
}
