import { createContext, useContext, type ReactNode } from "react";
import { messages, type Locale } from "./locale";
import type { Messages } from "./en-US";

const I18nContext = createContext<Messages | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={messages[locale]}>{children}</I18nContext.Provider>;
}

export function useT() {
  const context = useContext(I18nContext);

  if (!context) throw new Error("useT must be used within I18nProvider");

  return context;
}
