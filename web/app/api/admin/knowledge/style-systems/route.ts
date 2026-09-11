import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { listStyleSystems, createStyleSystem } from "@/lib/knowledge/style-systems-service";


export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const styleSystems = await listStyleSystems();
  return NextResponse.json({ styleSystems });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const styleSystem = await createStyleSystem(body.name, body.description);
    return NextResponse.json({ styleSystem });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create style system" }, { status: 400 });
  }
}
