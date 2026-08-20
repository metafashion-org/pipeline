import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { marketingUpdates } from "@/lib/db/schema/marketing_updates";
import { marketingStatusConfig } from "@/lib/db/schema/marketing_status_config";
import { personnel } from "@/lib/db/schema/personnel";
import { eq, desc, isNull, or } from "drizzle-orm";

export interface MarketingFilterOptions {
  statusKey?: string;
  category?: string;
  marketerId?: string;
  campaignKeyword?: string;
  postedThisWeekOnly?: boolean;
}

export async function getMarketingKanbanData(filters: MarketingFilterOptions = {}) {
  // The status config and the update list are independent, so they are fetched together rather than one after the other.
  const [statusConfigs, rawUpdates] = await Promise.all([
    db.select().from(marketingStatusConfig).orderBy(marketingStatusConfig.sortOrder),
    db
    .select({
      updateId: marketingUpdates.id,
      assetId: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      platform: marketingUpdates.platform,
      postUrl: marketingUpdates.postUrl,
      caption: marketingUpdates.caption,
      marketingStatus: marketingUpdates.marketingStatus,
      postedAt: marketingUpdates.postedAt,
      campaign: marketingUpdates.campaign,
      metrics: marketingUpdates.metrics,
      notes: marketingUpdates.notes,
      responsiblePersonId: marketingUpdates.responsiblePersonId,
      responsiblePersonName: personnel.name,
      createdAt: marketingUpdates.createdAt,
    })
    .from(marketingUpdates)
    .innerJoin(assets, eq(marketingUpdates.assetId, assets.id))
    .leftJoin(personnel, eq(marketingUpdates.responsiblePersonId, personnel.id))
    .orderBy(desc(marketingUpdates.createdAt)),
  ]);

  let filtered = rawUpdates;

  if (filters.statusKey) {
    filtered = filtered.filter((u) => u.marketingStatus === filters.statusKey);
  }

  if (filters.category) {
    filtered = filtered.filter((u) => u.category && u.category.toLowerCase() === filters.category!.toLowerCase());
  }

  if (filters.marketerId) {
    filtered = filtered.filter((u) => u.responsiblePersonId === filters.marketerId);
  }

  if (filters.campaignKeyword) {
    const kw = filters.campaignKeyword.toLowerCase();
    filtered = filtered.filter(
      (u) =>
        (u.campaign && u.campaign.toLowerCase().includes(kw)) ||
        (u.notes && u.notes.toLowerCase().includes(kw)) ||
        (u.caption && u.caption.toLowerCase().includes(kw))
    );
  }

  if (filters.postedThisWeekOnly) {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    filtered = filtered.filter((u) => u.marketingStatus === "posted" && new Date(u.createdAt) >= sevenDaysAgo);
  }

  // Assets uploaded to Roblox or later, but not yet assigned a active marketing campaign
  const unmarketedAssets = await db
    .select({
      id: assets.id,
      sku: assets.sku,
      itemName: assets.itemName,
      category: assets.category,
      currentStatus: assets.currentStatus,
      marketingStatus: assets.marketingStatus,
    })
    .from(assets)
    .where(
      or(
        isNull(assets.marketingStatus),
        eq(assets.marketingStatus, "uploaded_not_marketed")
      )
    );

  const allowedStatuses = ["uploaded_to_roblox", "marked_for_payment", "payment_done"];
  const eligibleUnmarketed = unmarketedAssets.filter((a) => allowedStatuses.includes(a.currentStatus));

  return {
    statusColumns: statusConfigs,
    updates: filtered,
    uploadedNotMarketedAssets: eligibleUnmarketed,
  };
}
