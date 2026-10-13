import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { Layer, ManagedRuntime } from "effect";
import { FaviconServiceLive } from "./favicon/FaviconService";
import { VaultClientLive } from "./vault/VaultClientLive";
import { VaultRuntime } from "./vault/runtime";

const vaultRuntime = ManagedRuntime.make(Layer.merge(VaultClientLive, FaviconServiceLive));

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    void vaultRuntime.dispose();
  });

const root = document.getElementById("root");

if (!root) throw new Error("Missing application root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <VaultRuntime.Provider value={vaultRuntime}>
      <RouterProvider router={router} />
    </VaultRuntime.Provider>
  </React.StrictMode>,
);
