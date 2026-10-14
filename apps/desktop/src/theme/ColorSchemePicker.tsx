import { cn } from "@/lib/utils";
import { useT } from "../i18n/I18nProvider";
import type { Theme } from "./theme";
import { useTheme } from "./ThemeProvider";
import { ThemeWireframe } from "./ThemeWireframe";

const themes = ["system", "light", "dark"] as const satisfies ReadonlyArray<Theme>;

const labels = { system: "useSystem", light: "useLight", dark: "useDark" } as const;

export function ColorSchemePicker({ labelledBy }: { labelledBy: string }) {
  const { theme, setTheme } = useTheme();
  const t = useT();

  return (
    <div role="group" aria-labelledby={labelledBy} className="grid grid-cols-3 gap-3">
      {themes.map((option) => {
        const active = theme === option;

        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            title={t.theme[labels[option]]}
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-2 transition-colors",
              active
                ? "border-ring bg-selection/60 inset-ring inset-ring-ring"
                : "hover:bg-accent/60",
            )}
            onClick={() => setTheme(option)}
          >
            <ThemeWireframe theme={option} />
            <span
              className={cn(
                "text-xs",
                active ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {t.theme[option]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
