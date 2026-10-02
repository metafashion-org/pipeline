import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema/api_keys";
import { personnel } from "@/lib/db/schema/personnel";
import { auditLog } from "@/lib/db/schema/audit_log";

// Keys look like "mfk_<43 base64url characters>": 32 random bytes, so they can't be guessed.
const KEY_PREFIX = "mfk_";
const KEY_RANDOM_BYTES = 32;
// How much of the key Settings shows to tell keys apart, e.g. "mfk_AbCd".
const SHOWN_PREFIX_CHARS = 8;
const API_KEY_ENTITY = "api_key";

export class ApiKeyError extends Error {}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyRow {
  id: string;
  name: string;
  personName: string;
  personEmail: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** Every key, newest first, without the keys themselves. */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      personName: personnel.name,
      personEmail: personnel.email,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .innerJoin(personnel, eq(apiKeys.personnelId, personnel.id))
    .orderBy(desc(apiKeys.createdAt));
}

/**
 * Makes a key for an outside tool. The tool gets its own personnel row (made here if the email is
 * new) with no roles, so it can't open any page; the key only works on /api/external routes.
 *
 * Input: the tool's name and email, and who is making the key. Output: the key's id and the key
 * itself, which is never stored and can't be shown again.
 */
export async function createApiKey(input: { name: string; email: string }, actorId: string | null): Promise<{ id: string; key: string }> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email.includes("@")) throw new ApiKeyError("Give the key a name and an email");

  const key = `${KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString("base64url")}`;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(personnel).where(sql`lower(${personnel.email}) = ${email}`).limit(1);
    if (existing && existing.status !== "Active") throw new ApiKeyError(`${existing.name} isn't Active`);
    const person =
      existing ??
      (
        await tx
          .insert(personnel)
          .values({ name, email, roles: [], notes: "Outside tool that adds Team Tasks with an API key. Has no page access." })
          .returning()
      )[0];
    const [row] = await tx
      .insert(apiKeys)
      .values({ name, personnelId: person.id, keyHash: hashKey(key), keyPrefix: key.slice(0, SHOWN_PREFIX_CHARS), createdBy: actorId })
      .returning({ id: apiKeys.id });
    await tx.insert(auditLog).values({ action: "createApiKey", entityType: API_KEY_ENTITY, entityId: row.id, actorId, payload: { name, personnelId: person.id } });
    return { id: row.id, key };
  });
}

/** Stops a key working. Input: the key's id and who revoked it. Output: nothing; throws ApiKeyError for an unknown key. */
export async function revokeApiKey(keyId: string, actorId: string | null): Promise<void> {
  const [row] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  if (!row) throw new ApiKeyError("No such key, or it was already revoked");
  await db.insert(auditLog).values({ action: "revokeApiKey", entityType: API_KEY_ENTITY, entityId: keyId, actorId, payload: {} });
}

/**
 * Who a request's key belongs to, from its "Authorization: Bearer <key>" header.
 *
 * Input: the request. Output: the key's person and name, or null for a missing, wrong or revoked
 * key, or a person who is no longer Active.
 */
export async function authenticateApiKey(request: Request): Promise<{ keyId: string; personnelId: string; name: string } | null> {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!key.startsWith(KEY_PREFIX)) return null;
  const [row] = await db
    .select({ keyId: apiKeys.id, personnelId: apiKeys.personnelId, name: personnel.name, status: personnel.status })
    .from(apiKeys)
    .innerJoin(personnel, eq(apiKeys.personnelId, personnel.id))
    .where(and(eq(apiKeys.keyHash, hashKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row || row.status !== "Active") return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.keyId));
  return { keyId: row.keyId, personnelId: row.personnelId, name: row.name };
}
