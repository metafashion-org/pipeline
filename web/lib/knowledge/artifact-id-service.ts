import { db } from "@/lib/db/client";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { eq, sql } from "drizzle-orm";

/**
 * Atomically claims and formats the next artifact ID for a given type, e.g. "TR001".
 *
 * Unlike the asset SKU generator (lib/assets/sku.ts), which finds the next
 * number by scanning existing SKUs and could theoretically race under true
 * concurrency, this claims the number via a single UPDATE ... RETURNING —
 * Postgres's own row lock on the UPDATE makes two simultaneous submissions
 * of the same type provably get different numbers, not just usually.
 * Worth being strict here specifically: the whole point of these IDs per
 * the brief is unambiguous cross-referencing — a duplicate would defeat
 * that entirely, unlike a duplicate SKU which is at least caught by a
 * unique constraint at insert time.
 *
 * Input: the artifact type's config row id. Output: the claimed id, e.g.
 * "TR001" — permanent, never reused even if the artifact is later deleted,
 * since the counter only ever moves forward.
 */
export async function claimNextArtifactId(artifactTypeId: string): Promise<string> {
  const [claimed] = await db
    .update(artifactTypeConfig)
    .set({ nextSequence: sql`${artifactTypeConfig.nextSequence} + 1` })
    .where(eq(artifactTypeConfig.id, artifactTypeId))
    .returning({ prefix: artifactTypeConfig.prefix, nextSequence: artifactTypeConfig.nextSequence });

  if (!claimed) {
    throw new Error(`Unknown artifact type: ${artifactTypeId}`);
  }

  // nextSequence now holds the value AFTER incrementing, so the number this
  // call actually claimed is one less than what's stored.
  const claimedSequence = claimed.nextSequence - 1;
  return `${claimed.prefix}${String(claimedSequence).padStart(3, "0")}`;
}
