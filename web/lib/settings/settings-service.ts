import { db } from "@/lib/db/client";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { eq, asc } from "drizzle-orm";

export async function listStatuses() {
  return db.select().from(statuses).orderBy(asc(statuses.sortOrder));
}

export interface UpsertStatusInput {
  key: string;
  label: string;
  sortOrder: number;
  description?: string;
  whoCanMoveIn?: string[];
  nextActionHint?: string;
  automationNote?: string;
}

// Adds a new status, or updates the existing row for that key. Statuses
// are read live by lib/kanban/kanban-service.ts on every request, so a
// change here takes effect on the Kanban immediately, no redeploy needed.
export async function upsertStatus(input: UpsertStatusInput) {
  const existing = await db.select().from(statuses).where(eq(statuses.key, input.key)).limit(1);
  if (existing.length === 0) {
    const [row] = await db.insert(statuses).values(input).returning();
    return row;
  }
  const [row] = await db.update(statuses).set(input).where(eq(statuses.key, input.key)).returning();
  return row;
}

export async function listTransitionRules() {
  return db.select().from(statusTransitionRules).orderBy(asc(statusTransitionRules.fromStatus));
}

export interface UpsertTransitionRuleInput {
  fromStatus: string;
  toStatus: string;
  role?: string | null;
  isAutomatic?: boolean;
  triggerNote?: string;
}

// Same live-effect note as upsertStatus: lib/kanban/kanban-service.ts's
// updateAssetStatusInKanban() queries this table on every transition attempt.
export async function upsertTransitionRule(input: UpsertTransitionRuleInput) {
  const existing = await db
    .select()
    .from(statusTransitionRules)
    .where(eq(statusTransitionRules.fromStatus, input.fromStatus))
    .limit(1000);
  const match = existing.find((r) => r.toStatus === input.toStatus);

  if (!match) {
    const [row] = await db.insert(statusTransitionRules).values(input).returning();
    return row;
  }
  const [row] = await db
    .update(statusTransitionRules)
    .set(input)
    .where(eq(statusTransitionRules.id, match.id))
    .returning();
  return row;
}
