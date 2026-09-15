import { errorMessage } from "@/lib/errors";
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/authed-user";
import { uploadReferenceFile, isConfigured } from "@/lib/assets/drive-upload";

export const dynamic = "force-dynamic";

// Vercel's own serverless request-body limit (not something this route can raise) sits well
// under 10MB, so this is a friendlier, earlier error than letting the platform reject the
// request with a generic 413 first.
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Uploads one reference image straight into the team's Shared Drive (see lib/assets/drive-upload.ts)
 * and returns a link in the same shape a pasted Drive link already takes — the client appends it
 * to the reference-links textarea itself, nothing about assets.reference_images changes.
 *
 * Gated the same as creating/editing an asset (canAssignArtists) — uploading a reference is part
 * of the same production-management action, not a separate capability.
 */
export async function POST(request: NextRequest) {
  const user = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.caps.canAssignArtists) {
    return NextResponse.json({ error: "You don't have permission to upload reference files" }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json(
      { error: "Drive upload isn't set up yet on this deployment — paste a link instead for now." },
      { status: 503 }
    );
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  const sku = formData.get("sku");
  const file = formData.get("file");

  if (typeof sku !== "string" || !sku.trim()) {
    return NextResponse.json({ error: "Missing SKU — wait for it to finish generating and try again" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File is too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)}MB)` }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadReferenceFile(sku.trim(), file.name || "reference", file.type || "application/octet-stream", bytes);
    return NextResponse.json({ url: result.url });
  } catch (error: unknown) {
    console.error("Reference upload failed:", error);
    return NextResponse.json(
      { error: errorMessage(error, "Upload failed") },
      { status: 500 }
    );
  }
}
