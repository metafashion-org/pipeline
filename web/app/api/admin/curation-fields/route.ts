import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getCurationFieldConfigs, updateCurationFieldConfig } from "@/lib/curation/curation-service";
import { z } from "zod";

const UpdateCurationFieldSchema = z.object({
  fieldKey: z.string().min(1),
  includeInArtistEmail: z.boolean(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await getCurationFieldConfigs();
  return NextResponse.json({ fields: rows });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = UpdateCurationFieldSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  try {
    const row = await updateCurationFieldConfig(parseResult.data.fieldKey, {
      includeInArtistEmail: parseResult.data.includeInArtistEmail,
    });
    return NextResponse.json({ success: true, field: row });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update field" },
      { status: 400 }
    );
  }
}
