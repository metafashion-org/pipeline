/**
 * Whether one card may move from its status to another, and what the board tells each person
 * about the next step.
 *
 * No database imports: the server calls checkMove inside updateAssetStatusInKanban to enforce a
 * move, and the board calls the same function to colour cards, explain each column and highlight
 * where a dragged card can go. One function for both means the board never shows a move the
 * server would refuse.
 */
import type { CapabilitySet } from "@/lib/auth/rbac";
import type { OfferStatus } from "@/lib/db/schema/asset_offers";
import { orList, roleWords, type RoleRefusal } from "./transition-errors";

// The two payment statuses stay deny-by-default for everyone, admins included (PLAN.md §4/§9):
// the admin override for a missing rule never reaches them.
export const PAYMENT_GATED_STATUSES = ["marked_for_payment", "payment_done"];

// The Curated column, where curators' ideas wait for the team's review while curation review is
// switched on (lib/settings/app-settings.ts). Added by drizzle/0035_curation_review.sql.
export const CURATED_STATUS = "curated";

// Copied from OPEN_OFFER_STATUSES in lib/db/schema/asset_offers.ts. Importing that module here
// would pull the Drizzle table definitions into the board's browser bundle.
const WAITING_OFFER_STATUSES: OfferStatus[] = ["pending", "extension_requested"];

/** One status_transition_rules row. */
export interface MoveRule {
  fromStatus: string;
  toStatus: string;
  role: string | null;
  isAllowed: boolean;
  isAutomatic: boolean;
  triggerNote: string | null;
  failureReason: string | null;
}

/** The parts of a statuses row a move check reads. */
export interface MoveStatus {
  key: string;
  label: string;
  sortOrder: number;
  whoCanMoveIn: string[] | null;
}

// Who is asking for the transition. `system` is for transitions the pipeline performs on its own
// behalf in response to a real event (an artist being picked, a valid final file arriving) rather
// than someone dragging a card. Those have no human role to check, and the event that triggered
// them is authorised at its own entry point.
export type TransitionActor =
  | { system: true }
  | { system?: false; roles: string[]; personnelId?: string; caps?: CapabilitySet };

/** What a move check needs to know about the card itself. */
export interface MoveCard {
  currentStatus: string;
  artistId: string | null;
  offerStatus: OfferStatus | null;
  hasPaymentReceipt: boolean;
  /** For a card in Curated: who curated it. */
  curatorId?: string | null;
  /** For a card in Curated: true while the team has sent it back to its curator. */
  curationSentBack?: boolean;
}

/** Which check refused a move. transition-errors.ts turns each kind into the words people see. */
export type MoveRefusal =
  | { kind: "not-your-asset" }
  | { kind: "no-such-step" }
  | { kind: "payment-order" }
  | { kind: "switched-off"; failureReason: string | null }
  | { kind: "role"; refusal: RoleRefusal }
  | { kind: "artist-required" }
  | { kind: "offer-open" }
  | { kind: "receipt-required" };

export function actorRoles(actor: TransitionActor | undefined): Set<string> {
  if (!actor || actor.system) return new Set();
  return new Set(actor.roles.map((r) => r.toLowerCase()));
}

function actorCaps(actor: TransitionActor | undefined): CapabilitySet | undefined {
  return actor && !actor.system ? actor.caps : undefined;
}

/**
 * Decides whether this actor's role lets them move a card into this status.
 *
 * Two columns constrain a transition and both are honoured where set:
 * status_transition_rules.role names the single role a manual transition belongs to, and
 * statuses.who_can_move_in lists every role allowed to put a card in that column. Admin satisfies
 * both.
 */
function refuseByRole(actor: TransitionActor | undefined, rule: MoveRule | undefined, target: MoveStatus): RoleRefusal | null {
  if (actor?.system) return null;

  const roles = actorRoles(actor);
  if (roles.has("admin")) return null;

  // canMarkForPayment is a narrower grant than the payment_admin role: someone can flag an asset
  // as ready to be paid without also being able to release the payment. Scoped to this one target
  // status, so marked_for_payment -> payment_done stays reserved for payment_admin and admin.
  if (target.key === "marked_for_payment" && actorCaps(actor)?.canMarkForPayment) return null;

  if (rule?.role && !roles.has(rule.role.toLowerCase())) {
    return { kind: "rule-role", role: rule.role };
  }

  const allowedIn = (target.whoCanMoveIn || []).map((r) => r.toLowerCase());
  if (allowedIn.length > 0 && !allowedIn.some((r) => roles.has(r))) {
    return { kind: "column", roles: allowedIn };
  }

  return null;
}

/**
 * Checks one move, in the order the server has always applied its checks.
 *
 * Input: who is moving the card, the card, the target status, and the status_transition_rules row
 * joining the card's status to the target (undefined when there is none).
 * Output: null when the move is allowed, or the check that refused it.
 */
export function checkMove(
  actor: TransitionActor | undefined,
  card: MoveCard,
  target: MoveStatus,
  rule: MoveRule | undefined
): MoveRefusal | null {
  const roles = actorRoles(actor);
  const isSystem = Boolean(actor?.system);

  // An artist may only move their own work. Anyone who manages production is exempt.
  const isArtistOnly = !isSystem && roles.has("artist") && !roles.has("admin") && !roles.has("operator");
  const personnelId = actor && !actor.system ? actor.personnelId : undefined;
  if (isArtistOnly && card.artistId !== personnelId) return { kind: "not-your-asset" };

  // Deny by default: a move needs a rule row. Admins (and the system) may make a move no rule
  // covers, to repair records, except into the two payment statuses.
  if (!rule) {
    const adminOverride = (isSystem || roles.has("admin")) && !PAYMENT_GATED_STATUSES.includes(target.key);
    if (!adminOverride) {
      return PAYMENT_GATED_STATUSES.includes(target.key) ? { kind: "payment-order" } : { kind: "no-such-step" };
    }
  } else if (!rule.isAllowed) {
    // An explicit forbid applies to everyone, admins included.
    return { kind: "switched-off", failureReason: rule.failureReason };
  }

  const roleRefusal = refuseByRole(actor, rule, target);
  if (roleRefusal) return { kind: "role", refusal: roleRefusal };

  // A card only reaches Assigned with an artist on it, because picking the artist is what sends
  // them the offer. The Assign dialog picks the artist and then moves the card as the system.
  if (!isSystem && target.key === "assigned" && !card.artistId) return { kind: "artist-required" };

  // While the offer is unanswered the asset isn't the artist's yet, so nobody moves it on until
  // they accept. Moving it back to Unassigned stays possible.
  if (
    !isSystem &&
    card.currentStatus === "assigned" &&
    target.key !== "unassigned" &&
    card.offerStatus !== null &&
    WAITING_OFFER_STATUSES.includes(card.offerStatus)
  ) {
    return { kind: "offer-open" };
  }

  // A client requirement: the receipt is attached before a payment is marked done, for every role.
  if (target.key === "payment_done" && !card.hasPaymentReceipt) return { kind: "receipt-required" };

  return null;
}

/** How a card or column is coloured on the board. */
export type NextStepTone = "you" | "other" | "auto" | "blocked" | "done";

export interface NextStepSummary {
  tone: NextStepTone;
  /** One short line for the card, e.g. "You can move it to In Review". */
  text: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Someone who only sees their own cards: an artist who doesn't also manage production.
function seesOnlyOwnCards(actor: TransitionActor | undefined): boolean {
  const roles = actorRoles(actor);
  return roles.has("artist") && !roles.has("admin") && !roles.has("operator") && !actorCaps(actor)?.canViewAllAssets;
}

function isCardsArtist(actor: TransitionActor | undefined, card: MoveCard): boolean {
  return Boolean(card.artistId) && actor !== undefined && !actor.system && actor.personnelId === card.artistId;
}

interface TriggerAction {
  /** What the card says to the person whose job it is. */
  yours: string;
  /** What the card says to everyone else. */
  others: (artist: string) => string;
  /** Who does it, for the column panel. */
  who: string;
  isYourJob: (actor: TransitionActor | undefined, card: MoveCard) => boolean;
}

// Moves the pipeline makes itself when someone does something other than drag the card, keyed
// "from>to". Each names the action and whose job it is, so a card can say "Pick an artist" to the
// person who does that, and "The team picks an artist" to everyone else.
const TRIGGER_ACTIONS: Record<string, TriggerAction> = {
  "unassigned>assigned": {
    yours: "Pick an artist",
    others: () => "The team picks an artist",
    who: "The team",
    isYourJob: (actor) => Boolean(actorCaps(actor)?.canAssignArtists),
  },
  "approved>final_files_received": {
    yours: "Upload the final files",
    others: (artist) => `${capitalize(artist)} uploads the final files`,
    who: "The artist",
    isYourJob: isCardsArtist,
  },
  "ready_for_upload>uploaded_to_roblox": {
    yours: "Add the Roblox links on the Upload queue",
    others: () => "The uploader adds the Roblox links",
    who: "The uploader",
    isYourJob: (actor) => {
      const roles = actorRoles(actor);
      return roles.has("publisher") || roles.has("uploader");
    },
  },
};

/**
 * Whether a manual step is this viewer's job, which is narrower than being allowed to make it:
 * an admin may move almost any card, but the board still shows whose turn it is. An artist step
 * is only yours on your own card.
 */
function isYourStep(actor: TransitionActor | undefined, card: MoveCard, target: MoveStatus, rule: MoveRule): boolean {
  if (checkMove(actor, card, target, rule) !== null) return false;
  const roles = actorRoles(actor);
  if (target.key === "marked_for_payment" && actorCaps(actor)?.canMarkForPayment) return true;
  const role = rule.role?.toLowerCase();
  if (role === "artist") return isCardsArtist(actor, card);
  if (role) return roles.has(role);
  return (target.whoCanMoveIn || []).some((r) => r.toLowerCase() !== "admin" && roles.has(r.toLowerCase()));
}

function exitsFrom(statusKey: string, rules: MoveRule[], statusByKey: ReadonlyMap<string, MoveStatus>): MoveRule[] {
  return rules
    .filter((r) => r.fromStatus === statusKey && r.isAllowed && statusByKey.has(r.toStatus))
    .sort((a, b) => (statusByKey.get(a.toStatus)?.sortOrder ?? 0) - (statusByKey.get(b.toStatus)?.sortOrder ?? 0));
}

function lastStatusKey(statuses: MoveStatus[]): string | undefined {
  return statuses.reduce<MoveStatus | undefined>((max, s) => (!max || s.sortOrder > max.sortOrder ? s : max), undefined)?.key;
}

/**
 * Says what happens next to one card, from the viewer's side.
 *
 * Input: the viewer, the card, every status and rule, and the card's artist name (used in place
 * of "the artist"). Output: a tone for the colour and one line of text.
 */
export function describeNextStep(
  actor: TransitionActor | undefined,
  card: MoveCard,
  statuses: MoveStatus[],
  rules: MoveRule[],
  artistName: string | null
): NextStepSummary {
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  const label = (key: string) => statusByKey.get(key)?.label ?? key;
  // A move to an earlier column (back to Unassigned, say) is a way out, not the next step.
  const currentOrder = statusByKey.get(card.currentStatus)?.sortOrder ?? 0;
  const exits = exitsFrom(card.currentStatus, rules, statusByKey).filter((r) => (statusByKey.get(r.toStatus)?.sortOrder ?? 0) > currentOrder);
  const artist = artistName || "the artist";

  if (exits.length === 0) {
    return lastStatusKey(statuses) === card.currentStatus
      ? { tone: "done", text: "Finished" }
      : { tone: "blocked", text: "No move out of this column is switched on" };
  }

  // A curated idea: the team approves it or sends it back, and a sent-back one waits on its curator.
  if (card.currentStatus === CURATED_STATUS) {
    const isCurator = Boolean(card.curatorId) && actor !== undefined && !actor.system && actor.personnelId === card.curatorId;
    if (card.curationSentBack) {
      return isCurator
        ? { tone: "you", text: "Make the changes in My Drafts" }
        : { tone: "blocked", text: "Sent back to the curator" };
    }
    const approve = exits.find((r) => r.toStatus === "unassigned");
    const target = approve ? statusByKey.get(approve.toStatus) : undefined;
    // Anyone allowed to approve is the reviewer here, admins included: with the trial set to
    // "Admins only", the admin trying it out is the only one who sees the card.
    if (approve && target && checkMove(actor, card, target, approve) === null) {
      return { tone: "you", text: "Approve it or send it back" };
    }
    return { tone: "other", text: isCurator ? "The team is reviewing your idea" : "The team reviews it" };
  }

  // An unanswered offer holds the card for everyone. Say whose move it is.
  if (card.currentStatus === "assigned" && card.offerStatus === "pending") {
    return isCardsArtist(actor, card)
      ? { tone: "you", text: "Accept or decline the offer" }
      : { tone: "blocked", text: `Waiting for ${artist} to accept` };
  }
  if (card.currentStatus === "assigned" && card.offerStatus === "extension_requested") {
    return actorCaps(actor)?.canAssignArtists
      ? { tone: "you", text: "Approve or reject the new deadline" }
      : { tone: "blocked", text: "Waiting for the team to answer the deadline request" };
  }
  if (card.currentStatus === "marked_for_payment" && !card.hasPaymentReceipt) {
    return actorRoles(actor).has("payment_admin")
      ? { tone: "you", text: "Attach the payment receipt" }
      : { tone: "blocked", text: "Needs the payment receipt" };
  }

  const manual = exits.filter((r) => !r.isAutomatic);
  const yours = manual.filter((r) => {
    const target = statusByKey.get(r.toStatus);
    return target !== undefined && isYourStep(actor, card, target, r);
  });
  if (yours.length > 0) {
    return { tone: "you", text: `You can move it to ${orList(yours.map((r) => label(r.toStatus)))}` };
  }

  const automatic = exits.filter((r) => r.isAutomatic);
  for (const rule of automatic) {
    const trigger = TRIGGER_ACTIONS[`${rule.fromStatus}>${rule.toStatus}`];
    if (trigger?.isYourJob(actor, card)) return { tone: "you", text: trigger.yours };
  }

  if (manual.length > 0) {
    const who = manual.map((r) => (r.role?.toLowerCase() === "artist" ? artist : roleWords(r.role ?? "operator")));
    return { tone: "other", text: `${capitalize(orList(who))} moves it on` };
  }

  const first = automatic[0];
  const trigger = TRIGGER_ACTIONS[`${first.fromStatus}>${first.toStatus}`];
  return trigger
    ? { tone: "other", text: trigger.others(artist) }
    : { tone: "auto", text: `Moves to ${label(first.toStatus)} on its own` };
}

/** One way out of a column, as the column's info panel lists it. */
export interface ColumnExit {
  toKey: string;
  toLabel: string;
  tone: NextStepTone;
  /** "You", "The artist", "The team", or "Automatic". */
  who: string;
  /** The rule's trigger note, e.g. "The team approves the draft." */
  how: string | null;
}

export interface ColumnGuide {
  /** The column's short summary line, e.g. "Next: the team". */
  next: NextStepSummary;
  exits: ColumnExit[];
  /** Who may put cards in this column, in words, or null when the column doesn't restrict it. */
  whoCanMoveIn: string | null;
  /** True when the viewer may make at least one move out of this column, their job or not. */
  canMoveOut: boolean;
}

/**
 * Explains a column to the viewer: who moves its cards on, to where, and how.
 *
 * Judged by role only, since a column holds many cards: a card's own conditions (an unanswered
 * offer, a missing receipt) show on the card itself.
 */
export function describeColumn(
  actor: TransitionActor | undefined,
  statusKey: string,
  statuses: MoveStatus[],
  rules: MoveRule[]
): ColumnGuide {
  const statusByKey = new Map(statuses.map((s) => [s.key, s]));
  const status = statusByKey.get(statusKey);
  // A stand-in card for the role checks. An artist only ever sees their own cards, so for them it
  // carries their own id; for everyone else it belongs to nobody in particular.
  const personnelId = actor && !actor.system ? actor.personnelId ?? null : null;
  const standIn: MoveCard = {
    currentStatus: statusKey,
    artistId: seesOnlyOwnCards(actor) ? personnelId : null,
    offerStatus: null,
    hasPaymentReceipt: true,
  };

  const exitRules = exitsFrom(statusKey, rules, statusByKey);
  const exits: ColumnExit[] = exitRules.map((rule) => {
    const target = statusByKey.get(rule.toStatus) as MoveStatus;
    const base = { toKey: target.key, toLabel: target.label, how: rule.triggerNote };
    if (rule.isAutomatic) {
      const trigger = TRIGGER_ACTIONS[`${rule.fromStatus}>${rule.toStatus}`];
      if (!trigger) return { ...base, tone: "auto" as const, who: "Automatic" };
      const yours = trigger.isYourJob(actor, standIn);
      return { ...base, tone: yours ? ("you" as const) : ("other" as const), who: yours ? "You" : trigger.who };
    }
    const yours = isYourStep(actor, standIn, target, rule);
    return {
      ...base,
      tone: yours ? ("you" as const) : ("other" as const),
      who: yours ? "You" : capitalize(roleWords(rule.role ?? "operator")),
    };
  });

  const currentOrder = status?.sortOrder ?? 0;
  const forward = exits.filter((e) => (statusByKey.get(e.toKey)?.sortOrder ?? 0) > currentOrder);
  let next: NextStepSummary;
  if (forward.length === 0) {
    next = lastStatusKey(statuses) === statusKey ? { tone: "done", text: "Last step" } : { tone: "blocked", text: "No way out is switched on" };
  } else if (forward.some((e) => e.tone === "you")) {
    next = { tone: "you", text: "Next: you" };
  } else if (forward.every((e) => e.tone === "auto")) {
    next = { tone: "auto", text: "Next: automatic" };
  } else {
    const who = forward.filter((e) => e.tone === "other").map((e) => e.who.toLowerCase());
    next = { tone: "other", text: `Next: ${orList(who)}` };
  }

  const canMoveOut = exitRules.some((rule) => {
    const target = statusByKey.get(rule.toStatus) as MoveStatus;
    return checkMove(actor, standIn, target, rule) === null;
  });

  const allowedIn = status?.whoCanMoveIn ?? [];
  return {
    next,
    exits,
    whoCanMoveIn: allowedIn.length > 0 ? capitalize(orList(allowedIn.map(roleWords))) : null,
    canMoveOut,
  };
}

/**
 * Every status this viewer may drop the card on right now. The board highlights these while the
 * card is dragged.
 */
export function allowedTargets(
  actor: TransitionActor | undefined,
  card: MoveCard,
  statuses: MoveStatus[],
  rules: MoveRule[]
): Set<string> {
  const allowed = new Set<string>();
  for (const target of statuses) {
    if (target.key === card.currentStatus) continue;
    const rule = rules.find((r) => r.fromStatus === card.currentStatus && r.toStatus === target.key);
    const refusal = checkMove(actor, card, target, rule);
    // Dropping an unassigned card on Assigned opens the Assign dialog instead of moving it, so it
    // counts as a place the card can go for anyone who can assign.
    const opensAssignDialog =
      refusal?.kind === "artist-required" && card.currentStatus === "unassigned" && Boolean(actorCaps(actor)?.canAssignArtists);
    if (refusal === null || opensAssignDialog) allowed.add(target.key);
  }
  return allowed;
}
