import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { db } from "./client";
import { personnel } from "./schema/personnel";
import { assets } from "./schema/assets";
import { assignments } from "./schema/assignments";
import { statusHistory } from "./schema/status_history";
import { auditLog } from "./schema/audit_log";
import { eq, and, isNull } from "drizzle-orm";

export interface ImportOptions {
  mode: "sample" | "full";
  excelFilePath?: string;
}

// Sheet values like "NA" aren't valid numeric input for the fee_amount column — treat anything non-numeric as absent.
function parseFeeAmount(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const num = Number(String(raw).replace(/[,₹$]/g, "").trim());
  return Number.isFinite(num) ? String(num) : null;
}

export interface ImportSummary {
  mode: "sample" | "full";
  personnelImported: number;
  assetsImported: number;
  assetsSkippedExisting: number;
  assignmentsImported: number;
  statusHistoryImported: number;
  auditLogsImported: number;
  auditLogsSkippedDuplicate: number;
  warnings: string[];
}

const DEFAULT_EXCEL_PATH = path.resolve(process.cwd(), "../Meta Fashion Digital Assets Pipeline.xlsx");

export async function importSheetData(options: ImportOptions): Promise<ImportSummary> {
  const mode = options.mode || "sample";
  const filePath = options.excelFilePath || DEFAULT_EXCEL_PATH;

  const summary: ImportSummary = {
    mode,
    personnelImported: 0,
    assetsImported: 0,
    assetsSkippedExisting: 0,
    assignmentsImported: 0,
    statusHistoryImported: 0,
    auditLogsImported: 0,
    auditLogsSkippedDuplicate: 0,
    warnings: [],
  };

  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel workbook file not found at: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });

  // Helper to slice rows based on mode
  const limitRows = <T>(rows: T[]): T[] => {
    return mode === "sample" ? rows.slice(0, 5) : rows;
  };

  // Map personnel email -> personnel id for fast foreign key resolution
  const personnelEmailMap = new Map<string, string>();
  // Fallback lookup: the Assets sheet's "Artist" column holds a display name, not an
  // email, so resolve by name when no separate "Artist Email" column value is present.
  const personnelNameMap = new Map<string, string>();

  // ── 1. IMPORT PERSONNEL ──────────────────────────────────────────
  if (workbook.SheetNames.includes("Personnel")) {
    const sheet = workbook.Sheets["Personnel"];
    const rawPersonnel: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);
    const rowsToProcess = limitRows(rawPersonnel);

    for (const row of rowsToProcess) {
      const email = String(row["Email"] || row["Email Address"] || "").trim().toLowerCase();
      const name = String(row["Name"] || row["Full Name"] || "").trim();

      if (!email || !name) {
        summary.warnings.push(`Skipped invalid personnel row missing name/email: ${JSON.stringify(row)}`);
        continue;
      }

      // Parse roles array from comma-separated string (e.g. "Artist, Operator, Roblox Publisher")
      const rolesStr = String(row["Roles"] || row["Role"] || "");
      const roles = rolesStr
        ? rolesStr.split(",").map((r) => r.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean)
        : ["artist"];

      // Status mapping (Active | Blacklisted | Inactive)
      let statusStr: "Active" | "Blacklisted" | "Inactive" = "Active";
      const rawStatus = String(row["Status"] || "").trim().toLowerCase();
      if (rawStatus === "blacklisted") statusStr = "Blacklisted";
      else if (rawStatus === "inactive") statusStr = "Inactive";

      // Parse capability overrides
      const capabilityOverrides: Record<string, boolean> = {};
      const capFields = [
        "Can Assign Artists",
        "Can Move to In Production",
        "Can Move to In Review",
        "Can Request Revisions",
        "Can Approve",
        "Can Assign Publisher",
        "Can Publish to Roblox",
        "Can Mark for Payment",
        "Can Mark Payment Done",
        "Can View All Assets",
      ];
      for (const capKey of capFields) {
        if (row[capKey] !== undefined) {
          const keyCamel = capKey.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
          capabilityOverrides[keyCamel] = String(row[capKey]).toLowerCase() === "true" || row[capKey] === true || row[capKey] === 1;
        }
      }

      const personnelData = {
        name,
        email,
        phone: row["Phone"] ? String(row["Phone"]) : null,
        roles,
        status: statusStr,
        skills: row["Skills"] ? String(row["Skills"]).split(",").map((s) => s.trim()) : [],
        agreementSigned: String(row["Agreement Signed"] || "").toLowerCase() === "yes" || row["Agreement Signed"] === true,
        agreementDocLink: row["Agreement PDF"] ? String(row["Agreement PDF"]) : null,
        dateOnboarded: row["Date Onboarded"] instanceof Date ? row["Date Onboarded"] : null,
        notes: row["Notes"] ? String(row["Notes"]) : null,
        defaultCc: row["Default CC"] ? String(row["Default CC"]) : null,
        profilePhotoUrl: row["Profile Photo URL"] ? String(row["Profile Photo URL"]) : null,
        capabilityOverrides,
      };

      const existing = await db.select().from(personnel).where(eq(personnel.email, email)).limit(1);
      let insertedId = "";

      if (existing.length > 0) {
        insertedId = existing[0].id;
        await db.update(personnel).set(personnelData).where(eq(personnel.id, insertedId));
      } else {
        const [newRecord] = await db.insert(personnel).values(personnelData).returning({ id: personnel.id });
        insertedId = newRecord.id;
      }

      personnelEmailMap.set(email, insertedId);
      personnelNameMap.set(name.toLowerCase(), insertedId);
      summary.personnelImported++;
    }
  }

  // ── 2. IMPORT ASSETS & TIMELINE HISTORY ──────────────────────────
  if (workbook.SheetNames.includes("Assets")) {
    const sheet = workbook.Sheets["Assets"];
    const rawAssets: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);
    const rowsToProcess = limitRows(rawAssets);

    for (const row of rowsToProcess) {
      const sku = String(row["SKU ID"] || row["SKU"] || "").trim();
      const itemName = String(row["Item Name (Curation Title)"] || row["Item Name"] || "").trim();

      if (!sku || !itemName) {
        summary.warnings.push("Skipped invalid asset row missing SKU/ItemName");
        continue;
      }

      // "Artist Email" is the real email column; "Artist" is a display name and only
      // used as a fallback lookup against personnel names, never treated as an email.
      const artistEmail = String(row["Artist Email"] || "").trim().toLowerCase();
      const artistNameRaw = String(row["Artist"] || "").trim();
      const artistId =
        (artistEmail && personnelEmailMap.get(artistEmail)) ||
        (artistNameRaw && personnelNameMap.get(artistNameRaw.toLowerCase())) ||
        null;

      // Normalize status key
      const rawStatus = String(row["Production Status"] || "unassigned").trim().toLowerCase().replace(/\s+/g, "_");

      // SKUs already in the DB are live, actively-worked assets (Kanban moves, payments,
      // etc.) — their current state can have already diverged from this static sheet
      // snapshot in either direction. Overwriting live state from a historical export
      // risks silently regressing real work, so existing SKUs are left untouched entirely;
      // only genuinely new SKUs are inserted.
      const existingAsset = await db.select({ id: assets.id }).from(assets).where(eq(assets.sku, sku)).limit(1);
      if (existingAsset.length > 0) {
        summary.assetsSkippedExisting++;
        summary.warnings.push(`Skipped existing asset SKU ${sku}: already in DB, sheet data not applied to avoid overwriting live state`);
        continue;
      }

      const assetData = {
        sku,
        itemName,
        category: row["Item Category"] ? String(row["Item Category"]) : null,
        currentStatus: rawStatus,
        currentArtistId: artistId,
        feeAmount: parseFeeAmount(row["Budget/Fee"]),
        gmailThreadId: row["Gmail Thread ID"] || row["Artist Thread ID"] ? String(row["Gmail Thread ID"] || row["Artist Thread ID"]) : null,
        rootMessageId: row["Artist Root Message-ID"] ? String(row["Artist Root Message-ID"]) : null,
        referenceImages: row["Ref Images"] ? [{ provider: "drive", externalId: String(row["Ref Images"]) }] : [],
        recolorReferenceImages: row["Recolours"] ? [{ provider: "drive", externalId: String(row["Recolours"]) }] : [],
      };

      const [newAsset] = await db.insert(assets).values(assetData).returning({ id: assets.id });
      const assetId = newAsset.id;

      summary.assetsImported++;

      // Create active assignment if artist assigned
      if (artistId) {
        await db.insert(assignments).values({
          assetId,
          artistId,
          feeAmount: assetData.feeAmount,
          isActive: true,
        });
        summary.assignmentsImported++;
      }

      // Extract per-status timestamp columns to emit structured status_history entries
      const timestampCols: { col: string; statusKey: string }[] = [
        { col: "Assignment Email Sent At", statusKey: "assigned" },
        { col: "Accepted At", statusKey: "in_progress" },
        { col: "Approved At", statusKey: "approved" },
        { col: "Final Files Received At", statusKey: "final_files_received" },
        { col: "Ready for Upload At", statusKey: "ready_for_upload" },
        { col: "Uploaded to Roblox At", statusKey: "uploaded_to_roblox" },
        { col: "Marked For Payment At", statusKey: "marked_for_payment" },
        { col: "Payment Done At", statusKey: "payment_done" },
      ];

      for (const tCol of timestampCols) {
        const tVal = row[tCol.col];
        if (tVal instanceof Date) {
          await db.insert(statusHistory).values({
            assetId,
            toStatus: tCol.statusKey,
            actorId: artistId,
            note: `Imported timeline step: ${tCol.col}`,
            createdAt: tVal,
          });
          summary.statusHistoryImported++;
        }
      }
    }
  }

  // ── 3. IMPORT AUDIT LOG ──────────────────────────────────────────
  if (workbook.SheetNames.includes("Audit Log")) {
    const sheet = workbook.Sheets["Audit Log"];
    const rawAudit: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet);
    const rowsToProcess = limitRows(rawAudit);

    for (const row of rowsToProcess) {
      const action = String(row["Action"] || "unknown").trim();
      const actorEmail = String(row["Actor Email"] || "").trim().toLowerCase();
      const actorId = actorEmail ? personnelEmailMap.get(actorEmail) || null : null;
      const entityId = row["SKU ID"] ? String(row["SKU ID"]) : null;
      const createdAt = row["Timestamp"] instanceof Date ? row["Timestamp"] : new Date();

      // audit_log has no natural unique key, so re-running the import (or importing a
      // sheet snapshot that overlaps a previous run) would duplicate rows. Guard by
      // treating (action, entityId, createdAt) as the effective identity of a sheet event.
      // entityId is frequently null (e.g. saveBriefConfig has no SKU) — SQL NULL never
      // equals another NULL via `=`, so that case needs `is null` instead of `eq`.
      const existingLog = await db
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, action),
            entityId === null ? isNull(auditLog.entityId) : eq(auditLog.entityId, entityId),
            eq(auditLog.createdAt, createdAt),
          ),
        )
        .limit(1);
      if (existingLog.length > 0) {
        summary.auditLogsSkippedDuplicate++;
        continue;
      }

      await db.insert(auditLog).values({
        action,
        entityType: "asset",
        entityId,
        actorId,
        payload: {
          oldValue: row["Old Value"] || null,
          newValue: row["New Value"] || null,
          notes: row["Notes"] || null,
        },
        createdAt,
      });
      summary.auditLogsImported++;
    }
  }

  return summary;
}

// CLI runner
if (require.main === module) {
  const isFull = process.argv.includes("--full");
  const mode = isFull ? "full" : "sample";
  console.log(`Starting Excel sheet data import (mode: ${mode})...`);

  importSheetData({ mode })
    .then((res) => {
      console.log("✓ Excel import completed cleanly:", res);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Import failed:", err);
      process.exit(1);
    });
}
