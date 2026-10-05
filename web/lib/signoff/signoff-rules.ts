// Who needs Arjun's sign-off, and the states a sign-off moves through. Imported by client
// components too, so nothing here touches the database.

export const SIGNOFF_STATES = ["waiting", "sent_back", "approved", "dropped"] as const;
export type SignoffState = (typeof SIGNOFF_STATES)[number];
export const WAITING: SignoffState = "waiting";
export const SENT_BACK: SignoffState = "sent_back";
export const APPROVED: SignoffState = "approved";
export const DROPPED: SignoffState = "dropped";

/** The status an asset waits in for sign-off. Kept as "curated" from the curation trial; labelled "Waiting for sign-off". */
export const SIGNOFF_STATUS = "curated";

// The admin role signs assets off. All three admin logins are Arjun's.
const SIGNOFF_ROLE = "admin";

/** Whether this person signs assets off (and so their own adds skip sign-off). */
export function signsOff(roles: string[]): boolean {
  return roles.some((r) => r.toLowerCase() === SIGNOFF_ROLE);
}

/** Where the sign-off digest goes. */
export const SIGNOFF_DIGEST_TO = "arjun@metafashion.in";

// The digest goes out every 2 hours from 10:00 to 20:00 India time, only when something new is waiting.
export const DIGEST_FIRST_HOUR_IST = 10;
export const DIGEST_LAST_HOUR_IST = 20;

/** The hour (0-23) in India for a moment. */
export function istHour(moment: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(moment));
}

/** Whether the digest may go out at this moment. */
export function inDigestHours(moment: Date): boolean {
  const hour = istHour(moment);
  return hour >= DIGEST_FIRST_HOUR_IST && hour <= DIGEST_LAST_HOUR_IST;
}
