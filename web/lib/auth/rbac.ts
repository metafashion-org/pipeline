export type SystemRole =
  | "admin"
  | "operator"
  | "curator"
  | "artist"
  | "publisher"
  | "marketing"
  | "payment_admin";

// The live personnel.roles data uses "uploader" for the role the brief calls
// "Uploader," which docs/PLAN.md §5 defines as this app's "publisher" role.
// Alias it to publisher's capability set instead of duplicating it.
export const ROLE_ALIASES: Record<string, SystemRole> = {
  uploader: "publisher",
};

export interface CapabilitySet {
  canAssignArtists: boolean;
  canMoveToInProduction: boolean;
  canMoveToInReview: boolean;
  canRequestRevisions: boolean;
  canApprove: boolean;
  canAssignPublisher: boolean;
  canPublishToRoblox: boolean;
  canMarkForPayment: boolean;
  canMarkPaymentDone: boolean;
  canViewAllAssets: boolean;
  canManageSystemConfig: boolean;
  canAccessCuratorTools: boolean;
  canAccessMarketingTools: boolean;
}

export const ROLE_DEFAULT_CAPABILITIES: Record<SystemRole, CapabilitySet> = {
  admin: {
    canAssignArtists: true,
    canMoveToInProduction: true,
    canMoveToInReview: true,
    canRequestRevisions: true,
    canApprove: true,
    canAssignPublisher: true,
    canPublishToRoblox: true,
    canMarkForPayment: true,
    canMarkPaymentDone: true,
    canViewAllAssets: true,
    canManageSystemConfig: true,
    canAccessCuratorTools: true,
    canAccessMarketingTools: true,
  },
  operator: {
    canAssignArtists: true,
    canMoveToInProduction: true,
    canMoveToInReview: true,
    canRequestRevisions: true,
    canApprove: true,
    canAssignPublisher: true,
    canPublishToRoblox: false,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: true,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: false,
  },
  curator: {
    canAssignArtists: false,
    canMoveToInProduction: false,
    canMoveToInReview: false,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: false,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: false,
    canManageSystemConfig: false,
    canAccessCuratorTools: true,
    canAccessMarketingTools: false,
  },
  artist: {
    canAssignArtists: false,
    canMoveToInProduction: true,
    canMoveToInReview: true,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: false,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: false,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: false,
  },
  publisher: {
    canAssignArtists: false,
    canMoveToInProduction: false,
    canMoveToInReview: false,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: true,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: false,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: false,
  },
  marketing: {
    canAssignArtists: false,
    canMoveToInProduction: false,
    canMoveToInReview: false,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: false,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: false,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: true,
  },
  payment_admin: {
    canAssignArtists: false,
    canMoveToInProduction: false,
    canMoveToInReview: false,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: false,
    canMarkForPayment: true,
    canMarkPaymentDone: true,
    canViewAllAssets: true,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: false,
  },
};

/**
 * Computes the union of capabilities for a user given their roles and optional per-person overrides.
 */
export function getEffectiveCapabilities(
  roles: (SystemRole | string)[],
  capabilityOverrides: Record<string, boolean> = {}
): CapabilitySet {
  // Start with all capabilities false
  const effective: CapabilitySet = {
    canAssignArtists: false,
    canMoveToInProduction: false,
    canMoveToInReview: false,
    canRequestRevisions: false,
    canApprove: false,
    canAssignPublisher: false,
    canPublishToRoblox: false,
    canMarkForPayment: false,
    canMarkPaymentDone: false,
    canViewAllAssets: false,
    canManageSystemConfig: false,
    canAccessCuratorTools: false,
    canAccessMarketingTools: false,
  };

  // Union capabilities granted by any assigned role
  for (const roleKey of roles) {
    const normalized = roleKey.toLowerCase();
    const rKey = (ROLE_ALIASES[normalized] ?? normalized) as SystemRole;
    const defaults = ROLE_DEFAULT_CAPABILITIES[rKey];
    if (defaults) {
      for (const cap in defaults) {
        const key = cap as keyof CapabilitySet;
        if (defaults[key]) {
          effective[key] = true;
        }
      }
    }
  }

  // Layer per-person capability overrides on top
  for (const capKey in capabilityOverrides) {
    const key = capKey as keyof CapabilitySet;
    if (key in effective && typeof capabilityOverrides[capKey] === "boolean") {
      effective[key] = capabilityOverrides[capKey];
    }
  }

  return effective;
}

// Areas of /admin that need more than "can see the board". Longest prefix wins, so
// /admin/personnel is matched before the general /admin rule below.
//
// Gating all of /admin on one check put approving access requests, blacklisting people, editing
// Discord permission bits and rewriting the status machine behind the same permission as the
// read-only board.
const ADMIN_SUBSECTION_CAPABILITY: Array<[string, keyof CapabilitySet]> = [
  ["/admin/personnel", "canManageSystemConfig"],
  ["/admin/settings", "canManageSystemConfig"],
  ["/admin/forms", "canManageSystemConfig"],
  ["/admin/curation-fields", "canManageSystemConfig"],
  ["/admin/marketing", "canAccessMarketingTools"],
];

/**
 * Whether someone with these roles and overrides may open this page.
 *
 * Input: the pathname being requested, the person's roles, and their per-person capability overrides. Output: true when the route should render for them.
 *
 * Role names are compared lowercase because the source personnel data stores them capitalised
 * ("Artist, Operator, Uploader" is one real cell value), and capabilities are the primary test
 * so that a per-person override actually changes what someone can reach.
 */
export function isRouteAllowedForRoles(
  pathname: string,
  roles: (SystemRole | string)[],
  capabilityOverrides: Record<string, boolean> = {}
): boolean {
  const caps = getEffectiveCapabilities(roles, capabilityOverrides);
  const normalized = roles.map((r) => String(r).toLowerCase());
  const has = (role: string) => normalized.includes(role);

  if (pathname.startsWith("/admin")) {
    const subsection = ADMIN_SUBSECTION_CAPABILITY.find(([prefix]) => pathname.startsWith(prefix));
    if (subsection) return caps[subsection[1]];
    return caps.canViewAllAssets || caps.canManageSystemConfig;
  }
  if (pathname.startsWith("/artist")) {
    return has("artist") || caps.canMoveToInProduction;
  }
  if (pathname.startsWith("/publisher")) {
    return caps.canPublishToRoblox || has("publisher") || has("uploader");
  }
  if (pathname.startsWith("/marketing")) {
    return caps.canAccessMarketingTools || has("marketing");
  }
  if (pathname.startsWith("/curator")) {
    return caps.canAccessCuratorTools || has("curator");
  }

  return true;
}

/**
 * Where to send someone after login, given what they can actually reach.
 *
 * Input: their roles and overrides. Output: the path to land on.
 * A pure marketing or payment_admin person previously fell through every branch of the
 * redirect chain and was left on "/" with no visible error.
 */
export function landingPathForRoles(
  roles: (SystemRole | string)[],
  capabilityOverrides: Record<string, boolean> = {}
): string {
  const candidates = ["/admin", "/artist", "/curator", "/publisher"];
  return candidates.find((p) => isRouteAllowedForRoles(p, roles, capabilityOverrides)) || "/unauthorized";
}

// Discord Team Manager's two-tier access, ported from Catalog Intel's own
// DISCORD_ROLE_RANK (manager: 1, admin: 2). That version needed a
// Discord-specific role field because it had no real RBAC of its own; this
// app already has one, so the tiers map onto existing roles instead of
// introducing a parallel permission dimension: "Manager" tier (view,
// onboard, archive/restore, temp access) = admin or operator, matching who
// already manages production day-to-day; "Admin" tier (permission-bit
// edits, permanent channel deletion, kicks) = admin only, the same
// higher-privilege boundary canManageSystemConfig already draws elsewhere.
export function isDiscordManagerTier(roles: (SystemRole | string)[]): boolean {
  return roles.includes("admin") || roles.includes("operator");
}

export function isDiscordAdminTier(roles: (SystemRole | string)[]): boolean {
  return roles.includes("admin");
}
