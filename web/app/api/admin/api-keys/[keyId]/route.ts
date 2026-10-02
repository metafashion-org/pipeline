import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { ApiKeyError, revokeApiKey } from "@/lib/api-keys/api-key-service";

export const dynamic = "force-dynamic";

/** Revokes a key. It stops working on the next request. Admins only. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ keyId: string }> }) {
  const [{ keyId }, user] = await Promise.all([params, getAuthedUser()]);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.caps.canManageSystemConfig) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!z.uuid().safeParse(keyId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await revokeApiKey(keyId, user.personnelId ?? null);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiKeyError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
