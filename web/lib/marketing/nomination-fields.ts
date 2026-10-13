// The Today's Picks form's fields and limits, as plain data so the browser panel and the server
// share one copy. Fields come from the form's item page as inspected on 13 Oct 2026 (Roblox survey
// SV_8cZb94oj9OvQm9g); pages after its Next button were not seen.

export const FORM_VERSION = "2026-10-13 item page (later pages unverified)";
export const ITEM_TYPES = ["Clothing / Shoes", "Accessory / Hair", "Character / Body", "Head", "Emote", "Look", "Background"] as const;
export const AUDIENCES = ["Male-identifying", "Female-identifying", "Everyone"] as const;
// Arjun's rule for final names: under 50 characters.
export const MAX_FINAL_NAME_CHARS = 49;
// Character limits shown on the form. final_name is Arjun's rule, not a form field.
export const FIELD_LIMITS = { final_name: MAX_FINAL_NAME_CHARS, tags: 80, season: 20, extra_info: 80, theme: 80 } as const;
export const DRAFT_FIELDS = ["final_name", "item_link", "item_type", "tags", "audience", "colour_links", "season", "extra_info", "theme"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];
export type DraftFields = Partial<Record<DraftField, string>>;
