import { createContext } from "react";
import type { ManagedRuntime } from "effect";
import type { VaultClient } from "./VaultClient";
import type { FaviconService } from "../favicon/FaviconService";
import type { BrowserService } from "../bridge/BrowserService";

export const VaultRuntime = createContext<ManagedRuntime.ManagedRuntime<
  VaultClient | FaviconService | BrowserService,
  never
> | null>(null);
