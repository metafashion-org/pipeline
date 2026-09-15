import { db } from "@/lib/db/client";
import { brandGroups } from "@/lib/db/schema/brand_groups";
import { asc } from "drizzle-orm";

export async function listBrandGroups() {
  return db.select().from(brandGroups).orderBy(asc(brandGroups.sortOrder), asc(brandGroups.name));
}

export async function createBrandGroup(name: string, robloxGroupUrl?: string | null) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [group] = await db
    .insert(brandGroups)
    .values({ name: trimmed, robloxGroupUrl: robloxGroupUrl?.trim() || null })
    .returning();

  return group;
}
