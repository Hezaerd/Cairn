import { createFileRoute } from "@tanstack/react-router";
import { Card, CardTitle, Section, SectionTitle } from "@cairn/ui/components/card";
import { useT } from "@/i18n/I18nProvider";
import { ColorSchemePicker } from "@/theme/ColorSchemePicker";

export const Route = createFileRoute("/settings/appearance")({ component: Appearance });

function Appearance() {
  const t = useT();

  return (
    <Section aria-labelledby="appearance">
      <SectionTitle id="appearance">{t.settings.appearance}</SectionTitle>
      <Card layout="stack">
        <CardTitle id="color-scheme">{t.settings.colorScheme}</CardTitle>
        <ColorSchemePicker labelledBy="color-scheme" />
      </Card>
    </Section>
  );
}
