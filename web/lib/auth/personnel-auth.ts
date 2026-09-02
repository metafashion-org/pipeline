import { db } from "@/lib/db/client";
import { personnel } from "@/lib/db/schema/personnel";
import { eq } from "drizzle-orm";

export interface PersonnelAuthResult {
  isAllowed: boolean;
  personnelId?: string;
  roles: string[];
  status?: string;
  capabilityOverrides?: Record<string, boolean>;
}

/**
 * How long a personnel lookup is reused before being re-read from the database.
 *
 * NextAuth's jwt callback runs on every request that reads the session, so before this cache each page navigation and API call paid a full database round trip (~300ms against the remote database) before any page-specific work began.
 * The cache lives in the server process rather than on the JWT because getServerSession() in a server component has no response to write an updated cookie to, so a token-based cache would never actually persist across navigations.
 *
 * The window is deliberately short. Revoking a departed freelancer's access is meant to take effect promptly, so this trades at most this much staleness on an access change, not a session-long one.
 */
const PERSONNEL_CACHE_MS = 60_000;

const personnelCache = new Map<string, { result: PersonnelAuthResult; cachedAt: number }>();

// Misses are cached too, so a stream of sign-in attempts with distinct unknown addresses would
// otherwise grow this map for the life of the process. At the cap the oldest insertion is
// dropped, which for a Map is simply its first key.
const PERSONNEL_CACHE_MAX_ENTRIES = 5_000;

function rememberPersonnel(email: string, result: PersonnelAuthResult) {
  if (personnelCache.size >= PERSONNEL_CACHE_MAX_ENTRIES) {
    const oldest = personnelCache.keys().next().value;
    if (oldest !== undefined) personnelCache.delete(oldest);
  }
  personnelCache.set(email, { result, cachedAt: Date.now() });
}

/**
 * Drops an email from the auth cache so the next lookup re-reads the database.
 * Call after changing someone's roles or status so the change applies immediately rather than at the end of the cache window.
 */
export function invalidatePersonnelAuthCache(email?: string) {
  if (email) personnelCache.delete(email.trim().toLowerCase());
  else personnelCache.clear();
}

export async function getActivePersonnelByEmail(email: string): Promise<PersonnelAuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { isAllowed: false, roles: [] };
  }

  const cached = personnelCache.get(normalizedEmail);
  if (cached && Date.now() - cached.cachedAt < PERSONNEL_CACHE_MS) {
    return cached.result;
  }

  try {
    const records = await db
      .select()
      .from(personnel)
      .where(eq(personnel.email, normalizedEmail))
      .limit(1);

    if (records.length === 0) {
      const miss: PersonnelAuthResult = { isAllowed: false, roles: [] };
      rememberPersonnel(normalizedEmail, miss);
      return miss;
    }

    const p = records[0];

    // Access strictly gated on personnel.status === 'Active'
    const result: PersonnelAuthResult = {
      isAllowed: p.status === "Active",
      personnelId: p.id,
      roles: p.roles || [],
      status: p.status,
      capabilityOverrides: (p.capabilityOverrides as Record<string, boolean>) || {},
    };

    rememberPersonnel(normalizedEmail, result);
    return result;
  } catch (error) {
    console.error("Error checking personnel auth by email:", error);
    // Fail safe: deny access on DB lookup error
    return { isAllowed: false, roles: [] };
  }
}
