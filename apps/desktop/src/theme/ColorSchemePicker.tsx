import { ChoiceCard, ChoiceCardTitle } from "@cairn/ui/components/choice-card";
import { useT } from "../i18n/I18nProvider";
import type { Theme } from "./theme";
import { setTheme, usePreferences } from "../store/preferences";
import { ThemeWireframe } from "./ThemeWireframe";

const themes = ["system", "light", "dark"] as const satisfies ReadonlyArray<Theme>;

const labels = { system: "useSystem", light: "useLight", dark: "useDark" } as const;

export function ColorSchemePicker({ labelledBy }: { labelledBy: string }) {
  const theme = usePreferences((state) => state.theme);
  const t = useT();

  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-3">
      {themes.map((option) => (
        <ChoiceCard
          key={option}
          size="media"
          aria-pressed={theme === option}
          title={t.theme[labels[option]]}
          onClick={() => setTheme(option)}
        >
          <ThemeWireframe theme={option} />
          <ChoiceCardTitle>{t.theme[option]}</ChoiceCardTitle>
        </ChoiceCard>
      ))}
    </div>
  );
}
