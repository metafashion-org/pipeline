import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";
import { isSelfAdminRemovalAttempt } from "@/lib/auth/self-lockout";
import { invalidatePersonnelAuthCache } from "@/lib/auth/personnel-auth";
import { eq } from "drizzle-orm";
import { z } from "zod";

const ROLE_OPTIONS = ["admin", "operator", "curator", "artist", "publisher", "uploader", "marketing", "payment_admin"] as const;

const UpdateRolesSchema = z.object({
  roles: z.array(z.enum(ROLE_OPTIONS)).min(1),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ personnelId: string }> }
) {
  const [user, { personnelId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = UpdateRolesSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  if (isSelfAdminRemovalAttempt(user.personnelId, personnelId, parseResult.data.roles)) {
    return NextResponse.json({ error: "You can't remove admin from your own roles" }, { status: 400 });
  }

  const existing = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Personnel not found" }, { status: 404 });
  }

  const [updated] = await db
    .update(personnel)
    .set({ roles: parseResult.data.roles, updatedAt: new Date() })
    .where(eq(personnel.id, personnelId))
    .returning();

  // Roles feed the capability checks, which are cached briefly per server process, so drop the entry to apply the change on the next request.
  invalidatePersonnelAuthCache(existing[0].email);

  await db.insert(auditLog).values({
    action: "updatePersonnelRoles",
    entityType: "personnel",
    entityId: personnelId,
    actorId: user.personnelId || null,
    payload: { oldRoles: existing[0].roles, newRoles: parseResult.data.roles },
  });

  return NextResponse.json({ success: true, personnel: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ personnelId: string }> }
) {
  const [user, { personnelId }] = await Promise.all([getAuthedUser(), params]);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canManageSystemConfig) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (user.personnelId === personnelId) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }

  const existing = await db.select().from(personnel).where(eq(personnel.id, personnelId)).limit(1);
  if (existing.length === 0) {
    return NextResponse.json({ error: "Personnel not found" }, { status: 404 });
  }

  try {
    await db.delete(personnel).where(eq(personnel.id, personnelId));
  } catch (error: unknown) {
    // postgres-js surfaces the real Postgres error as `.cause` on the drizzle-wrapped error;
    // code 23503 is foreign_key_violation, which here means this person has pipeline history
    // (assets, assignments, uploads, marketing updates, or audit log rows) referencing them.
    // The system is append-only by design, so we refuse the delete instead of cascading or nulling.
    const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined;
    if (cause?.code === "23503") {
      return NextResponse.json(
        { error: `${existing[0].name} has pipeline history and can't be deleted - set them to Inactive instead.` },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Failed to delete personnel";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Logged after the delete succeeds, not before - entityId has no FK, so a row
  // pointing at the now-deleted id is fine, but logging before the attempt would
  // leave a false "deleted" record on the common 23503-refused path above.
  await db.insert(auditLog).values({
    action: "deletePersonnel",
    entityType: "personnel",
    entityId: personnelId,
    actorId: user.personnelId || null,
    payload: { name: existing[0].name, email: existing[0].email, roles: existing[0].roles },
  });

  invalidatePersonnelAuthCache(existing[0].email);

  return NextResponse.json({ success: true });
}
