"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { CapabilitySet } from "@/lib/auth/rbac";

const ViewerCapabilitiesContext = createContext<CapabilitySet | null>(null);

/**
 * Hands the signed-in person's real effective capabilities (their roles plus their per-person
 * overrides, resolved once on the server in the shell layout) to any component under it.
 *
 * Exists because the board passes each card a single collapsed role string ("admin", "operator" or
 * "artist"), which cannot express a curator, or anyone whose access comes from a capability
 * override. A component that decides what to show from that string disagrees with the API routes,
 * which check real capabilities. Reading the capabilities here means a control shows for exactly
 * the people the server will let use it.
 */
export function ViewerProvider({ capabilities, children }: { capabilities: CapabilitySet; children: ReactNode }) {
  return <ViewerCapabilitiesContext.Provider value={capabilities}>{children}</ViewerCapabilitiesContext.Provider>;
}

/**
 * The signed-in person's effective capabilities. Throws outside a ViewerProvider, which every
 * internal page has through the shell layout, so a missing provider is a wiring mistake to see
 * immediately and not a state to render around.
 */
export function useViewerCapabilities(): CapabilitySet {
  const capabilities = useContext(ViewerCapabilitiesContext);
  if (!capabilities) throw new Error("useViewerCapabilities must be used inside a ViewerProvider");
  return capabilities;
}
