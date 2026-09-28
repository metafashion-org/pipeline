import { db } from "@/lib/db/client";
import { appSettings } from "@/lib/db/schema/app_settings";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitionRules } from "@/lib/db/schema/status_transition_rules";
import { curationFieldConfig } from "@/lib/db/schema/curation_field_config";
import { and, eq, sql } from "drizzle-orm";
import { updateAssetStatusInKanban } from "@/lib/kanban/kanban-service";
import { CURATED_STATUS } from "@/lib/kanban/move-rules";
import { PINTEREST_FIELD_KEY } from "@/lib/curation/curation-service";

/**
 * Curation review is a trial. While it's on, a curator's submitted idea lands in the board's
 * Curated column and the team approves it into Unassigned or sends it back with a note. While it's
 * off, a submitted idea goes straight to Unassigned, as it always has.
 *   off:      nobody sees any of it
 *   admins:   only admins get the review form and the Curated column, to try it out
 *   everyone: every curator's submission goes to Curated
 */
export const CURATION_REVIEW_MODES = ["off", "admins", "everyone"] as const;
export type CurationReviewMode = (typeof CURATION_REVIEW_MODES)[number];

const CURATION_REVIEW_KEY = "curation_review_mode";
// Off until an admin turns it on, so deploying this changes nothing by itself.
const DEFAULT_CURATION_REVIEW_MODE: CurationReviewMode = "off";

function isMode(value: unknown): value is CurationReviewMode {
  return typeof value === "string" && (CURATION_REVIEW_MODES as readonly string[]).includes(value);
}

/** The current curation review mode, or "off" when it has never been set or can't be read. */
export async function getCurationReviewMode(): Promise<CurationReviewMode> {
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, CURATION_REVIEW_KEY)).limit(1);
    return isMode(row?.value) ? row.value : DEFAULT_CURATION_REVIEW_MODE;
  } catch (error) {
    // Every board load reads this. If app_settings is missing (migration 0035 not applied yet),
    // the board shows as it did before the trial existed instead of failing to load.
    console.error("[settings] couldn't read the curation review mode, treating it as off:", error);
    return DEFAULT_CURATION_REVIEW_MODE;
  }
}

/**
 * Whether curation review is on for this person: their submissions go to Curated and they see the
 * Curated column.
 *
 * Input: the mode and the person's roles. Output: true when the mode covers them.
 */
export function curationReviewAppliesTo(mode: CurationReviewMode, roles: string[]): boolean {
  if (mode === "everyone") return true;
  if (mode === "admins") return roles.some((r) => r.toLowerCase() === "admin");
  return false;
}

/**
 * Creates what curation review needs the first time it is switched on: the Curated status (sort
 * order 0, before Unassigned), its one rule (Curated -> Unassigned, made by the team), and the
 * "Pinterest board" curation field, which goes in the artist's brief. Created here rather than in
 * a migration so no Curated column exists until an admin asks for one. Safe to call repeatedly.
 */
export async function ensureCurationReviewConfig(): Promise<void> {
  await db
    .insert(statuses)
    .values({
      key: CURATED_STATUS,
      label: "Curated",
      sortOrder: 0,
      description: "Curated ideas waiting for the team's review.",
      whoCanMoveIn: ["admin", "operator"],
      nextActionHint:
        "The team opens the card and approves it for production, which moves it to Unassigned, or sends it back to the curator with a note.",
      automationNote:
        "Curator submissions land here while curation review is switched on in Settings. Switching it off moves every card here to Unassigned.",
    })
    .onConflictDoNothing({ target: statuses.key });

  const [existingRule] = await db
    .select({ id: statusTransitionRules.id })
    .from(statusTransitionRules)
    .where(and(eq(statusTransitionRules.fromStatus, CURATED_STATUS), eq(statusTransitionRules.toStatus, "unassigned")))
    .limit(1);
  if (!existingRule) {
    await db.insert(statusTransitionRules).values({
      fromStatus: CURATED_STATUS,
      toStatus: "unassigned",
      role: "operator",
      isAutomatic: false,
      triggerNote: "The team approves the idea for production.",
    });
  }

  const [existingField] = await db
    .select({ id: curationFieldConfig.id })
    .from(curationFieldConfig)
    .where(eq(curationFieldConfig.fieldKey, PINTEREST_FIELD_KEY))
    .limit(1);
  if (!existingField) {
    const [{ maxSort }] = await db.select({ maxSort: sql<number>`coalesce(max(${curationFieldConfig.sortOrder}), 0)` }).from(curationFieldConfig);
    await db.insert(curationFieldConfig).values({
      fieldKey: PINTEREST_FIELD_KEY,
      displayName: "Pinterest board",
      fieldType: "url",
      includeInArtistEmail: true,
      sortOrder: Number(maxSort) + 1,
    });
  }
}

/**
 * Sets the curation review mode. Switching it off moves every card waiting in Curated to
 * Unassigned, so no idea is left in a column nobody can see.
 *
 * Input: the new mode and who set it. Output: the mode, and the SKUs moved to Unassigned.
 */
export async function setCurationReviewMode(
  mode: CurationReviewMode,
  actorId?: string
): Promise<{ mode: CurationReviewMode; movedToUnassigned: string[] }> {
  const previous = await getCurationReviewMode();
  if (mode !== "off") await ensureCurationReviewConfig();
  await db
    .insert(appSettings)
    .values({ key: CURATION_REVIEW_KEY, value: mode, updatedBy: actorId ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: mode, updatedBy: actorId ?? null, updatedAt: new Date() } });

  const movedToUnassigned: string[] = [];
  if (mode === "off") {
    const waiting = await db.select({ sku: assets.sku }).from(assets).where(eq(assets.currentStatus, CURATED_STATUS));
    for (const { sku } of waiting) {
      await updateAssetStatusInKanban(sku, "unassigned", { system: true }, "Curation review was switched off, so this idea skipped review");
      movedToUnassigned.push(sku);
    }
  }

  await db.insert(auditLog).values({
    action: "setCurationReviewMode",
    entityType: "app_setting",
    entityId: CURATION_REVIEW_KEY,
    actorId: actorId ?? null,
    payload: { from: previous, to: mode, movedToUnassigned },
  });

  return { mode, movedToUnassigned };
}
