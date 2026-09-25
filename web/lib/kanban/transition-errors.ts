/**
 * Plain-language explanations for a refused card move, each with a stable code.
 *
 * A refusal used to read "Transition from 'in_review' to 'in_progress' is not permitted: no matching
 * rule in status_transition_rules", which tells an artist nothing they can act on. Each refusal now
 * carries a code to quote when asking for help, a title naming what was refused, the reason, and
 * what to do instead. The "what to do instead" text is built from the live status_transition_rules
 * and statuses rows, so it stays correct when an admin edits the pipeline in Settings.
 */

export type TransitionErrorCode =
  | "ASSET_NOT_FOUND"
  | "STATUS_NOT_FOUND"
  | "NOT_YOUR_ASSET"
  | "NO_SUCH_STEP"
  | "PAYMENT_ORDER"
  | "MOVE_SWITCHED_OFF"
  | "ROLE_NOT_ALLOWED"
  | "RECEIPT_REQUIRED";

export interface TransitionErrorDetails {
  code: TransitionErrorCode;
  httpStatus: number;
  /** One sentence naming what was refused. */
  title: string;
  /** Why it was refused. */
  reason: string;
  /** What to do instead, when there is something to do. */
  hint?: string;
}

/**
 * Thrown when a status move is refused. Route handlers answer it with `httpStatus` (403 for a
 * permission refusal, 404 or 400 for a stale asset or status) and pass the code, title, reason and
 * hint through so the board can show them.
 */
export class TransitionRefusedError extends Error {
  readonly code: TransitionErrorCode;
  readonly httpStatus: number;
  readonly title: string;
  readonly reason: string;
  readonly hint: string | undefined;

  constructor(details: TransitionErrorDetails) {
    super([details.title, details.reason, details.hint].filter(Boolean).join(" "));
    this.name = "TransitionRefusedError";
    this.code = details.code;
    this.httpStatus = details.httpStatus;
    this.title = details.title;
    this.reason = details.reason;
    this.hint = details.hint || undefined;
  }
}

export interface StatusInfo {
  key: string;
  label: string;
  sortOrder: number;
}

/** One status_transition_rules row leaving the asset's current status. */
export interface NextStep {
  toKey: string;
  role: string | null;
  isAutomatic: boolean;
  isAllowed: boolean;
}

/** Which check refused a move the rules otherwise permit. */
export type RoleRefusal = { kind: "rule-role"; role: string } | { kind: "column"; roles: string[] };

export interface MoveContext {
  from: StatusInfo;
  to: StatusInfo;
  /** Display label for every status key, so a hint can name statuses the way the board does. */
  labels: ReadonlyMap<string, string>;
  stepsFromCurrent: NextStep[];
  actorRoles: ReadonlySet<string>;
}

const ROLE_WORDS: Record<string, string> = {
  operator: "the team",
  admin: "an admin",
  payment_admin: "the payment admin",
  publisher: "the publisher",
  curator: "the curator",
  artist: "the artist",
  marketing: "the marketing team",
};

function roleWords(role: string): string {
  return ROLE_WORDS[role.toLowerCase()] ?? `the ${role} role`;
}

// "A", "A or B", "A, B or C", with repeats dropped.
function orList(items: string[]): string {
  const unique = Array.from(new Set(items));
  if (unique.length <= 1) return unique[0] ?? "";
  return `${unique.slice(0, -1).join(", ")} or ${unique[unique.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Says which moves leave the current status and who makes each one.
 *
 * Input: the move context. Output: one to three sentences, split into what the actor can do, what someone else does, and what happens without anyone moving it.
 */
function nextMovesHint(ctx: MoveContext): string {
  const label = (key: string) => ctx.labels.get(key) ?? key;
  const usable = ctx.stepsFromCurrent.filter((step) => step.isAllowed);
  const manual = usable.filter((step) => !step.isAutomatic);
  const yours = manual.filter((step) => !step.role || ctx.actorRoles.has(step.role.toLowerCase()));
  const others = manual.filter((step) => step.role && !ctx.actorRoles.has(step.role.toLowerCase()));
  const automatic = usable.filter((step) => step.isAutomatic);

  const parts: string[] = [];
  if (yours.length > 0) {
    parts.push(`From ${ctx.from.label} you can move it to ${orList(yours.map((step) => label(step.toKey)))}.`);
  }
  if (others.length > 0) {
    const who = orList(others.map((step) => roleWords(step.role as string)));
    parts.push(`${capitalize(who)} moves it to ${orList(others.map((step) => label(step.toKey)))}.`);
  }
  if (automatic.length > 0) {
    parts.push(`It moves to ${orList(automatic.map((step) => label(step.toKey)))} on its own.`);
  }
  if (ctx.stepsFromCurrent.length === 0) {
    parts.push(`${ctx.from.label} is the last step, so there are no further moves.`);
  } else if (usable.length === 0) {
    parts.push(`Every move out of ${ctx.from.label} is switched off right now.`);
  }
  return parts.join(" ");
}

export function assetNotFound(): TransitionErrorDetails {
  return {
    code: "ASSET_NOT_FOUND",
    httpStatus: 404,
    title: "That asset can't be found.",
    reason: "It may have been deleted, or this page is out of date.",
    hint: "Refresh the board and try again.",
  };
}

export function statusNotFound(statusKey: string): TransitionErrorDetails {
  return {
    code: "STATUS_NOT_FOUND",
    httpStatus: 400,
    title: "That column isn't part of the pipeline.",
    reason: `There is no status called "${statusKey}".`,
    hint: "Refresh the page. If it keeps happening, tell the team.",
  };
}

export function notYourAsset(): TransitionErrorDetails {
  return {
    code: "NOT_YOUR_ASSET",
    httpStatus: 403,
    title: "You can only move assets assigned to you.",
    reason: "This asset isn't assigned to you.",
    hint: "If it should be yours, ask the team to assign it to you.",
  };
}

/** No rule connects the two statuses: a skipped step or a move backwards. */
export function noSuchStep(ctx: MoveContext): TransitionErrorDetails {
  const backwards = ctx.to.sortOrder < ctx.from.sortOrder;
  return {
    code: "NO_SUCH_STEP",
    httpStatus: 403,
    title: `${ctx.from.label} can't move straight to ${ctx.to.label}.`,
    reason: backwards
      ? "Assets don't move backwards on their own."
      : "The pipeline has no direct step between those two statuses, so a status can't be skipped.",
    hint: nextMovesHint(ctx),
  };
}

/** The two payment statuses have no rule from the status the asset is in. Admins are refused too. */
export function paymentOrder(ctx: MoveContext): TransitionErrorDetails {
  return {
    code: "PAYMENT_ORDER",
    httpStatus: 403,
    title: `${ctx.to.label} can't be reached from ${ctx.from.label}.`,
    reason: "Payment statuses follow a fixed order that nobody can skip, admins included.",
    hint: nextMovesHint(ctx),
  };
}

/** A rule row exists for this move but is switched off. */
export function moveSwitchedOff(ctx: MoveContext, failureReason: string | null): TransitionErrorDetails {
  return {
    code: "MOVE_SWITCHED_OFF",
    httpStatus: 403,
    title: `Moving from ${ctx.from.label} to ${ctx.to.label} is switched off.`,
    reason: failureReason?.trim() || "An admin has turned this move off.",
    hint: "Ask an admin if this looks wrong.",
  };
}

/** The move exists, but the person's role isn't the one it belongs to. */
export function roleNotAllowed(ctx: MoveContext, refusal: RoleRefusal): TransitionErrorDetails {
  return {
    code: "ROLE_NOT_ALLOWED",
    httpStatus: 403,
    title: `You can't move this card from ${ctx.from.label} to ${ctx.to.label}.`,
    reason:
      refusal.kind === "rule-role"
        ? `That move is made by ${roleWords(refusal.role)}.`
        : `Only ${orList(refusal.roles.map(roleWords))} can move cards into ${ctx.to.label}.`,
    hint: nextMovesHint(ctx),
  };
}

export function receiptRequired(ctx: MoveContext): TransitionErrorDetails {
  return {
    code: "RECEIPT_REQUIRED",
    httpStatus: 403,
    title: `${ctx.to.label} needs a payment receipt first.`,
    reason: "No payment receipt is attached to this asset yet.",
    hint: "Attach the receipt on the Payments page, then move the card again.",
  };
}
