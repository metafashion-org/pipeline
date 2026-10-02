import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { ApiKeyError, createApiKey, listApiKeys } from "@/lib/api-keys/api-key-service";

export const dynamic = "force-dynamic";

const NewKeySchema = z.object({ name: z.string().trim().min(1).max(100), email: z.email() });

/** The API keys outside tools use, without the keys themselves. Admins only. */
export async function GET() {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ keys: await listApiKeys() });
}

/** Makes a key. The response holds the key once; it isn't stored and can't be shown again. */
export async function POST(request: Request) {
  const user = await getAuthedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = NewKeySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the key a name and an email" }, { status: 400 });
  try {
    return NextResponse.json(await createApiKey(parsed.data, user.personnelId ?? null));
  } catch (error) {
    if (error instanceof ApiKeyError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
