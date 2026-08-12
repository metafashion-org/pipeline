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

export async function getActivePersonnelByEmail(email: string): Promise<PersonnelAuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { isAllowed: false, roles: [] };
  }

  try {
    const records = await db
      .select()
      .from(personnel)
      .where(eq(personnel.email, normalizedEmail))
      .limit(1);

    if (records.length === 0) {
      return { isAllowed: false, roles: [] };
    }

    const p = records[0];

    // Access strictly gated on personnel.status === 'Active'
    if (p.status !== "Active") {
      return {
        isAllowed: false,
        personnelId: p.id,
        roles: p.roles || [],
        status: p.status,
        capabilityOverrides: (p.capabilityOverrides as Record<string, boolean>) || {},
      };
    }

    return {
      isAllowed: true,
      personnelId: p.id,
      roles: p.roles || [],
      status: p.status,
      capabilityOverrides: (p.capabilityOverrides as Record<string, boolean>) || {},
    };
  } catch (error) {
    console.error("Error checking personnel auth by email:", error);
    // Fail safe: deny access on DB lookup error
    return { isAllowed: false, roles: [] };
  }
}
