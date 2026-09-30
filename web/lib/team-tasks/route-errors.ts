import { NextResponse } from "next/server";
import { TeamTaskInputError, TeamTaskNotFoundError } from "./team-tasks-service";

/**
 * The response for a Team Tasks service error: 400 with the message for a bad request, 404 for a
 * missing task. Anything else is rethrown so it surfaces as a server error.
 *
 * Input: the caught error. Output: the response to send.
 */
export function teamTaskErrorResponse(error: unknown): NextResponse {
  if (error instanceof TeamTaskInputError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof TeamTaskNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  throw error;
}

/** The 403 every Team Tasks route answers someone without access with. */
export function teamTasksForbidden(): NextResponse {
  return NextResponse.json({ error: "Team Tasks is for the full-time team" }, { status: 403 });
}
