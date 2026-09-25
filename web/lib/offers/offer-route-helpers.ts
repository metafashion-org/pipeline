import { NextResponse } from "next/server";
import { errorMessage } from "@/lib/errors";
import { OfferActionError } from "./offer-service";

/**
 * The response for an error thrown by an offer action: the refusal's own message and status for
 * an OfferActionError (wrong artist, wrong state, a date out of range), a 500 for anything else.
 */
export function offerErrorResponse(error: unknown, fallback: string) {
  if (error instanceof OfferActionError) {
    return NextResponse.json({ error: error.message }, { status: error.httpStatus });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: errorMessage(error, fallback) }, { status: 500 });
}
