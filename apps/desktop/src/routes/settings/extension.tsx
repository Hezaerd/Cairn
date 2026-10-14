import { createFileRoute } from "@tanstack/react-router";
import { Card, CardDescription, Section, SectionTitle } from "@cairn/ui/components/card";
import { PairedBrowsers } from "@/bridge/Browsers";
import { ExtensionSettings } from "@/connector/ExtensionSettings";
import { useT } from "@/i18n/I18nProvider";

export const Route = createFileRoute("/settings/extension")({ component: Extension });

function Extension() {
  const t = useT();

  return (
    <>
      <Section aria-labelledby="extension">
        <SectionTitle id="extension">{t.settings.extension}</SectionTitle>
        <Card>
          <ExtensionSettings labelledBy="extension-folder" />
        </Card>
      </Section>
      <Section aria-labelledby="browsers" aria-describedby="browsers-hint">
        <SectionTitle id="browsers">{t.browsers.title}</SectionTitle>
        <Card layout="stack">
          <CardDescription id="browsers-hint">{t.browsers.description}</CardDescription>
          <PairedBrowsers />
        </Card>
      </Section>
    </>
  );
}
