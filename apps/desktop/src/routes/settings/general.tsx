import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@cairn/ui/components/select";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Section,
  SectionTitle,
} from "@cairn/ui/components/card";
import { useLanguage, useT } from "@/i18n/I18nProvider";
import { Locale, localeNames, locales } from "@/i18n/locale";
import { UpdateSettings } from "@/updater/UpdateSettings";

export const Route = createFileRoute("/settings/general")({ component: General });

const system = "system";

const decodeChoice = Schema.decodeUnknownSync(Schema.Union([Locale, Schema.Literal(system)]));

function General() {
  const t = useT();
  const { language, setLanguage } = useLanguage();

  return (
    <>
      <Section aria-labelledby="general">
        <SectionTitle id="general">{t.settings.general}</SectionTitle>
        <Card layout="row">
          <CardHeader>
            <CardTitle id="language">{t.settings.language}</CardTitle>
            <CardDescription id="language-hint">{t.settings.languageHint}</CardDescription>
          </CardHeader>
          <Select
            value={language.chosen ?? system}
            onValueChange={(value) => {
              const choice = decodeChoice(value);
              setLanguage(choice === system ? null : choice);
            }}
          >
            <SelectTrigger
              className="w-56 max-compact:w-full"
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
        </Card>
      </Section>
      <Section aria-labelledby="updates">
        <SectionTitle id="updates">{t.settings.updates}</SectionTitle>
        <Card>
          <UpdateSettings labelledBy="update-channel" />
        </Card>
      </Section>
    </>
  );
}
