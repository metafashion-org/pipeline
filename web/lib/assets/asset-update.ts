import { z } from "zod";
import { toFileStoreEntries, toLinkText } from "./file-store";

export const UpdateAssetSchema = z.object({
  itemName: z.string().trim().min(1).optional(),
  category: z.string().nullable().optional(),
  feeAmount: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || (v.trim() !== "" && !isNaN(Number(v))), {
      message: "feeAmount must be a numeric string or null",
    }),
  currency: z.string().trim().min(1).optional(),
  deadline: z
    .string()
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || !isNaN(Date.parse(v)), {
      message: "Invalid deadline date",
    }),
  paymentReceiptUrl: z.string().nullable().optional(),
  // Pasted blocks of links, the same form the create dialog takes.
  referenceImages: z.string().nullable().optional(),
  recolorReferenceImages: z.string().nullable().optional(),
});

export type AssetUpdatePatch = z.infer<typeof UpdateAssetSchema>;

export interface AssetCurrentValues {
  itemName: string;
  category: string | null;
  feeAmount: string | null;
  currency: string | null;
  deadline: Date | null;
  paymentReceiptUrl: string | null;
  referenceImages: unknown;
  recolorReferenceImages: unknown;
}

export interface AssetChange {
  from: unknown;
  to: unknown;
}

export interface AssetChangeResult {
  changes: Record<string, AssetChange>;
  updates: Record<string, unknown>;
}

/**
 * Diffs a patch against an asset's current values and returns only the fields that actually changed.
 * Input: the asset's current column values, and a patch of optional new values (a field left undefined means it was not sent, so it is skipped entirely).
 * Output: `changes` (for the audit log payload) and `updates` (for the db update .set() call), covering only fields whose value actually differs.
 * feeAmount is compared numerically, not as strings, because the numeric column round-trips as a differently-formatted string ("1000.00" vs a form's "1000") which would otherwise log a phantom edit on every save.
 * deadline is compared by timestamp for the same reason - ISO string formatting can differ without the instant changing.
 */
export function computeAssetChanges(current: AssetCurrentValues, patch: AssetUpdatePatch): AssetChangeResult {
  const changes: Record<string, AssetChange> = {};
  const updates: Record<string, unknown> = {};

  if (patch.itemName !== undefined && patch.itemName !== current.itemName) {
    changes.itemName = { from: current.itemName, to: patch.itemName };
    updates.itemName = patch.itemName;
  }

  if (patch.category !== undefined && patch.category !== current.category) {
    changes.category = { from: current.category, to: patch.category };
    updates.category = patch.category;
  }

  if (patch.feeAmount !== undefined) {
    const currentNum = current.feeAmount === null ? null : Number(current.feeAmount);
    const nextNum = patch.feeAmount === null ? null : Number(patch.feeAmount);
    if (currentNum !== nextNum) {
      changes.feeAmount = { from: current.feeAmount, to: patch.feeAmount };
      updates.feeAmount = patch.feeAmount;
    }
  }

  if (patch.currency !== undefined && patch.currency !== current.currency) {
    changes.currency = { from: current.currency, to: patch.currency };
    updates.currency = patch.currency;
  }

  if (patch.deadline !== undefined) {
    const nextDate = patch.deadline === null ? null : new Date(patch.deadline);
    const currentTime = current.deadline ? current.deadline.getTime() : null;
    const nextTime = nextDate ? nextDate.getTime() : null;
    if (currentTime !== nextTime) {
      changes.deadline = {
        from: current.deadline ? current.deadline.toISOString() : null,
        to: nextDate ? nextDate.toISOString() : null,
      };
      updates.deadline = nextDate;
    }
  }

  if (patch.paymentReceiptUrl !== undefined && patch.paymentReceiptUrl !== current.paymentReceiptUrl) {
    changes.paymentReceiptUrl = { from: current.paymentReceiptUrl, to: patch.paymentReceiptUrl };
    updates.paymentReceiptUrl = patch.paymentReceiptUrl;
  }

  // Reference links are compared as the normalised URL list rather than the raw text, so reordering
  // whitespace or re-pasting the same links in the same order is not recorded as an edit.
  for (const field of ["referenceImages", "recolorReferenceImages"] as const) {
    const incoming = patch[field];
    if (incoming === undefined) continue;
    const nextEntries = toFileStoreEntries(incoming);
    const nextUrls = nextEntries.map((e) => e.externalId);
    const currentUrls = toLinkText(current[field]).split("\n").filter(Boolean);
    if (currentUrls.join("\n") === nextUrls.join("\n")) continue;
    changes[field] = {
      from: currentUrls.length ? `${currentUrls.length} link(s)` : "empty",
      to: nextUrls.length ? `${nextUrls.length} link(s)` : "empty",
    };
    updates[field] = nextEntries;
  }

  return { changes, updates };
}
