import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { canManageKnowledge, getEffectiveCapabilities } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { guidelines } from "@/lib/db/schema/guidelines";
import { asc } from "drizzle-orm";


// Minimal list/quick-create for the "Technical guideline libraries" link
// surface (brief §7's "attachable to" list) — the guidelines table existed
// with zero rows and zero routes anywhere; this is enough to actually have
// real guidelines to link artifacts to. A full guideline-authoring UI
// (editing contentMarkdown, browsing a library) is a separate, bigger
// piece of work, not attempted here.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const rows = await db.select().from(guidelines).orderBy(asc(guidelines.title));
  return NextResponse.json({ guidelines: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !canManageKnowledge(getEffectiveCapabilities(session.user.roles || [], session.user.capabilityOverrides || {}))) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const [row] = await db
    .insert(guidelines)
    .values({
      title,
      category: body.category?.trim() || null,
      guidelineType: body.guidelineType?.trim() || "general",
      contentMarkdown: body.contentMarkdown?.trim() || "",
    })
    .returning();

  return NextResponse.json({ guideline: row });
}
