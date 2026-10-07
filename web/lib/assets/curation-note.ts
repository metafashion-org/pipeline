// The comment that explains how an asset's Registry links (insights, trend briefs, moodboards) come
// together to justify curating it. It reuses the existing "Trend Reasoning" curation field rather than
// adding a field: stored in assets.brief_fields under this key, team-only, never in the artist's brief.
// Imported by client components too, so nothing here touches the database.

export const CURATION_NOTE_KEY = "trendReasoning";

export const CURATION_NOTE_PROMPT =
  "How do these come together to explain this item? e.g. INS002 shows glowing items now sell, TR006 is the Christmas push, and the MBD board has the look.";
