import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FaviconServiceLive } from "./favicon/FaviconService";
import { VaultClientLive } from "./vault/VaultClientLive";
import { VaultRuntime } from "./vault/runtime";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, storedTheme } from "./theme/theme";
import { I18nProvider } from "./i18n/I18nProvider";
import { detectLocale, messages } from "./i18n/locale";
import { checkForUpdateOnLaunch } from "./updater/updates";

// Set the theme class before the first render so the window never flashes the wrong palette.
applyTheme(storedTheme());

const vaultRuntime = ManagedRuntime.make(Layer.merge(VaultClientLive, FaviconServiceLive));

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void vaultRuntime.dispose();
  });

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

// Wait for the language so the first frame is already translated.
void Effect.runPromise(detectLocale).then((locale) => {
  document.documentElement.lang = locale;
  checkForUpdateOnLaunch(messages[locale].update);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <I18nProvider locale={locale}>
        <ThemeProvider>
          <VaultRuntime.Provider value={vaultRuntime}>
            <RouterProvider router={router} />
          </VaultRuntime.Provider>
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
});
