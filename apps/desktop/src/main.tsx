import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Layer, ManagedRuntime } from "effect";
import { FaviconServiceLive } from "./favicon/FaviconService";
import { VaultClientLive } from "./vault/VaultClientLive";
import { VaultRuntime } from "./vault/runtime";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, storedTheme } from "./theme/theme";
import { checkForUpdateOnLaunch } from "./updater/updates";

// Set the theme class before the first render so the window never flashes the wrong palette.
applyTheme(storedTheme());

const vaultRuntime = ManagedRuntime.make(Layer.merge(VaultClientLive, FaviconServiceLive));

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void vaultRuntime.dispose();
  });

checkForUpdateOnLaunch();

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider>
      <VaultRuntime.Provider value={vaultRuntime}>
        <RouterProvider router={router} />
      </VaultRuntime.Provider>
    </ThemeProvider>
  </React.StrictMode>,
);
