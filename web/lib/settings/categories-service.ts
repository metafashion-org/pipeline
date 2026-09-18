import { db } from "@/lib/db/client";
import { categories } from "@/lib/db/schema/categories";
import { asc } from "drizzle-orm";

export async function listCategories() {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function createCategory(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");

  const [category] = await db.insert(categories).values({ name: trimmed }).returning();

  return category;
}
