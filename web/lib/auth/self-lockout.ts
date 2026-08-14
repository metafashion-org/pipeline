/**
 * Checks whether a personnel status change would lock the acting admin out of their own account.
 * Input: the acting admin's personnel id, the personnel id being updated, and the new status being set.
 * Output: true if the change targets the acting admin's own row and sets it to a revoking status (Inactive or Blacklisted), false otherwise.
 */
export function isSelfLockoutAttempt(
  actingPersonnelId: string | undefined,
  targetPersonnelId: string,
  newStatus: "Active" | "Blacklisted" | "Inactive"
): boolean {
  const isSelf = actingPersonnelId === targetPersonnelId;
  const isRevoking = newStatus === "Inactive" || newStatus === "Blacklisted";
  return isSelf && isRevoking;
}
