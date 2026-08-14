import { db } from "./client";
import { statuses } from "./schema/statuses";
import { statusTransitionRules } from "./schema/status_transition_rules";
import { eq, and } from "drizzle-orm";

export const CANONICAL_STATUSES = [
  {
    key: "unassigned",
    label: "Unassigned",
    sortOrder: 1,
    description: "New SKU created, awaiting artist assignment",
    whoCanMoveIn: ["admin", "operator"],
    nextActionHint: "Assign an artist to this SKU",
    automationNote: "Auto-transitioned when a SKU is created",
  },
  {
    key: "assigned",
    label: "Assigned",
    sortOrder: 2,
    description: "Artist assigned and assignment notification sent",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "Artist accepts assignment and begins WIP",
    automationNote: "Auto-transitioned when assignment email is sent",
  },
  {
    key: "in_progress",
    label: "In Production",
    sortOrder: 3,
    description: "Artist is actively working on the asset",
    whoCanMoveIn: ["artist", "operator", "admin"],
    nextActionHint: "Submit WIP or final draft for review",
    automationNote: "Manual move by artist or operator",
  },
  {
    key: "in_review",
    label: "In Review",
    sortOrder: 4,
    description: "Asset submitted and undergoing operator review",
    whoCanMoveIn: ["artist", "operator", "admin"],
    nextActionHint: "Approve asset or request revisions",
    automationNote: "Manual move by artist on submission",
  },
  {
    key: "revisions_requested",
    label: "Revisions Requested",
    sortOrder: 5,
    description: "Operator requested revisions on submitted asset",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "Artist updates WIP per feedback",
    automationNote: "Manual move by operator",
  },
  {
    key: "approved",
    label: "Approved",
    sortOrder: 6,
    description: "Asset design approved by operator",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "Submit final files link",
    automationNote: "Manual move by operator",
  },
  {
    key: "final_files_received",
    label: "Final Files Received",
    sortOrder: 7,
    description: "Final uncompressed production files submitted",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "Notify Roblox Publisher for upload",
    automationNote: "Auto-transitioned on valid final-file submission",
  },
  {
    key: "ready_for_upload",
    label: "Ready for Upload",
    sortOrder: 8,
    description: "Roblox Publisher notified and asset ready for Roblox",
    whoCanMoveIn: ["publisher", "operator", "admin"],
    nextActionHint: "Upload to Roblox and submit marketplace links",
    automationNote: "Auto-transitioned when publisher is notified",
  },
  {
    key: "uploaded_to_roblox",
    label: "Uploaded to Roblox",
    sortOrder: 9,
    description: "Asset live on Roblox marketplace, link verified",
    whoCanMoveIn: ["publisher", "operator", "admin"],
    nextActionHint: "Mark for artist payment",
    automationNote: "Auto-transitioned on valid Roblox link submission",
  },
  {
    key: "marked_for_payment",
    label: "Marked for Payment",
    sortOrder: 10,
    description: "Payment approved, pending payout execution",
    whoCanMoveIn: ["payment_admin", "admin"],
    nextActionHint: "Execute payment to artist",
    automationNote: "Strictly gated: reachable ONLY from Uploaded to Roblox",
  },
  {
    key: "payment_done",
    label: "Payment Done",
    sortOrder: 11,
    description: "Artist payout complete, SKU cycle finished",
    whoCanMoveIn: ["payment_admin", "admin"],
    nextActionHint: "SKU cycle complete",
    automationNote: "Manual move by Payment Admin",
  },
];

export const CANONICAL_TRANSITION_RULES = [
  // Manual transitions
  { fromStatus: "assigned", toStatus: "in_progress", role: "artist", isAutomatic: false, triggerNote: "Artist begins work" },
  { fromStatus: "in_progress", toStatus: "in_review", role: "artist", isAutomatic: false, triggerNote: "Artist submits draft" },
  { fromStatus: "in_review", toStatus: "revisions_requested", role: "operator", isAutomatic: false, triggerNote: "Operator requests revisions" },
  { fromStatus: "revisions_requested", toStatus: "in_progress", role: "artist", isAutomatic: false, triggerNote: "Artist updates work" },
  { fromStatus: "in_review", toStatus: "approved", role: "operator", isAutomatic: false, triggerNote: "Operator approves asset" },
  { fromStatus: "uploaded_to_roblox", toStatus: "marked_for_payment", role: "payment_admin", isAutomatic: false, triggerNote: "Payment admin marks paid (Gated: only from uploaded_to_roblox)" },
  { fromStatus: "marked_for_payment", toStatus: "payment_done", role: "payment_admin", isAutomatic: false, triggerNote: "Payment admin finishes payout" },
  
  // Automatic transitions
  { fromStatus: "unassigned", toStatus: "assigned", role: null, isAutomatic: true, triggerNote: "Triggered on assignment email sent" },
  { fromStatus: "approved", toStatus: "final_files_received", role: null, isAutomatic: true, triggerNote: "Triggered on valid final-file submission" },
  { fromStatus: "final_files_received", toStatus: "ready_for_upload", role: null, isAutomatic: true, triggerNote: "Triggered when publisher notified" },
  { fromStatus: "ready_for_upload", toStatus: "uploaded_to_roblox", role: null, isAutomatic: true, triggerNote: "Triggered on valid Roblox link submission" },
];

export async function seedStatuses() {
  console.log("Seeding canonical statuses...");
  for (const statusItem of CANONICAL_STATUSES) {
    const existing = await db.select().from(statuses).where(eq(statuses.key, statusItem.key)).limit(1);
    if (existing.length === 0) {
      await db.insert(statuses).values(statusItem);
    } else {
      await db.update(statuses).set(statusItem).where(eq(statuses.key, statusItem.key));
    }
  }

  console.log("Seeding canonical transition rules...");
  for (const rule of CANONICAL_TRANSITION_RULES) {
    const existing = await db.select().from(statusTransitionRules)
      .where(and(
        eq(statusTransitionRules.fromStatus, rule.fromStatus),
        eq(statusTransitionRules.toStatus, rule.toStatus)
      ))
      .limit(1);
      
    if (existing.length === 0) {
      await db.insert(statusTransitionRules).values(rule);
    } else {
      await db.update(statusTransitionRules).set(rule).where(and(
        eq(statusTransitionRules.fromStatus, rule.fromStatus),
        eq(statusTransitionRules.toStatus, rule.toStatus)
      ));
    }
  }

  console.log("Status seeding complete!");
}

// Allow direct execution via CLI
if (require.main === module) {
  seedStatuses()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}
