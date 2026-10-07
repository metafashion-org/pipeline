import { db } from "./client";
import { statuses } from "./schema/statuses";
import { statusTransitionRules } from "./schema/status_transition_rules";
import { eq, and } from "drizzle-orm";

export const CANONICAL_STATUSES = [
  {
    key: "unassigned",
    label: "Unassigned",
    sortOrder: 1,
    description: "New asset, waiting for an artist.",
    whoCanMoveIn: ["admin", "operator"],
    nextActionHint: "Drag the card to Assigned, or open it and use Assign artist. The artist gets an offer by email and Discord.",
    automationNote: "New assets start here. An asset comes back here when its artist declines the offer.",
  },
  {
    key: "assigned",
    label: "Assigned",
    sortOrder: 2,
    description: "An artist has been offered this asset.",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "The artist accepts, asks for up to 3 more days, or declines on My Tasks. Once they accept, they move it to In Production.",
    automationNote: "Moves here when someone picks an artist. Goes back to Unassigned if the artist declines.",
  },
  {
    key: "in_progress",
    label: "In Production",
    sortOrder: 3,
    description: "The artist is making the asset.",
    whoCanMoveIn: ["artist", "operator", "admin"],
    nextActionHint: "The artist moves it to In Review when a draft is ready.",
    automationNote: null,
  },
  {
    key: "in_review",
    label: "In Review",
    sortOrder: 4,
    description: "The team is reviewing the artist's draft.",
    whoCanMoveIn: ["artist", "operator", "admin"],
    nextActionHint: "The team moves it to Approved, or to Revisions Requested with feedback for the artist.",
    automationNote: null,
  },
  {
    key: "revisions_requested",
    label: "Revisions Requested",
    sortOrder: 5,
    description: "The team asked the artist for changes.",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "The artist moves it back to In Production while making the changes. If the changes are already in, the team moves it straight to Approved.",
    automationNote: null,
  },
  {
    key: "approved",
    label: "Approved",
    sortOrder: 6,
    description: "The team approved the design.",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "The artist uploads the final files on the asset's card. The card then moves to Ready for Upload on its own.",
    automationNote: "Uploading the final files moves the card on.",
  },
  {
    key: "final_files_received",
    label: "Final Files Received",
    sortOrder: 7,
    description: "The final files are in Drive.",
    whoCanMoveIn: ["operator", "admin"],
    nextActionHint: "Passes straight on to Ready for Upload. A card only stays here if telling the uploader failed.",
    automationNote: "Moves here when the final files are uploaded, and on to Ready for Upload straight away.",
  },
  {
    key: "ready_for_upload",
    label: "Ready for Upload",
    sortOrder: 8,
    description: "The final files are ready for the uploader.",
    whoCanMoveIn: ["publisher", "operator", "admin"],
    nextActionHint: "The uploader uploads it to Roblox and adds the catalog links on the Upload queue page. The card then moves to Uploaded to Roblox on its own.",
    automationNote: "Adding the Roblox links moves the card on.",
  },
  {
    key: "uploaded_to_roblox",
    label: "Uploaded to Roblox",
    sortOrder: 9,
    description: "The asset is live on the Roblox marketplace.",
    whoCanMoveIn: ["publisher", "operator", "admin"],
    nextActionHint: "The payment admin, or someone allowed to mark payments, moves it to Marked for Payment.",
    automationNote: "Moves here when the uploader adds the Roblox links.",
  },
  {
    key: "marked_for_payment",
    label: "Marked for Payment",
    sortOrder: 10,
    description: "The artist's payment is approved and waiting to be paid.",
    whoCanMoveIn: ["payment_admin", "admin"],
    nextActionHint: "The payment admin pays the artist, attaches the receipt on the Payments page, then moves it to Payment Done.",
    automationNote: "Only reachable from Uploaded to Roblox, for everyone including admins.",
  },
  {
    key: "payment_done",
    label: "Payment Done",
    sortOrder: 11,
    description: "The artist has been paid. This is the last step.",
    whoCanMoveIn: ["payment_admin", "admin"],
    nextActionHint: null,
    automationNote: "Needs the payment receipt attached first, for everyone including admins.",
  },
];

export const CANONICAL_TRANSITION_RULES = [
  // Manual transitions
  { fromStatus: "assigned", toStatus: "in_progress", role: "artist", isAutomatic: false, triggerNote: "The artist starts work, after accepting the offer." },
  { fromStatus: "in_progress", toStatus: "in_review", role: "artist", isAutomatic: false, triggerNote: "The artist submits a draft for review." },
  { fromStatus: "in_review", toStatus: "revisions_requested", role: "operator", isAutomatic: false, triggerNote: "The team asks the artist for changes." },
  { fromStatus: "revisions_requested", toStatus: "in_progress", role: "artist", isAutomatic: false, triggerNote: "The artist starts on the changes." },
  { fromStatus: "revisions_requested", toStatus: "approved", role: "operator", isAutomatic: false, triggerNote: "The team approves the changes once they're in." },
  { fromStatus: "in_review", toStatus: "approved", role: "operator", isAutomatic: false, triggerNote: "The team approves the draft." },
  { fromStatus: "uploaded_to_roblox", toStatus: "marked_for_payment", role: "payment_admin", isAutomatic: false, triggerNote: "The payment admin, or someone allowed to mark payments, marks it for payment." },
  { fromStatus: "marked_for_payment", toStatus: "payment_done", role: "payment_admin", isAutomatic: false, triggerNote: "The payment admin pays the artist and attaches the receipt." },
  
  // Automatic transitions
  { fromStatus: "unassigned", toStatus: "assigned", role: null, isAutomatic: true, triggerNote: "Moves when someone picks an artist, which sends them the offer." },
  { fromStatus: "approved", toStatus: "final_files_received", role: null, isAutomatic: true, triggerNote: "Moves when the artist uploads the final files." },
  { fromStatus: "final_files_received", toStatus: "ready_for_upload", role: null, isAutomatic: true, triggerNote: "Moves straight on once the uploader is told the files are in." },
  { fromStatus: "ready_for_upload", toStatus: "uploaded_to_roblox", role: null, isAutomatic: true, triggerNote: "Moves when the uploader adds the Roblox links." },
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
