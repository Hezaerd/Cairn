import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Effect } from "effect";
import { toast } from "@cairn/ui/components/sonner";
import { messages, saveLanguage, type Language, type Locale } from "./locale";
import type { Messages } from "./en-US";

const I18nContext = createContext<Messages | null>(null);

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (chosen: Locale | null) => void;
} | null>(null);

export function I18nProvider({ initial, children }: { initial: Language; children: ReactNode }) {
  const [language, setLanguage] = useState(initial);
  const t = messages[language.locale];

  useEffect(() => {
    document.documentElement.lang = language.locale;
  }, [language.locale]);

  return (
    <LanguageContext.Provider
      value={{
        language,
        setLanguage: (chosen) =>
          void Effect.runPromise(
            saveLanguage(chosen).pipe(
              Effect.tap((next) => Effect.sync(() => setLanguage(next))),
              Effect.catch(() =>
                Effect.sync(() => toast.error(t.settings.languageFailed, { id: "language" })),
              ),
            ),
          ),
      }}
    >
      <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
    </LanguageContext.Provider>
  );
}

export function useT() {
  const context = useContext(I18nContext);

  if (!context) throw new Error("useT must be used within I18nProvider");

  return context;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) throw new Error("useLanguage must be used within I18nProvider");

  return context;
}
