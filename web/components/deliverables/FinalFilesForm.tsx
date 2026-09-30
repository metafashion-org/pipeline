"use client";

import { useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CheckCircle2, ImageIcon, FileArchive, Clapperboard, MessageSquareText, X, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DriveImage } from "@/components/kanban/drive-image";
import { apiCall } from "@/lib/api-client";
import {
  FINAL_FILE_KINDS,
  FINAL_FILE_RULES,
  checkFinalFile,
  checkSubmission,
  formatMegabytes,
  type FinalFileKind,
} from "@/lib/deliverables/final-file-kinds";
import { formatFileSize, uploadToDrive } from "./drive-upload-client";

/** An asset waiting for its final files, as the page lists it. */
export interface SubmittableAsset {
  sku: string;
  itemName: string;
  category: string | null;
  artistName: string | null;
  /** The Drive file id of its first reference image, for the thumbnail, or null. */
  coverFileId: string | null;
}

interface PickedFile {
  kind: FinalFileKind;
  file: File;
  /** 0 to 1 while uploading; 1 once Drive has it. */
  progress: number;
  failed: boolean;
}

// What each slot tells the artist, taken from the Google Form this page replaces.
const SLOT_GUIDANCE: Record<FinalFileKind, { icon: ReactNode; optional: boolean; points: string[] }> = {
  images: {
    icon: <ImageIcon className="h-4 w-4" />,
    optional: false,
    points: [
      "Individual images of the asset, plus the asset on the mannequin.",
      "Square, on a white background, high resolution. Isometric views are preferred.",
      "Use the right mannequin for the asset type.",
    ],
  },
  model_zip: {
    icon: <FileArchive className="h-4 w-4" />,
    optional: false,
    points: [
      "One .zip file (not .rar) with the FBX file and the texture maps.",
      "For each variant: Base Color, Roughness, Metallic and Normal maps, numbered to match (BaseColor_6 goes with Roughness_6, Metallic_6 and Normal_6).",
      "Most sets share one Roughness, Metallic and Normal map. Number separate ones only when their values differ.",
      "2D views go in their own folder inside the .zip. All textures as JPEG.",
    ],
  },
  motion_pack: {
    icon: <Clapperboard className="h-4 w-4" />,
    optional: true,
    points: ["Only for assets with a motion pack. One .zip file (not .rar)."],
  },
};

function FileSlot({
  kind,
  files,
  busy,
  onAdd,
  onRemove,
}: {
  kind: FinalFileKind;
  files: PickedFile[];
  busy: boolean;
  onAdd: (kind: FinalFileKind, files: File[]) => void;
  onRemove: (name: string) => void;
}) {
  const rule = FINAL_FILE_RULES[kind];
  const guidance = SLOT_GUIDANCE[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const full = files.length >= rule.maxFiles;

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {guidance.icon}
            {rule.label}
            {guidance.optional && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}
          </h3>
          <p className="text-xs text-muted-foreground">
            {rule.maxFiles === 1 ? "One file" : `Up to ${rule.maxFiles} files`}, {rule.extensions.join(" / ")}, up to{" "}
            {formatMegabytes(rule.maxBytes)} each.
          </p>
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {files.length}/{rule.maxFiles}
        </span>
      </div>
      <ul className="list-disc pl-5 space-y-0.5 text-xs text-muted-foreground">
        {guidance.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>

      <input
        ref={inputRef}
        id={`final-files-${kind}`}
        type="file"
        accept={rule.accept}
        multiple={rule.maxFiles > 1}
        className="hidden"
        onChange={(e) => {
          onAdd(kind, Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {!full && (
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
            if (!busy) onAdd(kind, Array.from(e.dataTransfer.files));
          }}
          className={`w-full rounded-md border-2 border-dashed p-4 text-sm text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isDraggedOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
          }`}
        >
          <UploadCloud className="mx-auto mb-1 h-5 w-5" />
          Drop {rule.maxFiles === 1 ? "the file" : "files"} here, or click to choose
        </button>
      )}

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(({ file, progress, failed }) => (
            <li key={file.name} className="text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate">{file.name}</span>
                <span className="flex items-center gap-2 shrink-0 text-muted-foreground">
                  {formatFileSize(file.size)}
                  {!busy && (
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.name)} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </div>
              <div className="h-1 rounded bg-muted overflow-hidden">
                <div className={`h-full ${failed ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.round((failed ? 1 : progress) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The Submit final files form, the in-app replacement for the "3D Art Submission Form" Google Form.
 * The artist picks one of their Approved assets (the team can pick any), adds the asset images, the
 * 3D files .zip and an optional motion pack, and writes their comments. Files go from the browser
 * straight into the team Drive under "<SKU>/Final Files/v<N>/", and handing them in records every
 * file and moves the asset to Ready for Upload.
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
  /** True for the team handing in on an artist's behalf: the list shows each asset's artist. */
  forTeam: boolean;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [sku, setSku] = useState(() => (initialSku && assets.some((a) => a.sku === initialSku) ? initialSku : ""));
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [handedIn, setHandedIn] = useState<string | null>(null);

  const asset = assets.find((a) => a.sku === sku) ?? null;
  const problem = checkSubmission(picked);
  const requestedSkuMissing = Boolean(initialSku) && !assets.some((a) => a.sku === initialSku) && !handedIn;

  function addFiles(kind: FinalFileKind, files: File[]) {
    const rule = FINAL_FILE_RULES[kind];
    setPicked((current) => {
      const next = [...current];
      for (const file of files) {
        const rejection = checkFinalFile(kind, file.name, file.size);
        if (rejection) {
          toast.error(rejection);
          continue;
        }
        // Files are matched by name when they're handed in, so a name can only be used once.
        if (next.some((p) => p.file.name === file.name)) {
          toast.error(`${file.name} is already added.`);
          continue;
        }
        if (next.filter((p) => p.kind === kind).length >= rule.maxFiles) {
          toast.error(`${rule.label} takes ${rule.maxFiles === 1 ? "one file" : `up to ${rule.maxFiles} files`}.`);
          break;
        }
        next.push({ kind, file, progress: 0, failed: false });
      }
      return next;
    });
  }

  function setProgress(name: string, patch: Partial<PickedFile>) {
    setPicked((current) => current.map((p) => (p.file.name === name ? { ...p, ...patch } : p)));
  }

  async function handIn() {
    if (!asset || problem) return;
    setBusy(true);
    const skuPath = encodeURIComponent(asset.sku);
    try {
      let version: number | null = null;
      for (const { kind, file } of picked) {
        setProgress(file.name, { progress: 0, failed: false });
        const session = await apiCall<{ uploadUrl: string; version: number }>(`/api/assets/${skuPath}/final-files/session`, {
          method: "POST",
          body: { kind, fileName: file.name, mimeType: file.type || undefined, sizeBytes: file.size },
        });
        if (!session.ok) {
          setProgress(file.name, { failed: true });
          toast.error(session.data.error || `Couldn't start uploading ${file.name}`);
          return;
        }
        version = session.data.version;
        try {
          await uploadToDrive(session.data.uploadUrl, file, (fraction) => setProgress(file.name, { progress: fraction }));
          setProgress(file.name, { progress: 1 });
        } catch (error) {
          setProgress(file.name, { failed: true });
          toast.error(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
          return;
        }
      }

      const { ok, data } = await apiCall(`/api/assets/${skuPath}/final-files`, {
        method: "POST",
        body: {
          version,
          files: picked.map((p) => ({ name: p.file.name, kind: p.kind })),
          comments: comments.trim() || undefined,
        },
      });
      if (!ok) {
        toast.error(data.error || "Couldn't hand in the files");
        return;
      }
      toast.success(`${asset.sku} handed in. It's now Ready for Upload.`);
      setHandedIn(asset.sku);
      setSku("");
      setPicked([]);
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
            <strong className="font-mono">{handedIn}</strong> is handed in and in the uploader&apos;s queue. The files are in the team Drive
            under {handedIn}/Final Files.
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
        {assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is waiting for final files. An asset shows up here once the team approves its design
            {forTeam ? "." : " and it's assigned to you."}{" "}
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
                {assets.map((a) => (
                  <SelectItem key={a.sku} value={a.sku}>
                    {a.sku} · {a.itemName}
                    {forTeam && a.artistName ? ` · ${a.artistName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          {FINAL_FILE_KINDS.map((kind) => (
            <FileSlot
              key={kind}
              kind={kind}
              files={picked.filter((p) => p.kind === kind)}
              busy={busy}
              onAdd={addFiles}
              onRemove={(name) => setPicked((current) => current.filter((p) => p.file.name !== name))}
            />
          ))}

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

          <div className="flex items-center justify-end gap-3">
            {problem && picked.length > 0 && <p className="text-xs text-muted-foreground">{problem}</p>}
            <Button onClick={handIn} disabled={busy || problem !== null}>
              {busy ? "Uploading..." : "Hand in final files"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
