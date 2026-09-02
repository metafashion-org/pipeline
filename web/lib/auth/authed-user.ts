import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getEffectiveCapabilities, type CapabilitySet } from "@/lib/auth/rbac";

// The single place an API route establishes who is calling it.
//
// Before this, every route called getServerSession() and checked only that a session existed. None of the 42 of them checked personnel.status, because proxy.ts checks it and that felt like enough — but proxy.ts's matcher covers page routes only ("/", "/login", "/admin/:path*", "/artist/:path*", "/curator/:path*", "/publisher/:path*"), never "/api". A blacklisted person's JWT stays valid and still carries their original roles, so every API route kept accepting them. That defeats setPersonnelStatus and invalidatePersonnelAuthCache, whose whole stated purpose is that revoking a departed freelancer's access takes effect promptly.
//
// Routes must branch on the returned capabilities rather than on session.user.role, which collapses the seven real roles into three ("admin", "operator", or "artist" for everything else) and so cannot express curator, publisher, marketing or payment_admin at all.

export interface AuthedUser {
  personnelId?: string;
  email: string;
  roles: string[];
  caps: CapabilitySet;
}

/**
 * Returns the caller if they have a session AND are still Active, otherwise null.
 *
 * Input: nothing — reads the request's session from Next's async context. Output: the caller's personnel id, email, roles and effective capabilities (role defaults unioned, then per-person overrides applied), or null when there is no session or the person is Inactive/Blacklisted.
 */
export async function getAuthedUser(): Promise<AuthedUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!session || !email) return null;

  // Anything other than Active is denied. A missing status means the token predates this field or the personnel row vanished; deny in both cases rather than falling open.
  if (session.user.status !== "Active") return null;

  const roles = session.user.roles || [];
  return {
    personnelId: session.user.personnelId,
    email,
    roles,
    caps: getEffectiveCapabilities(roles, session.user.capabilityOverrides || {}),
  };
}
