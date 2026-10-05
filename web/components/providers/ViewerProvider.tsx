"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { CapabilitySet } from "@/lib/auth/rbac";
import type { TransitionActor } from "@/lib/kanban/move-rules";

interface Viewer {
  capabilities: CapabilitySet;
  roles: string[];
  personnelId: string | null;
}

const ViewerContext = createContext<Viewer | null>(null);

/**
 * Hands the signed-in person's real effective capabilities (their roles plus their per-person
 * overrides, resolved once on the server in the shell layout), their roles and their personnel id
 * to any component under it.
 *
 * Exists because the board passes each card a single collapsed role string ("admin", "operator" or
 * "artist"), which cannot express a curator, or anyone whose access comes from a capability
 * override. A component that decides what to show from that string disagrees with the API routes,
 * which check real capabilities. Reading the capabilities here means a control shows for exactly
 * the people the server will let use it.
 */
export function ViewerProvider({
  capabilities,
  roles,
  personnelId,
  children,
}: {
  capabilities: CapabilitySet;
  roles: string[];
  personnelId: string | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ capabilities, roles, personnelId }), [capabilities, roles, personnelId]);
  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

function useViewer(): Viewer {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error("useViewer must be used inside a ViewerProvider");
  return viewer;
}

/**
 * The signed-in person's effective capabilities. Throws outside a ViewerProvider, which every
 * internal page has through the shell layout, so a missing provider is a wiring mistake to see
 * immediately and not a state to render around.
 */
export function useViewerCapabilities(): CapabilitySet {
  return useViewer().capabilities;
}

/** The signed-in person's personnel id, or null when they have no personnel record. */
export function useViewerPersonnelId(): string | null {
  return useViewer().personnelId;
}

/** The signed-in person's roles, as the server resolved them. */
export function useViewerRoles(): string[] {
  return useViewer().roles;
}

/** The signed-in person as a card mover, in the shape checkMove (lib/kanban/move-rules.ts) takes. */
export function useViewerAsActor(): TransitionActor {
  const { capabilities, roles, personnelId } = useViewer();
  return useMemo(
    () => ({ roles, personnelId: personnelId ?? undefined, caps: capabilities }),
    [capabilities, roles, personnelId]
  );
}
