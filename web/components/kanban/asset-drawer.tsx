"use client";

import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { KanbanAssetCard } from "@/lib/kanban/kanban-service";
import { parseDriveRefs, DriveRef } from "@/lib/assets/drive-links";
import { DriveImage } from "./drive-image";
import { getEffectiveCapabilities } from "@/lib/auth/rbac";
import { AssignTaskDialog } from "./AssignTaskDialog";
import { EditAssetDialog } from "./EditAssetDialog";
import { AssetHistory } from "./AssetHistory";
import { LinkedArtifacts } from "./LinkedArtifacts";
import { SubmitFinalFilesDialog, NotifyUploaderButton } from "./FinalFilesActions";
import { ExternalLink, Mail, DollarSign, Image as ImageIcon, Calendar, Tag, ShieldCheck, History, UploadCloud } from "lucide-react";
import { formatDate } from "@/lib/format-date";

export interface AssetDrawerProps {
  asset: KanbanAssetCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRoles?: string[];
}

/**
 * One Drive reference, shown as a thumbnail linking out to the file.
 * Folders, non-Drive links, and files no source can fetch degrade to an "Open in Drive" tile so a reference is never silently dropped.
 */
// Constant, so it is built once at module scope rather than rebuilt for every thumbnail on every render.
const OPEN_IN_DRIVE = (
  <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-center text-[10px] text-muted-foreground">
    <ExternalLink className="h-3.5 w-3.5" />
    Open in Drive
  </span>
);

function DriveThumbnail({ driveRef }: { driveRef: DriveRef }) {
  return (
    <a
      href={driveRef.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block h-24 w-24 shrink-0 overflow-hidden rounded-md border bg-muted"
      title={driveRef.url}
    >
      {driveRef.fileId ? (
        <DriveImage
          fileId={driveRef.fileId}
          alt="Reference"
          sizes="96px"
          className="object-cover transition-transform group-hover:scale-105"
          fallback={OPEN_IN_DRIVE}
        />
      ) : (
        OPEN_IN_DRIVE
      )}
    </a>
  );
}

function ReferenceGallery({ label, refs }: { label: string; refs: DriveRef[] }) {
  if (refs.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {refs.map((driveRef) => (
          <DriveThumbnail key={driveRef.url} driveRef={driveRef} />
        ))}
      </div>
    </div>
  );
}

export function AssetDrawer({ asset, open, onOpenChange, userRoles = ["admin"] }: AssetDrawerProps) {
  if (!asset) return null;

  const isAdminOrOperator = userRoles.includes("admin") || userRoles.includes("operator");
  const isCurator = userRoles.includes("curator") || isAdminOrOperator;
  const isPaymentAdmin = userRoles.includes("payment_admin") || isAdminOrOperator;
  // Client-side gates only, to decide what to show. Every endpoint these
  // buttons call re-checks the real permission server-side — for Submit
  // Final Files that also means checking the caller is actually the
  // assigned artist, which this component has no way to know (it only gets
  // a role list, not the viewer's personnelId), so it shows the button to
  // any artist and lets the route reject a non-assignee.
  const canAssignArtists = getEffectiveCapabilities(userRoles).canAssignArtists;
  const canNotifyUploader = getEffectiveCapabilities(userRoles).canAssignPublisher;
  const canSubmitFinalFiles = isAdminOrOperator || userRoles.includes("artist");
  // Editing an asset's name, category, budget or deadline is the same production-management right as assigning its artist, so it rides on the same capability rather than inventing a second one.
  const canEdit = canAssignArtists;

  const references = parseDriveRefs(asset.referenceImages);
  const recolorReferences = parseDriveRefs(asset.recolorReferenceImages);
  const hasReferences = references.length > 0 || recolorReferences.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-6 space-y-6">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="font-mono">{asset.sku}</Badge>
            <Badge variant="secondary" className="capitalize">{asset.currentStatus.replace(/_/g, " ")}</Badge>
          </div>
          <div className="mt-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-xl font-bold">{asset.itemName}</SheetTitle>
              {asset.category && <p className="text-xs text-muted-foreground">{asset.category}</p>}
            </div>
            {canEdit && <EditAssetDialog asset={asset} />}
          </div>
        </SheetHeader>

        {/* 1. Basic Details */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> 1. Basic Details
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm bg-muted/30 p-3 rounded-md">
            <div><span className="text-xs text-muted-foreground">SKU:</span> <p className="font-mono">{asset.sku}</p></div>
            <div><span className="text-xs text-muted-foreground">Category:</span> <p>{asset.category || "N/A"}</p></div>
            <div><span className="text-xs text-muted-foreground">Status:</span> <p className="capitalize">{asset.currentStatus}</p></div>
            <div><span className="text-xs text-muted-foreground">Deadline:</span> <p>{formatDate(asset.deadline, "Not set")}</p></div>
            <div><span className="text-xs text-muted-foreground">Updated:</span> <p>{formatDate(asset.updatedAt)}</p></div>
          </div>
        </section>

        {/* 2. Artist Assignment */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> 2. Artist Assignment
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-sm space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0">
                <p><span className="text-xs text-muted-foreground">Assigned Artist:</span> {asset.artistName || "Unassigned"}</p>
                {asset.artistEmail && <p className="truncate"><span className="text-xs text-muted-foreground">Email:</span> {asset.artistEmail}</p>}
              </div>
              {canAssignArtists && (
                <AssignTaskDialog
                  sku={asset.sku}
                  currentArtistId={asset.artistId}
                  currentArtistName={asset.artistName}
                />
              )}
            </div>
          </div>
        </section>

        {/* 3. References & Moodboards */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ImageIcon className="h-3.5 w-3.5" /> 3. References & Moodboards
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-sm space-y-3">
            {hasReferences ? (
              <>
                <ReferenceGallery label="Reference images" refs={references} />
                {isCurator && (
                  <ReferenceGallery label="Recolour references" refs={recolorReferences} />
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground italic">No reference links on this asset yet.</p>
            )}
          </div>
        </section>

        <LinkedArtifacts sku={asset.sku} enabled={open} />

        {/* 4. Technical Specs & Mannequin Rig */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> 4. Technical Specs & Rigs
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-sm">
            <p className="text-xs text-muted-foreground">Target Roblox R15 Mannequin Rig Specs</p>
          </div>
        </section>

        {/* 5. Financials & Budget (Gated) */}
        {isPaymentAdmin && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> 5. Financials & Budget
            </h4>
            <div className="bg-muted/30 p-3 rounded-md text-sm">
              <p><span className="text-xs text-muted-foreground">Budget/Fee:</span> {asset.feeAmount ? `$${asset.feeAmount}` : "Not set"}</p>
            </div>
          </section>
        )}

        {/* 6. Final Files & Delivery */}
        {(canSubmitFinalFiles || canNotifyUploader) &&
          (asset.currentStatus === "approved" || asset.currentStatus === "final_files_received") && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <UploadCloud className="h-3.5 w-3.5" /> 6. Final Files & Delivery
              </h4>
              <div className="bg-muted/30 p-3 rounded-md text-sm flex items-center justify-between gap-2 flex-wrap">
                {canSubmitFinalFiles && asset.currentStatus === "approved" && (
                  <>
                    <p className="text-xs text-muted-foreground">Approved — ready for the artist&apos;s final files.</p>
                    <SubmitFinalFilesDialog sku={asset.sku} />
                  </>
                )}
                {canNotifyUploader && asset.currentStatus === "final_files_received" && (
                  <>
                    <p className="text-xs text-muted-foreground">Final files received — notify the uploader when ready.</p>
                    <NotifyUploaderButton sku={asset.sku} />
                  </>
                )}
              </div>
            </section>
          )}

        {/* 8. Gmail Thread & Communications */}
        {asset.gmailThreadId && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> 8. Gmail Thread
            </h4>
            <div className="bg-muted/30 p-3 rounded-md text-sm flex items-center justify-between">
              <span className="font-mono text-xs truncate max-w-[250px]">{asset.gmailThreadId}</span>
              <a
                href={`https://mail.google.com/mail/u/0/#inbox/${asset.gmailThreadId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
              >
                Open Thread <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </section>
        )}

        {/* 11. Status History & Audit Trail */}
        <section className="space-y-2 border-t pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> 11. Status History & Audit Log
          </h4>
          <div className="bg-muted/30 p-3 rounded-md">
            <AssetHistory sku={asset.sku} enabled={open} />
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
