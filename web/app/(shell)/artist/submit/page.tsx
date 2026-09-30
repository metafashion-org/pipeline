import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { personnel } from "@/lib/db/schema/personnel";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { parseDriveRefs } from "@/lib/assets/drive-links";
import { FINAL_FILES_ACCEPTED_FROM_STATUS } from "@/lib/deliverables/deliverables-service";
import { getZipGuidance } from "@/lib/deliverables/zip-guidance";
import { FinalFilesForm, type SubmittableAsset } from "@/components/deliverables/FinalFilesForm";
import { PageHeader } from "@/components/layout/PageHeader";

export const dynamic = "force-dynamic";

/**
 * Submit final files: the in-app replacement for the "3D Art Submission Form" Google Form. An artist
 * picks one of their own Approved assets; the team (anyone who can assign artists) can hand in any
 * Approved asset on the artist's behalf. The same people the final-files API accepts
 * (lib/deliverables/final-files-access.ts).
 */
export default async function SubmitFinalFilesPage({ searchParams }: { searchParams: Promise<{ sku?: string }> }) {
  const session = await getServerSession(authOptions);
  const roles = session?.user?.roles || [];
  const caps = getEffectiveCapabilities(roles, session?.user?.capabilityOverrides || {});
  const isArtist = roles.some((r) => r.toLowerCase() === "artist");
  if (!session || !(isArtist || caps.canAssignArtists)) {
    redirect("/unauthorized");
  }
  const forTeam = caps.canAssignArtists;
  const personnelId = session.user.personnelId;

  // Only an Approved asset takes final files. An artist sees only their own; with no personnel
  // record they have none.
  const rows =
    forTeam || personnelId
      ? await db
          .select({
            id: assets.id,
            sku: assets.sku,
            itemName: assets.itemName,
            category: assets.category,
            referenceImages: assets.referenceImages,
            recolorReferenceImages: assets.recolorReferenceImages,
            artistName: personnel.name,
          })
          .from(assets)
          .leftJoin(personnel, eq(assets.currentArtistId, personnel.id))
          .where(
            and(
              eq(assets.currentStatus, FINAL_FILES_ACCEPTED_FROM_STATUS),
              forTeam ? undefined : eq(assets.currentArtistId, personnelId as string)
            )
          )
          .orderBy(asc(assets.sku))
      : [];

  const guidance = await getZipGuidance(rows);
  const submittable: SubmittableAsset[] = rows.map((row) => ({
    sku: row.sku,
    itemName: row.itemName,
    category: row.category,
    artistName: row.artistName,
    coverFileId: parseDriveRefs(row.referenceImages).find((ref) => ref.fileId)?.fileId ?? null,
    guidance: guidance.get(row.id) ?? { recolourCount: 0, briefNotes: [], guidelines: [] },
  }));

  const { sku } = await searchParams;

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader
        title="Submit final files"
        description="Hand in an approved asset as one .zip. It goes to the team Drive and the asset moves to Ready for Upload."
      />
      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <FinalFilesForm assets={submittable} initialSku={sku ?? null} submitterEmail={session.user.email ?? null} forTeam={forTeam} />
      </main>
    </div>
  );
}
