import { db } from "@/lib/db/client";
import { styleSystems } from "@/lib/db/schema/style_systems";
import { asc, eq } from "drizzle-orm";

export async function listStyleSystems() {
  return db.select().from(styleSystems).orderBy(asc(styleSystems.name));
}

export async function createStyleSystem(name: string, description?: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Style system name is required");

  const existing = await db.select().from(styleSystems).where(eq(styleSystems.name, trimmed)).limit(1);
  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(styleSystems)
    .values({ name: trimmed, description: description?.trim() || null })
    .returning();
  return row;
}
