import { db } from "@/lib/db/client";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { marketingStatusConfig } from "@/lib/db/schema/marketing_status_config";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, desc } from "drizzle-orm";

export const INITIAL_MARKETING_STATUSES = [
  { statusKey: "uploaded_not_marketed", label: "Uploaded Not Marketed", sortOrder: 1 },
  { statusKey: "creative_in_progress", label: "Creative in Progress", sortOrder: 2 },
  { statusKey: "scheduled", label: "Scheduled", sortOrder: 3 },
  { statusKey: "posted", label: "Posted", sortOrder: 4 },
  { statusKey: "high_performing", label: "High Performing", sortOrder: 5 },
  { statusKey: "needs_repost", label: "Needs Repost", sortOrder: 6 },
  { statusKey: "archived_campaign", label: "Archived Campaign", sortOrder: 7 },
  { statusKey: "paused", label: "Paused", sortOrder: 8 },
  { statusKey: "rejected", label: "Rejected", sortOrder: 9 },
];

export async function seedMarketingStatuses() {
  for (const item of INITIAL_MARKETING_STATUSES) {
    await db
      .insert(marketingStatusConfig)
      .values(item)
      .onConflictDoNothing({ target: marketingStatusConfig.statusKey });
  }
}

export interface AddMarketingUpdateOptions {
  sku: string;
  platform: string;
  marketingStatus: string;
  postUrl?: string;
  creative?: string;
  caption?: string;
  postedAt?: Date;
  metrics?: Record<string, unknown>;
  notes?: string;
  nextAction?: string;
  responsiblePersonId?: string;
}

export async function addMarketingUpdate(options: AddMarketingUpdateOptions) {
  const { sku, platform, marketingStatus, postUrl, creative, caption, postedAt, metrics = {}, notes, nextAction, responsiblePersonId } = options;

  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) throw new Error(`Asset with SKU '${sku}' not found`);

  const asset = assetRecord[0];
  const allowedStatuses = ["uploaded_to_roblox", "marked_for_payment", "payment_done"];

  // 🔒 RESTRICTION: Marketing updates only allowed for assets at uploaded_to_roblox or later
  if (!allowedStatuses.includes(asset.currentStatus)) {
    throw new Error(
      `Marketing updates can only be logged for assets that have reached 'Uploaded to Roblox' status or later (current status: '${asset.currentStatus}')`
    );
  }

  const now = new Date();

  // 1. Insert append-only marketing update row
  const [update] = await db
    .insert(marketingUpdates)
    .values({
      assetId: asset.id,
      platform,
      postUrl: postUrl || null,
      creative: creative || null,
      caption: caption || null,
      postedAt: postedAt || null,
      marketingStatus,
      metrics,
      notes: notes || null,
      nextAction: nextAction || null,
      responsiblePersonId: responsiblePersonId || null,
      createdAt: now,
    })
    .returning();

  // 2. Keep summary fields in sync on asset record
  await db
    .update(assets)
    .set({
      marketingStatus,
      lastMarketingUpdate: now,
      updatedAt: now,
    })
    .where(eq(assets.id, asset.id));

  // 3. Write audit log entry
  await db.insert(auditLog).values({
    action: "addMarketingUpdate",
    entityType: "marketing_update",
    entityId: update.id,
    actorId: responsiblePersonId || null,
    payload: { sku, platform, marketingStatus, postUrl },
  });

  return update;
}

export async function getMarketingUpdatesForAsset(sku: string) {
  const assetRecord = await db.select().from(assets).where(eq(assets.sku, sku)).limit(1);
  if (assetRecord.length === 0) return [];

  return await db
    .select()
    .from(marketingUpdates)
    .where(eq(marketingUpdates.assetId, assetRecord[0].id))
    .orderBy(desc(marketingUpdates.createdAt));
}
