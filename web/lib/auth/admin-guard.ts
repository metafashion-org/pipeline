import type { CapabilitySet } from "./rbac";

const ADMIN_ROLE = "admin";

function includesAdmin(roles: readonly string[] | null | undefined): boolean {
  return (roles ?? []).some((role) => role.toLowerCase() === ADMIN_ROLE);
}

/**
 * Whether this personnel change touches admin access in a way only an admin may make.
 *
 * Input: the actor's capabilities, the target's current roles (empty for someone new), and the
 * roles being set, if roles are being changed. Output: true when the actor isn't an admin
 * (no canManageSystemConfig) and the target is an admin, or would become one.
 *
 * canManagePersonnel lets someone who isn't an admin run onboarding. Without this check they could
 * make themselves or anyone else an admin, or deactivate, delete or demote an admin, which would
 * turn a personnel permission into a way to take over the app.
 */
export function isAdminAccessChangeByNonAdmin(
  actorCaps: CapabilitySet,
  targetCurrentRoles: readonly string[] | null | undefined,
  newRoles?: readonly string[]
): boolean {
  if (actorCaps.canManageSystemConfig) return false;
  return includesAdmin(targetCurrentRoles) || includesAdmin(newRoles);
}

export const ADMIN_ONLY_MESSAGE = "Only an admin can grant, change or remove admin access";
