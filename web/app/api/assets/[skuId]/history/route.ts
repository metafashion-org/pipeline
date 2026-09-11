import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { statusHistory } from "@/lib/db/schema/status_history";
import { auditLog } from "@/lib/db/schema/audit_log";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { eq, or, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export interface AssetHistoryEntry {
  id: string;
  kind: "status" | "audit";
  at: string;
  actorName: string | null;
  // Status moves.
  fromStatus?: string | null;
  toStatus?: string;
  note?: string | null;
  // Audit events.
  action?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
  payload?: Record<string, unknown>;
}

/**
 * Returns the full trail for one asset: every status move plus every audited change, newest first.
 *
 * Two sources are merged because they record different things. status_history is the record of movement through the pipeline, while audit_log is the record of edits (budget changes, artist assignment, payment details).
 * An edit that never shows up anywhere is the thing this endpoint exists to prevent.
 *
 * Input: the SKU in the route path. Output: { history: AssetHistoryEntry[] }.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ skuId: string }> }
) {
  const [{ skuId }, session] = await Promise.all([params, getServerSession(authOptions)]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assetRecord = await db
    .select({ id: assets.id, sku: assets.sku, currentArtistId: assets.currentArtistId })
    .from(assets)
    .where(eq(assets.sku, skuId))
    .limit(1);

  if (assetRecord.length === 0) {
    return NextResponse.json({ error: `Asset with SKU '${skuId}' not found` }, { status: 404 });
  }

  const asset = assetRecord[0];

  // The trail carries fee changes, payment receipts and who was reassigned off the work, so it is
  // not something every signed-in person should be able to read for every SKU. Whoever can see
  // the whole board can see any asset's trail; anyone else can see only the asset they are
  // currently assigned to.
  const caps = getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {});
  const isAssignedArtist =
    Boolean(session.user.personnelId) && session.user.personnelId === asset.currentArtistId;
  if (!caps.canViewAllAssets && !isAssignedArtist) {
    return NextResponse.json({ error: "You don't have access to this asset's history" }, { status: 403 });
  }

  const [statusRows, auditRows] = await Promise.all([
    db
      .select({
        id: statusHistory.id,
        fromStatus: statusHistory.fromStatus,
        toStatus: statusHistory.toStatus,
        note: statusHistory.note,
        createdAt: statusHistory.createdAt,
        actorName: personnel.name,
      })
      .from(statusHistory)
      .leftJoin(personnel, eq(statusHistory.actorId, personnel.id))
      .where(eq(statusHistory.assetId, asset.id))
      .orderBy(desc(statusHistory.createdAt)),

    // audit_log.entity_id is a text column holding whichever identifier the writer had to hand: rows written by the app store the asset's uuid, while rows imported from the workbook's Audit Log sheet store the SKU.
    // Matching only one of them silently hides half the trail, so both are queried.
    db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        payload: auditLog.payload,
        createdAt: auditLog.createdAt,
        actorName: personnel.name,
      })
      .from(auditLog)
      .leftJoin(personnel, eq(auditLog.actorId, personnel.id))
      .where(or(eq(auditLog.entityId, asset.id), eq(auditLog.entityId, asset.sku)))
      .orderBy(desc(auditLog.createdAt)),
  ]);

  const history: AssetHistoryEntry[] = [
    ...statusRows.map((r) => ({
      id: r.id,
      kind: "status" as const,
      at: r.createdAt.toISOString(),
      actorName: r.actorName,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      note: r.note,
    })),
    ...auditRows.map((r) => {
      const payload = (r.payload as Record<string, unknown>) || {};
      // Edit endpoints record a per-field { from, to } map under `changes`; other actions carry their own payload shape and are rendered generically.
      const changes = payload.changes as Record<string, { from: unknown; to: unknown }> | undefined;
      return {
        id: r.id,
        kind: "audit" as const,
        at: r.createdAt.toISOString(),
        actorName: r.actorName,
        action: r.action,
        changes,
        payload,
      };
    }),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return NextResponse.json({ history });
}
