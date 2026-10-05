"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CheckCircle2, FileArchive, ListChecks, MessageSquareText, X, UploadCloud, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DriveImage } from "@/components/kanban/drive-image";
import { apiCall } from "@/lib/api-client";
import { MAX_FINAL_ZIP_BYTES, checkFinalZip, formatMegabytes } from "@/lib/deliverables/final-zip";
import type { ZipGuidance } from "@/lib/deliverables/zip-guidance";
import { formatFileSize, uploadToDrive } from "./drive-upload-client";

/** An asset waiting for its final files, as the page lists it. */
export interface SubmittableAsset {
  sku: string;
  itemName: string;
  category: string | null;
  artistName: string | null;
  /** Assigned to the person viewing the page. Only these are listed until the team switches to handing in for another artist. */
  mine: boolean;
  /** The Drive file id of its first reference image, for the thumbnail, or null. */
  coverFileId: string | null;
  /** What its .zip needs beyond the standard checklist (lib/deliverables/zip-guidance.ts). */
  guidance: ZipGuidance;
}

function isUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text);
}

/**
 * What goes in the .zip for this asset: the standard checklist from the Google Form this page
 * replaces, one texture set per recolour, what the brief says about rig and specs, and the
 * guidelines linked to the asset or its category in the Registry (motion pack guidelines, say).
 */
function ZipChecklist({ asset }: { asset: SubmittableAsset }) {
  const { recolourCount, briefNotes, guidelines } = asset.guidance;
  const items = [
    `Images of the asset, and the asset on the ${asset.category ? `${asset.category} ` : ""}mannequin: square, white background, high resolution. Isometric views are preferred.`,
    "The FBX file.",
    "Texture maps for each variant: Base Color, Roughness, Metallic and Normal, numbered to match (BaseColor_6 goes with Roughness_6, Metallic_6 and Normal_6). Most sets share one Roughness, Metallic and Normal map; number separate ones only when their values differ. All textures as JPEG.",
    ...(recolourCount > 0
      ? [`This asset has ${recolourCount} recolour${recolourCount === 1 ? "" : "s"}: a texture set for each, numbered the same way.`]
      : []),
    "2D views, if you made them, in their own folder inside the .zip.",
    ...(briefNotes.length > 0 || guidelines.length > 0 ? ["Anything else the brief or guidelines below ask for, in the same .zip."] : []),
  ];

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
      <h3 className="flex items-center gap-2 font-semibold">
        <ListChecks className="h-4 w-4" /> What goes in the .zip
      </h3>
      <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      {briefNotes.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From the brief</p>
          <dl className="grid gap-1">
            {briefNotes.map((note) => (
              <div key={note.label} className="text-xs">
                <dt className="inline text-muted-foreground">{note.label}: </dt>
                <dd className="inline whitespace-pre-line">
                  {isUrl(note.value) ? (
                    <a href={note.value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                      {note.value}
                    </a>
                  ) : (
                    note.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {guidelines.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Guidelines for this asset</p>
          <ul className="space-y-0.5 text-xs">
            {guidelines.map((g) => (
              <li key={g.artifactId}>
                {g.url ? (
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                    {g.artifactId} · {g.title} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span>
                    {g.artifactId} · {g.title}
                  </span>
                )}
                <span className="text-muted-foreground"> ({g.type})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * The Submit final files form, the in-app replacement for the "3D Art Submission Form" Google Form.
 * The artist picks one of their Approved assets (the team can pick any), reads what goes in the
 * .zip for it, uploads one .zip with everything, and writes their comments. The .zip goes from the
 * browser straight into the team Drive under "<SKU>/Final Files/v<N>/", and handing it in records
 * it and moves the asset to Ready for Upload.
 */
export function FinalFilesForm({
  assets,
  initialSku,
  submitterEmail,
  forTeam,
}: {
  assets: SubmittableAsset[];
  initialSku: string | null;
  submitterEmail: string | null;
  /** True for the team, who may hand in on an artist's behalf through the "Hand in for another artist" switch. */
  forTeam: boolean;
}) {
  // An artist only ever sees their own assets. The team sees their own too, unless they switch to
  // handing in for another artist, or a link opened someone else's asset.
  const [forOthers, setForOthers] = useState(() => forTeam && Boolean(initialSku) && assets.some((a) => a.sku === initialSku && !a.mine));
  const listed = forOthers ? assets.filter((a) => !a.mine) : assets.filter((a) => a.mine);
  const othersCount = assets.filter((a) => !a.mine).length;
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sku, setSku] = useState(() => (initialSku && assets.some((a) => a.sku === initialSku) ? initialSku : ""));
  const [zip, setZip] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const [handedIn, setHandedIn] = useState<string | null>(null);

  const asset = listed.find((a) => a.sku === sku) ?? null;
  const requestedSkuMissing = Boolean(initialSku) && !assets.some((a) => a.sku === initialSku) && !handedIn;

  function pick(files: File[]) {
    if (files.length === 0) return;
    if (files.length > 1) toast.error("Put everything in one .zip and upload just that.");
    const file = files[0];
    const problem = checkFinalZip(file.name, file.size);
    if (problem) {
      toast.error(problem);
      return;
    }
    setZip(file);
    setProgress(0);
    setFailed(false);
  }

  async function handIn() {
    if (!asset || !zip) return;
    setBusy(true);
    setFailed(false);
    const skuPath = encodeURIComponent(asset.sku);
    try {
      const session = await apiCall<{ uploadUrl: string; version: number }>(`/api/assets/${skuPath}/final-files/session`, {
        method: "POST",
        body: { fileName: zip.name, mimeType: zip.type || undefined, sizeBytes: zip.size },
      });
      if (!session.ok) {
        setFailed(true);
        toast.error(session.data.error || `Couldn't start uploading ${zip.name}`);
        return;
      }
      try {
        await uploadToDrive(session.data.uploadUrl, zip, setProgress);
        setProgress(1);
      } catch (error) {
        setFailed(true);
        toast.error(`${zip.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        return;
      }

      const { ok, data } = await apiCall(`/api/assets/${skuPath}/final-files`, {
        method: "POST",
        body: { version: session.data.version, fileName: zip.name, comments: comments.trim() || undefined },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't hand in the files");
        return;
      }
      toast.success(`${asset.sku} handed in. It's now Ready for Upload.`);
      setHandedIn(asset.sku);
      setSku("");
      setZip(null);
      setProgress(0);
      setComments("");
      // The asset is no longer waiting for files, so the page's list and the board both change.
      router.refresh();
      await mutate("/api/assets");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {handedIn && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <p>
            <strong className="font-mono">{handedIn}</strong> is handed in and in the uploader&apos;s queue. The .zip is in the team Drive under{" "}
            {handedIn}/Final Files.
          </p>
        </div>
      )}
      {requestedSkuMissing && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {initialSku} isn&apos;t waiting for final files. An asset shows here once the team approves its design
          {forTeam ? "." : " and it's assigned to you."}
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="final-files-asset" className="text-sm font-semibold">
            Asset
          </Label>
          {submitterEmail && <span className="text-xs text-muted-foreground truncate">Submitting as {submitterEmail}</span>}
        </div>
        {forTeam && (
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={forOthers}
              disabled={busy}
              onCheckedChange={(on) => {
                setForOthers(on);
                setSku("");
              }}
            />
            Hand in for another artist
            <span className="text-xs text-muted-foreground">({othersCount} approved)</span>
          </label>
        )}
        {listed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {forOthers
              ? "No other artist's asset is waiting for final files."
              : "Nothing assigned to you is waiting for final files. An asset shows up here once the team approves its design."}{" "}
            {!forTeam && (
              <Link href="/artist" className="text-primary hover:underline">
                Back to My Tasks
              </Link>
            )}
          </p>
        ) : (
          <>
            <Select value={sku} onValueChange={setSku} disabled={busy}>
              <SelectTrigger id="final-files-asset" className="w-full">
                <SelectValue placeholder="Choose the SKU you're handing in" />
              </SelectTrigger>
              <SelectContent>
                {listed.map((a) => (
                  <SelectItem key={a.sku} value={a.sku}>
                    {a.sku} · {a.itemName}
                    {forOthers ? ` · ${a.artistName ?? "no artist"}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {asset && forOthers && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                You&apos;re handing this in for <strong>{asset.artistName ?? "an asset with no artist"}</strong>, not for yourself.
              </p>
            )}
            {asset && (
              <div className="flex items-center gap-3">
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {asset.coverFileId && <DriveImage fileId={asset.coverFileId} alt="" sizes="56px" className="object-cover" />}
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-medium truncate">{asset.itemName}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset.sku}
                    {asset.category ? ` · ${asset.category}` : ""}
                    {asset.artistName ? ` · ${asset.artistName}` : ""}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {asset && (
        <>
          <ZipChecklist asset={asset} />

          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileArchive className="h-4 w-4" /> The .zip
              </h3>
              <span className="text-xs text-muted-foreground">One .zip file (not .rar), up to {formatMegabytes(MAX_FINAL_ZIP_BYTES)}</span>
            </div>
            <input
              ref={inputRef}
              id="final-files-zip"
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                pick(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            {!zip ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggedOver(true);
                }}
                onDragLeave={() => setIsDraggedOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggedOver(false);
                  if (!busy) pick(Array.from(e.dataTransfer.files));
                }}
                className={`w-full rounded-md border-2 border-dashed p-6 text-sm text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isDraggedOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                }`}
              >
                <UploadCloud className="mx-auto mb-1 h-5 w-5" />
                Drop the .zip here, or click to choose
              </button>
            ) : (
              <div className="text-xs space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{zip.name}</span>
                  <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                    {formatFileSize(zip.size)}
                    {!busy && (
                      <button type="button" aria-label={`Remove ${zip.name}`} onClick={() => setZip(null)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </span>
                </div>
                <div className="h-1 rounded bg-muted overflow-hidden">
                  <div className={`h-full ${failed ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round((failed ? 1 : progress) * 100)}%` }} />
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 space-y-2">
            <Label htmlFor="final-files-comments" className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareText className="h-4 w-4" /> Your comments
            </Label>
            <Textarea
              id="final-files-comments"
              rows={3}
              value={comments}
              disabled={busy}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Issues you ran into, whether this is a resubmission, improvements, logo changes, proprietary patterns you removed"
            />
          </section>

          <div className="flex justify-end">
            <Button onClick={handIn} disabled={busy || !zip}>
              {busy ? "Uploading..." : "Hand in final files"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
