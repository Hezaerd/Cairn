import { createContext } from "react";
import type { ManagedRuntime } from "effect";
import type { VaultClient } from "./VaultClient";

export const VaultRuntime = createContext<ManagedRuntime.ManagedRuntime<VaultClient, never> | null>(
  null,
);
