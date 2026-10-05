import { NextResponse } from "next/server";
import type { AuthedUser } from "@/lib/auth/authed-user";
import { SignoffError, type SignoffActor } from "@/lib/signoff/signoff-service";

/** The signed-in person as the sign-off service takes them. */
export function signoffActor(user: AuthedUser): SignoffActor {
  return { personnelId: user.personnelId ?? null, roles: user.roles, caps: user.caps };
}

/** A SignoffError as its response; anything else is rethrown so it shows as a server error. */
export function signoffErrorResponse(error: unknown): NextResponse {
  if (error instanceof SignoffError) return NextResponse.json({ error: error.message }, { status: error.httpStatus });
  throw error;
}
