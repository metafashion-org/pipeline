// Reference data for the Knowledge Registry's typed artifact IDs (TR-001, INS-002, ...).
//
// artifact_type_config's own comment says it is "seeded with the brief's own 10 examples", but
// no seeder existed anywhere — the live rows were created by hand. A freshly provisioned
// database therefore had zero artifact types, which means createKnowledgeArtifact has no prefix
// to allocate against and the whole Knowledge module is unusable until someone adds them one at
// a time. Three test files assert these exist, and all three failed for exactly that reason.
//
// These are the brief's ten and match what the live database holds. The table stays
// admin-editable: this only fills in the starting set, and never overwrites nextSequence,
// because that counter is live allocation state, not configuration.

import { db } from "@/lib/db/client";
import { artifactTypeConfig } from "@/lib/db/schema/artifact_type_config";
import { eq } from "drizzle-orm";

export const CANONICAL_ARTIFACT_TYPES = [
  { prefix: "TR", label: "Trend Brief", sortOrder: 0 },
  { prefix: "INS", label: "Insight", sortOrder: 1 },
  { prefix: "ANA", label: "Analysis", sortOrder: 2 },
  { prefix: "RK", label: "Recolor Kit", sortOrder: 3 },
  { prefix: "REF", label: "Reference", sortOrder: 4 },
  { prefix: "MBD", label: "Moodboard", sortOrder: 5 },
  { prefix: "TG", label: "Technical Guideline", sortOrder: 6 },
  { prefix: "MKT", label: "Marketing Insight", sortOrder: 7 },
  { prefix: "CD", label: "Creation Doc", sortOrder: 8 },
  { prefix: "PRM", label: "Prompt", sortOrder: 9 },
];

/**
 * Ensures the ten canonical artifact types exist.
 *
 * Input: nothing. Output: how many rows were created.
 * Idempotent: an existing prefix has its label and ordering refreshed, and its nextSequence left
 * alone — rewriting that counter would hand out artifact IDs that are already in use.
 */
export async function seedArtifactTypes(): Promise<{ created: number }> {
  let created = 0;
  for (const type of CANONICAL_ARTIFACT_TYPES) {
    const [existing] = await db
      .select({ id: artifactTypeConfig.id })
      .from(artifactTypeConfig)
      .where(eq(artifactTypeConfig.prefix, type.prefix))
      .limit(1);

    if (existing) {
      await db
        .update(artifactTypeConfig)
        .set({ label: type.label, sortOrder: type.sortOrder })
        .where(eq(artifactTypeConfig.id, existing.id));
    } else {
      await db.insert(artifactTypeConfig).values(type);
      created += 1;
    }
  }
  return { created };
}

if (require.main === module) {
  seedArtifactTypes()
    .then(({ created }) => {
      console.log(`Artifact type seeding complete (${created} created).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Artifact type seeding failed:", err);
      process.exit(1);
    });
}
