// The one place a stored option list is turned into something a form control can render.
//
// form_fields.options and curation_field_config.options are both JSONB with no shape enforced by
// the database, and two shapes are live in production right now: the admin builder writes plain
// strings (["Small","Medium"]), while rows seeded earlier hold objects ({"label":"Small","value":"small"}).
// Every render site cast the column to string[] and mapped it straight into JSX, so an object row
// crashed the page with "Objects are not valid as a React child" and, before that, warned about
// duplicate keys because every object stringified to "[object Object]".
//
// Normalizing on read rather than migrating the column keeps both shapes readable: a form built
// before this still renders, and nothing has to be rewritten in place.

export interface FieldOption {
  /** What the person filling the form sees. */
  label: string;
  /** What gets stored in form_submissions.values / curation_item_ideas.field_values. */
  value: string;
}

function coerce(raw: unknown): FieldOption | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    return trimmed ? { label: trimmed, value: trimmed } : null;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return { label: String(raw), value: String(raw) };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    // `name` and `title` are accepted alongside `label` because hand-written seed data has used
    // all three; whichever is present wins, and the value falls back to the label so an option
    // that only carries a display string is still selectable.
    const label = firstString(obj.label, obj.name, obj.title, obj.value);
    const value = firstString(obj.value, obj.key, obj.id, label);
    if (!label || !value) return null;
    return { label, value };
  }
  return null;
}

function firstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (typeof c === "number" || typeof c === "boolean") return String(c);
  }
  return "";
}

/**
 * Turns a stored options column into a list a Select can render.
 *
 * Input: the raw JSONB value — a string array, an array of {label, value} objects, a mixture, null, or anything else. Output: options with a non-empty label and value, in the stored order, with duplicate values dropped.
 *
 * Empty values are dropped rather than kept, because Radix's SelectItem treats value="" as "clear the selection" and throws when an item declares it.
 */
export function normalizeFieldOptions(raw: unknown): FieldOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: FieldOption[] = [];
  for (const entry of raw) {
    const option = coerce(entry);
    if (!option || seen.has(option.value)) continue;
    seen.add(option.value);
    out.push(option);
  }
  return out;
}

/**
 * The label to show for a value that is already stored.
 *
 * Input: the options and the stored value. Output: the matching option's label, or the value itself when it came from an option that has since been removed.
 */
export function labelForValue(options: FieldOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
