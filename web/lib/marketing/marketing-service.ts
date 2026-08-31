import { db } from "@/lib/db/client";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { marketingStatusConfig } from "@/lib/db/schema/marketing_status_config";
import { assets } from "@/lib/db/schema/assets";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, desc } from "drizzle-orm";

// The brief's §10 own suggested status list, verbatim — what was seeded
// before this (Uploaded Not Marketed / Creative in Progress / High
// Performing / Archived Campaign / Paused / Rejected) didn't match it and
// was never actually run against production (marketing_status_config had
// zero rows live, confirmed directly — the Marketing Kanban's "by status"
// view had zero columns to render into). "High Performing" is deliberately
// NOT a status here — see marketing_updates.ts's highPerforming column.
export const INITIAL_MARKETING_STATUSES = [
  { statusKey: "not_planned", label: "Not Planned", sortOrder: 1 },
  { statusKey: "planned", label: "Planned", sortOrder: 2 },
  { statusKey: "creative_needed", label: "Creative Needed", sortOrder: 3 },
  { statusKey: "scheduled", label: "Scheduled", sortOrder: 4 },
  { statusKey: "posted", label: "Posted", sortOrder: 5 },
  { statusKey: "boosted_promoted", label: "Boosted / Promoted", sortOrder: 6 },
  { statusKey: "performance_reviewed", label: "Performance Reviewed", sortOrder: 7 },
  { statusKey: "needs_repost", label: "Needs Repost", sortOrder: 8 },
  { statusKey: "done", label: "Done", sortOrder: 9 },
];

export async function seedMarketingStatuses() {
  // Independent rows, each insert a no-op when it already exists, so ordering carries no meaning.
  await Promise.all(
    INITIAL_MARKETING_STATUSES.map((item) =>
      db.insert(marketingStatusConfig).values(item).onConflictDoNothing({ target: marketingStatusConfig.statusKey })
    )
  );
}

export interface AddMarketingUpdateOptions {
  sku: string;
  platform: string;
  marketingStatus: string;
  campaign?: string;
  postType?: string;
  postUrl?: string;
  creative?: string;
  caption?: string;
  postedAt?: Date;
  metrics?: Record<string, unknown>;
  highPerforming?: boolean;
  notes?: string;
  nextAction?: string;
  responsiblePersonId?: string;
}

export async function addMarketingUpdate(options: AddMarketingUpdateOptions) {
  const {
    sku,
    platform,
    marketingStatus,
    campaign,
    postType,
    postUrl,
    creative,
    caption,
    postedAt,
    metrics = {},
    highPerforming = false,
    notes,
    nextAction,
    responsiblePersonId,
  } = options;

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
      campaign: campaign || null,
      platform,
      postType: postType || null,
      postUrl: postUrl || null,
      creative: creative || null,
      caption: caption || null,
      postedAt: postedAt || null,
      marketingStatus,
      metrics,
      highPerforming,
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

// Allow direct execution via CLI
if (require.main === module) {
  seedMarketingStatuses()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Marketing status seeding failed:", err);
      process.exit(1);
    });
}
