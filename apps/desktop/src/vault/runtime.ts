import { createContext } from "react";
import type { ManagedRuntime } from "effect";
import type { VaultClient } from "./VaultClient";
import type { FaviconService } from "../favicon/FaviconService";

export const VaultRuntime = createContext<ManagedRuntime.ManagedRuntime<
  VaultClient | FaviconService,
  never
> | null>(null);
