import { db } from "@/lib/db/client";
import { knowledgeArtifacts } from "@/lib/db/schema/knowledge_artifacts";
import { auditLog } from "@/lib/db/schema/audit_log";
import { eq, like, sql } from "drizzle-orm";

const ARTIFACT_PREFIX_MAP: Record<string, string> = {
  tech_spec: "SPEC",
  mannequin_rig: "RIG",
  recruiting_faq: "FAQ",
  style_guide: "STYLE",
};

export function getArtifactPrefix(artifactType: string): string {
  if (ARTIFACT_PREFIX_MAP[artifactType]) return ARTIFACT_PREFIX_MAP[artifactType];
  const cleanType = artifactType.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return cleanType.slice(0, 4) || "ART";
}

export async function generateTypedArtifactId(artifactType: string): Promise<string> {
  const prefix = getArtifactPrefix(artifactType);
  const prefixPattern = `${prefix}-%`;

  // Query highest existing sequence number for this prefix
  const existing = await db
    .select({ title: knowledgeArtifacts.title })
    .from(knowledgeArtifacts)
    .where(like(knowledgeArtifacts.title, prefixPattern));

  const maxSeq = existing.reduce((max, item) => {
    const parts = item.title.split("-");
    const num = parseInt(parts[1], 10);
    return !isNaN(num) && num > max ? num : max;
  }, 0);

  const nextSeq = maxSeq + 1;
  const padded = String(nextSeq).padStart(4, "0");
  return `${prefix}-${padded}`;
}

export interface CreateArtifactOptions {
  title?: string;
  artifactType: string;
  fileUrl: string;
  description?: string;
  actorId?: string;
}

export async function createKnowledgeArtifact(options: CreateArtifactOptions) {
  const { artifactType, fileUrl, description, actorId } = options;

  const generatedId = await generateTypedArtifactId(artifactType);
  const title = options.title ? `${generatedId}: ${options.title}` : generatedId;

  const [artifact] = await db
    .insert(knowledgeArtifacts)
    .values({
      title,
      artifactType,
      fileUrl,
      description: description || null,
    })
    .returning();

  await db.insert(auditLog).values({
    action: "createKnowledgeArtifact",
    entityType: "knowledge_artifact",
    entityId: artifact.id,
    actorId: actorId || null,
    payload: { generatedId, artifactType, fileUrl },
  });

  return { ...artifact, generatedId };
}

export async function getKnowledgeArtifacts(artifactType?: string) {
  if (artifactType) {
    return await db
      .select()
      .from(knowledgeArtifacts)
      .where(eq(knowledgeArtifacts.artifactType, artifactType));
  }
  return await db.select().from(knowledgeArtifacts);
}
