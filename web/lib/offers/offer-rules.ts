// Rules shared by the offer service and the screens that explain it. No database imports, so client
// components can read them too.

/** The furthest past the offered deadline an artist may ask for. Every request still needs the team's approval. */
export const MAX_DEADLINE_EXTENSION_DAYS = 3;
