import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Effect, Layer, ManagedRuntime } from "effect";
import { FaviconServiceLive } from "./favicon/FaviconService";
import { BrowserServiceLive } from "./bridge/BrowserService";
import { VaultClientLive } from "./vault/VaultClientLive";
import { VaultRuntime } from "./vault/runtime";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, storedTheme } from "./theme/theme";
import { I18nProvider } from "./i18n/I18nProvider";
import { loadLanguage, messages } from "./i18n/locale";
import { checkForUpdateOnLaunch } from "./updater/updates";

// Set the theme class before the first render so the window never flashes the wrong palette.
applyTheme(storedTheme());

const vaultRuntime = ManagedRuntime.make(
  Layer.mergeAll(VaultClientLive, FaviconServiceLive, BrowserServiceLive),
);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void vaultRuntime.dispose();
  });

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

// Wait for the language so the first frame is already translated.
void Effect.runPromise(loadLanguage).then((language) => {
  document.documentElement.lang = language.locale;
  checkForUpdateOnLaunch(messages[language.locale].update);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <I18nProvider initial={language}>
        <ThemeProvider>
          <VaultRuntime.Provider value={vaultRuntime}>
            <RouterProvider router={router} />
          </VaultRuntime.Provider>
        </ThemeProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
});
