import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { FULL_TIME_ROLE } from "@/lib/auth/rbac";

/** A person on the full-time team, as Team Tasks shows and notifies them. */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  discordUserId: string | null;
}

/**
 * Everyone on the full-time team: Active personnel with the full_time role. They are the board's
 * columns and the people a task can be given to or mention. Admin logins without the role are not.
 *
 * Input: nothing. Output: the members, by name.
 */
export async function listTeamMembers(): Promise<TeamMember[]> {
  return db
    .select({ id: personnel.id, name: personnel.name, email: personnel.email, discordUserId: personnel.discordUserId })
    .from(personnel)
    // Roles are stored in mixed case in places ("Artist, Operator, Uploader"), so compared lowercase.
    .where(and(eq(personnel.status, "Active"), sql`${FULL_TIME_ROLE} = any (select lower(r) from unnest(${personnel.roles}) as r)`))
    .orderBy(asc(personnel.name));
}

/** One team member by id, or null when they aren't Active and full-time. */
export async function findTeamMember(id: string): Promise<TeamMember | null> {
  const members = await listTeamMembers();
  return members.find((m) => m.id === id) ?? null;
}

/** A person's name by id, for "X gave you a task" lines. Null for an unknown id. */
export async function personName(id: string): Promise<string | null> {
  const [row] = await db.select({ name: personnel.name }).from(personnel).where(eq(personnel.id, id)).limit(1);
  return row?.name ?? null;
}

/**
 * A team member named by id, email, or name (case ignored; a first name works when only one
 * member has it). Used by outside tools that know people by name, not id.
 *
 * Input: the id, email or name. Output: the member, or null when none or more than one match.
 */
export async function resolveTeamMember(ref: string): Promise<TeamMember | null> {
  const needle = ref.trim().toLowerCase();
  if (!needle) return null;
  const members = await listTeamMembers();
  const exact = members.find((m) => m.id === ref.trim() || m.email.toLowerCase() === needle || m.name.toLowerCase() === needle);
  if (exact) return exact;
  const byFirstName = members.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === needle);
  return byFirstName.length === 1 ? byFirstName[0] : null;
}
