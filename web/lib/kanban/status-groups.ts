// Groups of status keys that several parts of the app read the same way. Plain data, so client
// components and SQL builders can both import it.

/** The artist has been paid. */
export const PAID_STATUSES = ["payment_done"];

/** The asset is live on Roblox: uploaded, and every status after that. */
export const LIVE_ON_ROBLOX_STATUSES = ["uploaded_to_roblox", "marked_for_payment", ...PAID_STATUSES];
