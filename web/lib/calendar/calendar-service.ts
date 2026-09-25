import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { brandGroups } from "@/lib/db/schema/brand_groups";
import { statusHistory } from "@/lib/db/schema/status_history";
import { and, eq, gte, lt, min, inArray } from "drizzle-orm";

// The three kinds of dates the calendar shows. "deadline": when the artist's work is due.
// "planned_upload": when the team plans to put it on Roblox. "went_live": when it actually went on
// Roblox, which is the first time it moved to Uploaded to Roblox.
export const CALENDAR_EVENT_TYPES = ["deadline", "planned_upload", "went_live"] as const;
export type CalendarEventType = (typeof CALENDAR_EVENT_TYPES)[number];

// Statuses after the artist's part is done: a deadline for an asset here has been met, so the
// calendar shows it as done rather than as something still due.
const PAST_ARTIST_WORK_STATUSES = [
  "final_files_received",
  "ready_for_upload",
  "uploaded_to_roblox",
  "marked_for_payment",
  "payment_done",
];

// Statuses where the asset is on Roblox.
const LIVE_STATUSES = ["uploaded_to_roblox", "marked_for_payment", "payment_done"];

const UPLOADED_STATUS = "uploaded_to_roblox";

export interface CalendarEvent {
  type: CalendarEventType;
  /** The instant; the calendar places it on its day in India time. */
  date: Date;
  sku: string;
  itemName: string;
  status: string;
  artistName: string | null;
  brandGroupName: string | null;
  /** True once the thing the date is about has happened: the artist delivered, or it went live. */
  done: boolean;
}

/**
 * Every deadline, planned upload and go-live date between `from` (inclusive) and `to` (exclusive).
 *
 * Input: the range to show. Output: the events in it, in date order. A go-live date is read from
 * status history, so it exists for any asset that reached Uploaded to Roblox, including those
 * uploaded before the calendar existed.
 */
export async function getCalendarEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
  const assetFields = {
    id: assets.id,
    sku: assets.sku,
    itemName: assets.itemName,
    status: assets.currentStatus,
    deadline: assets.deadline,
    plannedUploadDate: assets.plannedUploadDate,
    artistName: personnel.name,
    brandGroupName: brandGroups.name,
  };

  const [withDeadline, withPlannedUpload, firstUploads] = await Promise.all([
    db
      .select(assetFields)
      .from(assets)
      .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
      .leftJoin(brandGroups, eq(assets.brandGroupId, brandGroups.id))
      .where(and(gte(assets.deadline, from), lt(assets.deadline, to))),
    db
      .select(assetFields)
      .from(assets)
      .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
      .leftJoin(brandGroups, eq(assets.brandGroupId, brandGroups.id))
      .where(and(gte(assets.plannedUploadDate, from), lt(assets.plannedUploadDate, to))),
    db
      .select({ assetId: statusHistory.assetId, firstAt: min(statusHistory.createdAt) })
      .from(statusHistory)
      .where(eq(statusHistory.toStatus, UPLOADED_STATUS))
      .groupBy(statusHistory.assetId),
  ]);

  const liveInRange = firstUploads.filter((u) => u.firstAt && u.firstAt >= from && u.firstAt < to);
  const liveAssets = liveInRange.length
    ? await db
        .select(assetFields)
        .from(assets)
        .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
        .leftJoin(brandGroups, eq(assets.brandGroupId, brandGroups.id))
        .where(inArray(assets.id, liveInRange.map((u) => u.assetId)))
    : [];
  const liveAssetById = new Map(liveAssets.map((a) => [a.id, a]));

  const events: CalendarEvent[] = [
    ...withDeadline.map((a) => ({
      type: "deadline" as const,
      date: a.deadline as Date,
      sku: a.sku,
      itemName: a.itemName,
      status: a.status,
      artistName: a.artistName,
      brandGroupName: a.brandGroupName,
      done: PAST_ARTIST_WORK_STATUSES.includes(a.status),
    })),
    ...withPlannedUpload.map((a) => ({
      type: "planned_upload" as const,
      date: a.plannedUploadDate as Date,
      sku: a.sku,
      itemName: a.itemName,
      status: a.status,
      artistName: a.artistName,
      brandGroupName: a.brandGroupName,
      done: LIVE_STATUSES.includes(a.status),
    })),
    ...liveInRange.flatMap((u) => {
      const a = liveAssetById.get(u.assetId);
      if (!a || !u.firstAt) return [];
      return [
        {
          type: "went_live" as const,
          date: u.firstAt,
          sku: a.sku,
          itemName: a.itemName,
          status: a.status,
          artistName: a.artistName,
          brandGroupName: a.brandGroupName,
          done: true,
        },
      ];
    }),
  ];

  return events.sort((x, y) => x.date.getTime() - y.date.getTime());
}
