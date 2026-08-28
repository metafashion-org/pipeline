// lib/curation/draft-service.ts
// Parallel drafts + version history for the Curation form, the daily-use
// entry point your team actually complained about ("only able to hold one
// Google-Forms-style draft at a time"). Reuses curation_item_ideas' own
// 'draft' status (documented in the schema from the original build, never
// wired up) rather than a second, competing table - a draft and a
// submitted idea are the same row, just at a different point in its life.

import { db } from "@/lib/db/client";
import { curationItemIdeas } from "@/lib/db/schema/curation_item_ideas";
import { curationIdeaVersions } from "@/lib/db/schema/curation_idea_versions";
import { eq, and, desc } from "drizzle-orm";

export interface DraftFields {
  ideaTitle: string;
  category: string | null;
  trendReasoning: string | null;
  sourceLinks: string[];
  moodboardUrls: string[];
  fieldValues: Record<string, unknown>;
}

const EMPTY_DRAFT: DraftFields = {
  ideaTitle: "",
  category: null,
  trendReasoning: null,
  sourceLinks: [],
  moodboardUrls: [],
  fieldValues: {},
};

// Two saves in quick succession with materially identical content don't
// each deserve their own version entry - this is the "not redundant"
// requirement. A save still always updates the live draft row immediately
// either way; this only throttles the separate, append-only history log.
const MIN_MS_BETWEEN_VERSIONS = 20_000;

function fieldsEqual(a: DraftFields, b: DraftFields): boolean {
  return (
    a.ideaTitle === b.ideaTitle &&
    a.category === b.category &&
    a.trendReasoning === b.trendReasoning &&
    JSON.stringify(a.sourceLinks) === JSON.stringify(b.sourceLinks) &&
    JSON.stringify(a.moodboardUrls) === JSON.stringify(b.moodboardUrls) &&
    JSON.stringify(a.fieldValues) === JSON.stringify(b.fieldValues)
  );
}

export async function listActiveDrafts(ownerId: string) {
  return db
    .select()
    .from(curationItemIdeas)
    .where(and(eq(curationItemIdeas.submittedBy, ownerId), eq(curationItemIdeas.status, "draft")))
    .orderBy(desc(curationItemIdeas.updatedAt));
}

// Only creates a draft row when there's something worth saving - an
// untouched, empty form visit should never leave a phantom draft behind.
// Called on the first meaningful edit, not on page load.
export async function createDraft(ownerId: string, initial: Partial<DraftFields> = {}) {
  const fields: DraftFields = { ...EMPTY_DRAFT, ...initial };
  const [draft] = await db
    .insert(curationItemIdeas)
    .values({
      ideaTitle: fields.ideaTitle || "Untitled idea",
      category: fields.category,
      trendReasoning: fields.trendReasoning,
      sourceLinks: fields.sourceLinks,
      moodboardUrls: fields.moodboardUrls,
      fieldValues: fields.fieldValues,
      submittedBy: ownerId,
      status: "draft",
      version: 1,
    })
    .returning();

  await db.insert(curationIdeaVersions).values({
    ideaId: draft.id,
    version: 1,
    ideaTitle: draft.ideaTitle,
    category: draft.category,
    trendReasoning: draft.trendReasoning,
    sourceLinks: draft.sourceLinks,
    moodboardUrls: draft.moodboardUrls,
    fieldValues: draft.fieldValues,
  });

  return draft;
}

async function getOwnedDraft(draftId: string, ownerId: string) {
  const [draft] = await db
    .select()
    .from(curationItemIdeas)
    .where(and(eq(curationItemIdeas.id, draftId), eq(curationItemIdeas.submittedBy, ownerId)))
    .limit(1);
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "draft") throw new Error("This idea has already been submitted and can no longer be edited as a draft");
  return draft;
}

// The live row is always updated immediately (autosave never loses work),
// but a new version snapshot is only appended when the content actually
// changed since the last one AND enough time has passed - see
// MIN_MS_BETWEEN_VERSIONS. Both checks exist for the same reason: don't
// fill the history with near-identical entries from normal typing.
export async function saveDraft(draftId: string, ownerId: string, updates: Partial<DraftFields>) {
  const draft = await getOwnedDraft(draftId, ownerId);

  const merged: DraftFields = {
    ideaTitle: updates.ideaTitle ?? draft.ideaTitle,
    category: updates.category !== undefined ? updates.category : draft.category,
    trendReasoning: updates.trendReasoning !== undefined ? updates.trendReasoning : draft.trendReasoning,
    sourceLinks: updates.sourceLinks ?? (draft.sourceLinks as string[]),
    moodboardUrls: updates.moodboardUrls ?? (draft.moodboardUrls as string[]),
    fieldValues: updates.fieldValues ?? (draft.fieldValues as Record<string, unknown>),
  };

  const [lastVersion] = await db
    .select()
    .from(curationIdeaVersions)
    .where(eq(curationIdeaVersions.ideaId, draftId))
    .orderBy(desc(curationIdeaVersions.version))
    .limit(1);

  const lastVersionFields: DraftFields | null = lastVersion
    ? {
        ideaTitle: lastVersion.ideaTitle,
        category: lastVersion.category,
        trendReasoning: lastVersion.trendReasoning,
        sourceLinks: lastVersion.sourceLinks as string[],
        moodboardUrls: lastVersion.moodboardUrls as string[],
        fieldValues: lastVersion.fieldValues as Record<string, unknown>,
      }
    : null;

  const contentChanged = !lastVersionFields || !fieldsEqual(merged, lastVersionFields);
  const enoughTimeElapsed = !lastVersion || Date.now() - lastVersion.savedAt.getTime() > MIN_MS_BETWEEN_VERSIONS;
  const shouldSnapshot = contentChanged && enoughTimeElapsed;

  const nextVersion = shouldSnapshot ? draft.version + 1 : draft.version;

  const [updated] = await db
    .update(curationItemIdeas)
    .set({
      ideaTitle: merged.ideaTitle || "Untitled idea",
      category: merged.category,
      trendReasoning: merged.trendReasoning,
      sourceLinks: merged.sourceLinks,
      moodboardUrls: merged.moodboardUrls,
      fieldValues: merged.fieldValues,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(curationItemIdeas.id, draftId))
    .returning();

  if (shouldSnapshot) {
    await db.insert(curationIdeaVersions).values({
      ideaId: draftId,
      version: nextVersion,
      ideaTitle: updated.ideaTitle,
      category: updated.category,
      trendReasoning: updated.trendReasoning,
      sourceLinks: updated.sourceLinks,
      moodboardUrls: updated.moodboardUrls,
      fieldValues: updated.fieldValues,
    });
  }

  return { draft: updated, versioned: shouldSnapshot };
}

export async function discardDraft(draftId: string, ownerId: string) {
  await getOwnedDraft(draftId, ownerId);
  // Cascades to curation_idea_versions (onDelete: cascade) - nothing worth
  // keeping from a draft nobody ever submitted.
  await db.delete(curationItemIdeas).where(eq(curationItemIdeas.id, draftId));
}

export async function listDraftVersions(draftId: string, ownerId: string) {
  await getOwnedDraft(draftId, ownerId);
  return db
    .select()
    .from(curationIdeaVersions)
    .where(eq(curationIdeaVersions.ideaId, draftId))
    .orderBy(desc(curationIdeaVersions.version));
}

// Restoring is itself a forward action, never destructive: it writes the
// old snapshot's content back onto the live row via the normal saveDraft
// path (forcing a fresh version snapshot), so the history the user is
// browsing when they hit "Restore" is never rewritten out from under them.
export async function restoreDraftVersion(draftId: string, ownerId: string, versionId: string) {
  await getOwnedDraft(draftId, ownerId);
  const [version] = await db
    .select()
    .from(curationIdeaVersions)
    .where(and(eq(curationIdeaVersions.id, versionId), eq(curationIdeaVersions.ideaId, draftId)))
    .limit(1);
  if (!version) throw new Error("Version not found");

  // Force a snapshot even if content matches an already-recent save -
  // "restore" is an explicit user action, not routine autosave, so it
  // should always leave a real marker in the history.
  const draft = await getOwnedDraft(draftId, ownerId);
  const nextVersion = draft.version + 1;
  const [updated] = await db
    .update(curationItemIdeas)
    .set({
      ideaTitle: version.ideaTitle,
      category: version.category,
      trendReasoning: version.trendReasoning,
      sourceLinks: version.sourceLinks,
      moodboardUrls: version.moodboardUrls,
      fieldValues: version.fieldValues,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(curationItemIdeas.id, draftId))
    .returning();

  await db.insert(curationIdeaVersions).values({
    ideaId: draftId,
    version: nextVersion,
    ideaTitle: updated.ideaTitle,
    category: updated.category,
    trendReasoning: updated.trendReasoning,
    sourceLinks: updated.sourceLinks,
    moodboardUrls: updated.moodboardUrls,
    fieldValues: updated.fieldValues,
  });

  return updated;
}
