import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage, useT } from "@/i18n/I18nProvider";
import { Locale, localeNames, locales } from "@/i18n/locale";

export const Route = createFileRoute("/settings/general")({ component: General });

const system = "system";

const decodeChoice = Schema.decodeUnknownSync(Schema.Union([Locale, Schema.Literal(system)]));

function General() {
  const t = useT();
  const { language, setLanguage } = useLanguage();

  return (
    <section aria-labelledby="general" className="grid gap-3">
      <h2 id="general" className="text-[11px] text-muted-foreground">
        {t.settings.general}
      </h2>
      <div className="flex items-center justify-between gap-6 rounded-lg border bg-muted/50 p-4 max-[680px]:flex-col max-[680px]:items-stretch max-[680px]:gap-3">
        <div className="grid gap-1">
          <h3 id="language" className="text-sm">
            {t.settings.language}
          </h3>
          <p id="language-hint" className="text-xs text-muted-foreground">
            {t.settings.languageHint}
          </p>
        </div>
        <Select
          value={language.chosen ?? system}
          onValueChange={(value) => {
            const choice = decodeChoice(value);
            setLanguage(choice === system ? null : choice);
          }}
        >
          <SelectTrigger
            className="w-56 max-[680px]:w-full"
            aria-labelledby="language"
            aria-describedby="language-hint"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={system}>{t.language.system}</SelectItem>
            <SelectSeparator />
            {locales.map((locale) => (
              <SelectItem key={locale} value={locale} lang={locale}>
                {localeNames[locale]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
