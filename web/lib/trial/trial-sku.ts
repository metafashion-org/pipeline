// Which board cards belong to the trial run, and when it's the trial bot's move. Kept apart from
// trial-run.ts, which reads the database, so the board's client components can import it.

export const TRIAL_SKU_PREFIX = "TRIAL-";

// The statuses where the bot, playing the artist, makes the next move a few seconds after the
// team's: accepting and starting work (Assigned), sending it for review (In Production), making the
// changes (Revisions Requested) and handing in the files (Approved). See trial-run.ts.
const BOT_TURN_STATUSES = new Set(["assigned", "in_progress", "revisions_requested", "approved"]);

/** Whether this card is the trial asset and the bot moves it next. */
export function isTrialBotTurn(card: { sku: string; currentStatus: string }): boolean {
  return card.sku.startsWith(TRIAL_SKU_PREFIX) && BOT_TURN_STATUSES.has(card.currentStatus);
}
