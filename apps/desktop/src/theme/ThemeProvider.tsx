import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  applyTheme,
  applyWindowTheme,
  storedTheme,
  storeTheme,
  systemDark,
  type Theme,
} from "./theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(storedTheme);

  useEffect(() => {
    applyTheme(theme);
    applyWindowTheme(theme);

    if (theme !== "system") return;

    const update = () => applyTheme(theme);

    systemDark.addEventListener("change", update);

    return () => systemDark.removeEventListener("change", update);
  }, [theme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme: (next) => {
          storeTheme(next);
          setTheme(next);
        },
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) throw new Error("useTheme must be used within ThemeProvider");

  return context;
}
