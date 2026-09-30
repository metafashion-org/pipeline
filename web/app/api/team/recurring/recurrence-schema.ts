import { z } from "zod";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_CHARS = 300;
const MAX_NOTES_CHARS = 20_000;
const SUNDAY = 0;
const SATURDAY = 6;

/** The body both recurring-task routes accept: the whole rule as it should be. */
export const RecurrenceSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  area: z.string().min(1),
  ownerId: z.uuid(),
  weekdays: z.array(z.number().int().min(SUNDAY).max(SATURDAY)).min(1),
  targetCount: z.number().int().positive().nullable().optional(),
  focus: z.string().max(MAX_TITLE_CHARS).nullable().optional(),
  focusUntil: z.string().regex(DAY_PATTERN).nullable().optional(),
  startsOn: z.string().regex(DAY_PATTERN),
  endsOn: z.string().regex(DAY_PATTERN).nullable().optional(),
  notes: z.string().max(MAX_NOTES_CHARS).nullable().optional(),
  isActive: z.boolean().optional(),
});
