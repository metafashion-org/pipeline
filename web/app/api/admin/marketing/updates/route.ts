import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { addMarketingUpdate, INITIAL_MARKETING_STATUSES } from "@/lib/marketing/marketing-service";
import { z } from "zod";

const MARKETING_STATUS_KEYS = INITIAL_MARKETING_STATUSES.map((s) => s.statusKey);

const CreateMarketingUpdateSchema = z.object({
  sku: z.string().min(1),
  platform: z.string().min(1),
  postUrl: z.url().optional().or(z.literal("")),
  caption: z.string().optional(),
  notes: z.string().optional(),
  postedAt: z
    .string()
    .optional()
    .refine((v) => !v || !isNaN(Date.parse(v)), { message: "Invalid posted date" }),
  marketingStatus: z
    .string()
    .refine((v) => MARKETING_STATUS_KEYS.includes(v), { message: "Invalid marketing status" })
    .optional(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user?.role !== "admin" && session.user?.role !== "marketing")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parseResult = CreateMarketingUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { sku, platform, postUrl, caption, notes, postedAt, marketingStatus } = parseResult.data;

  try {
    const update = await addMarketingUpdate({
      sku,
      platform,
      postUrl: postUrl || undefined,
      caption: caption || undefined,
      notes: notes || undefined,
      postedAt: postedAt ? new Date(postedAt) : undefined,
      // Explicit status wins; otherwise default by whether a link was given -
      // a link means it's already live, no link yet means creative work is still in progress.
      marketingStatus: marketingStatus || (postUrl ? "posted" : "creative_in_progress"),
      responsiblePersonId: session.user.personnelId,
    });
    return NextResponse.json({ success: true, update });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add marketing update" },
      { status: 400 }
    );
  }
}
