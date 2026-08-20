import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { formSubmissions } from "@/lib/db/schema/form_submissions";
import { z } from "zod";

const SubmitSchema = z.object({
  values: z.record(z.string(), z.unknown()),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ formId: string }> }
) {
  const [session, { formId }] = await Promise.all([getServerSession(authOptions), params]);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = SubmitSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const [submission] = await db
    .insert(formSubmissions)
    .values({
      formDefinitionId: formId,
      submitterEmail: session.user.email?.toLowerCase() || null,
      submitterId: session.user.personnelId || null,
      values: parseResult.data.values,
      status: "pending",
    })
    .returning();

  return NextResponse.json({ success: true, submission });
}
