import { z } from "zod";

export const TASK_STATUSES = [
    "unassigned",
    "assigned",
    "in_progress",
    "feedback_submitted_via_email",
    "approved",
    "uploaded_and_marked_for_payment",
    "payment_done",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number]
export const TaskStatusSchema = z.enum(TASK_STATUSES);

// ── User Roles ────────────────────────────────────────
export const USER_ROLES = ["admin", "artist"] as const;
export type UserRole = (typeof USER_ROLES)[number]

// ── Artist Field Visibility ───────────────────────────
export const ARTIST_VISIBLE_FIELDS = [
    "SKU ID",
    "Item Name",
    "Item Category",
    "Email Address",
    "Production Status",
    "Item Proportion",
    "Technical Specs",
    "Recolours",
    "Assignment Email Sent At",
    "Assignment Thread ID",
    "Source Links",
    "Ref Images"
] as const;
// update this to control what the artist can see as and when you modify your data structure

// ── Status Metadata ───────────────────────────────────
export interface StatusMeta {
    label: string
    classes: string
    order: number
}

export const STATUS_CONFIG: Record<TaskStatus, StatusMeta> = {
    unassigned: { label: "Unassigned", classes: "bg-slate-100   text-slate-700   dark:bg-slate-900/40   dark:text-slate-300", order: 0 },
    assigned: { label: "Assigned", classes: "bg-blue-100    text-blue-700    dark:bg-blue-900/40    dark:text-blue-300", order: 1 },
    in_progress: { label: "In Progress", classes: "bg-indigo-100  text-indigo-700  dark:bg-indigo-900/40  dark:text-indigo-300", order: 2 },
    feedback_submitted_via_email: { label: "Feedback Submitted", classes: "bg-purple-100  text-purple-700  dark:bg-purple-900/40  dark:text-purple-300", order: 3 },
    approved: { label: "Approved", classes: "bg-green-100   text-green-700   dark:bg-green-900/40   dark:text-green-300", order: 4 },
    uploaded_and_marked_for_payment: { label: "Uploaded & Marked", classes: "bg-amber-100   text-amber-700   dark:bg-amber-900/40   dark:text-amber-300", order: 5 },
    payment_done: { label: "Payment Done", classes: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300", order: 6 },
} as const;

// ── Transition Rules ──────────────────────────────────
// an object where the root keys must be every possible From Status. Inside that, optionally create keys for specific Roles (admin/artist). The value for each role should be a frozen array of the To Statuses they are allowed to move the card into.
export const ALLOWED_TRANSITIONS: Record<TaskStatus, Partial<Record<UserRole, readonly TaskStatus[]>>> = {
    unassigned: {},
    assigned: { artist: ["in_progress"] },
    in_progress: { artist: ["feedback_submitted_via_email"] },
    feedback_submitted_via_email: {},
    approved: {},
    uploaded_and_marked_for_payment: {},
    payment_done: {},
} as const;

export function isValidTransition(from: TaskStatus, to: TaskStatus, role: UserRole): boolean {
    if (from === to) return true;
    if (role === "admin") return true; // admins can move cards anywhere
    return ALLOWED_TRANSITIONS[from]?.[role]?.includes(to) ?? false;
}

// ── Column Configs Per Role ───────────────────────────
export interface ColumnConfig {
    readonly id: TaskStatus
    readonly title: string
}

export const ADMIN_COLUMNS: readonly ColumnConfig[] = [
    { id: "unassigned", title: "Unassigned" },
    { id: "assigned", title: "Assigned" },
    { id: "in_progress", title: "In Progress" },
    { id: "feedback_submitted_via_email", title: "Received for Feedback" },
    { id: "approved", title: "Approved" },
    { id: "uploaded_and_marked_for_payment", title: "Marked for Payment" },
    { id: "payment_done", title: "Payment Done" },
] as const;

export const ARTIST_COLUMNS: readonly ColumnConfig[] = [
    { id: "assigned", title: "Assigned" },
    { id: "in_progress", title: "In Progress" },
    { id: "feedback_submitted_via_email", title: "Submitted for Feedback" },
    { id: "approved", title: "Approved" },
    { id: "uploaded_and_marked_for_payment", title: "Marked for Payment" },
    { id: "payment_done", title: "Payment Done" },
] as const;

export function getColumnsForRole(role: UserRole): readonly ColumnConfig[] {
    return role === "admin" ? ADMIN_COLUMNS : ARTIST_COLUMNS;
}

export function parseTaskStatus(statusString: string | null | undefined): TaskStatus {
    if (!statusString) return "unassigned";
    const cleaned = statusString.trim().toLowerCase();
    if (TASK_STATUSES.includes(cleaned as TaskStatus)) {
        return cleaned as TaskStatus;
    }

    // check against labels 
    for (const [key, meta] of Object.entries(STATUS_CONFIG)) {
        if (meta.label.toLowerCase() === cleaned || cleaned.includes(meta.label.toLowerCase())) {
            return key as TaskStatus;
        }
    }

    return "unassigned";
}
