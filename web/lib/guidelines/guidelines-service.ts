import { db } from "@/lib/db/client";
import { guidelines } from "@/lib/db/schema/guidelines";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq } from "drizzle-orm";

export interface CreateGuidelineOptions {
  title: string;
  guidelineType: string;
  contentMarkdown: string;
  category?: string;
  linkedAssetCategory?: string;
  actorId?: string;
}

export async function createGuideline(options: CreateGuidelineOptions) {
  const { title, guidelineType, contentMarkdown, category, linkedAssetCategory, actorId } = options;

  const [guideline] = await db
    .insert(guidelines)
    .values({
      title,
      guidelineType,
      contentMarkdown,
      category: category || null,
      linkedAssetCategory: linkedAssetCategory || null,
    })
    .returning();

  await db.insert(auditLog).values({
    action: "createGuideline",
    entityType: "guideline",
    entityId: guideline.id,
    actorId: actorId || null,
    payload: { title, guidelineType, linkedAssetCategory },
  });

  return guideline;
}

export async function getGuidelines(linkedAssetCategory?: string) {
  if (linkedAssetCategory) {
    return await db
      .select()
      .from(guidelines)
      .where(eq(guidelines.linkedAssetCategory, linkedAssetCategory));
  }
  return await db.select().from(guidelines);
}
