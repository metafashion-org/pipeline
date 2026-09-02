import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { addMarketingUpdate, INITIAL_MARKETING_STATUSES } from "@/lib/marketing/marketing-service";
import { z } from "zod";

const MARKETING_STATUS_KEYS = INITIAL_MARKETING_STATUSES.map((s) => s.statusKey);

const CreateMarketingUpdateSchema = z.object({
  sku: z.string().min(1),
  campaign: z.string().optional(),
  platform: z.string().min(1),
  // Post/channel type (e.g. Reel, Story, Carousel, Video) — the brief lists
  // this separately from platform. Was accepted by neither this schema nor
  // addMarketingUpdate itself before this round, despite the column
  // existing on marketing_updates.
  postType: z.string().optional(),
  postUrl: z.url().optional().or(z.literal("")),
  creative: z.string().optional(),
  caption: z.string().optional(),
  notes: z.string().optional(),
  nextAction: z.string().optional(),
  highPerforming: z.boolean().optional(),
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
  // Was `session.user.role !== "marketing"`, a condition that could never be true: the
  // session callback only ever produces "admin", "operator" or "artist", so a marketing-role
  // person arrived here as "artist" and was refused their own tool.
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canAccessMarketingTools) {
    return NextResponse.json({ error: "You don't have permission to post marketing updates" }, { status: 403 });
  }

  const body = await request.json();
  const parseResult = CreateMarketingUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json({ error: parseResult.error.message }, { status: 400 });
  }

  const { sku, campaign, platform, postType, postUrl, creative, caption, notes, nextAction, highPerforming, postedAt, marketingStatus } =
    parseResult.data;

  try {
    const update = await addMarketingUpdate({
      sku,
      campaign: campaign || undefined,
      platform,
      postType: postType || undefined,
      postUrl: postUrl || undefined,
      creative: creative || undefined,
      caption: caption || undefined,
      notes: notes || undefined,
      nextAction: nextAction || undefined,
      highPerforming,
      postedAt: postedAt ? new Date(postedAt) : undefined,
      // Explicit status wins; otherwise default by whether a link was given -
      // a link means it's already live and posted, no link yet means it's
      // at least been logged/planned (not planned at all would mean not
      // logging anything here in the first place).
      marketingStatus: marketingStatus || (postUrl ? "posted" : "planned"),
      responsiblePersonId: user.personnelId,
    });
    return NextResponse.json({ success: true, update });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add marketing update" },
      { status: 400 }
    );
  }
}
