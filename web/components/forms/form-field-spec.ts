import type { FieldOption } from "@/lib/forms/field-options";

/** One field as both the filler and the builder's preview need it. */
export interface FormFieldSpec {
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  options: FieldOption[];
  section: string | null;
  helpText: string | null;
  placeholder: string | null;
}

/** An answer is one value, or several when the field is a multi-select. */
export type FieldValue = string | string[];

export type FormValues = Record<string, FieldValue>;

export interface FormSection {
  /** The name shown in the jump rail. */
  name: string;
  /** Null for the form's first, unnamed section — the fields written before anyone added one. */
  key: string | null;
  fields: FormFieldSpec[];
}

/** The name shown for fields that were never put in a section. */
export const DEFAULT_SECTION_NAME = "Details";

/**
 * Groups fields into the sections the form is drawn in.
 *
 * Input: the fields in sort order. Output: one section per distinct section name, in the order those names first appear, each holding its fields in the order given.
 *
 * Fields with no section come first under a default name rather than being scattered, so a form
 * built before sections existed reads as one section instead of losing its shape.
 */
export function groupIntoSections(fields: FormFieldSpec[]): FormSection[] {
  const sections: FormSection[] = [];
  const byKey = new Map<string | null, FormSection>();

  for (const field of fields) {
    const key = field.section?.trim() || null;
    let section = byKey.get(key);
    if (!section) {
      section = { key, name: key || DEFAULT_SECTION_NAME, fields: [] };
      byKey.set(key, section);
      sections.push(section);
    }
    section.fields.push(field);
  }

  return sections;
}

export function isBlank(value: FieldValue | undefined): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

export function asText(value: FieldValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function asList(value: FieldValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

export interface SectionProgress {
  answered: number;
  total: number;
  /** Required fields in this section that are still blank. */
  missing: number;
}

/**
 * Counts what is filled in one section.
 *
 * Input: the section and the current answers. Output: how many fields have an answer, how many there are, and how many required ones are still blank.
 * This is what lets the jump rail say which part of the form still needs work without making anyone scroll through it to find out.
 */
export function sectionProgress(section: FormSection, values: FormValues): SectionProgress {
  let answered = 0;
  let missing = 0;
  for (const field of section.fields) {
    const filled = !isBlank(values[field.fieldKey]);
    if (filled) answered += 1;
    else if (field.isRequired) missing += 1;
  }
  return { answered, total: section.fields.length, missing };
}
