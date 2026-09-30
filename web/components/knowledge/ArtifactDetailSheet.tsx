"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { Archive, ExternalLink, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DriveThumbnail } from "@/components/kanban/drive-thumbnail";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { extractDriveFileId } from "@/lib/assets/drive-links";
import { formForPrefix, type ArtifactFile, type ArtifactFormField } from "@/lib/knowledge/artifact-forms";
import type { RegistryArtifactView } from "@/lib/dashboard/views";

interface ArtifactLinksResponse {
  links: {
    skus: { linkId: string; sku: string; itemName: string }[];
    categories: { linkId: string; category: string }[];
  };
}

// The column-backed fields every artifact may carry, for showing values an older artifact has on
// a field its type's form no longer asks for.
const LEGACY_FIELDS: ArtifactFormField[] = [
  { key: "description", column: "description", kind: "textarea", label: "Description" },
  { key: "source", column: "source", kind: "text", label: "Source" },
  { key: "fileUrl", column: "fileUrl", kind: "link", label: "Link" },
  { key: "usageNotes", column: "usageNotes", kind: "textarea", label: "Usage notes" },
  { key: "tags", column: "tags", kind: "tags", label: "Tags" },
];
const THUMBNAIL_PX = 72;

function fieldValue(artifact: RegistryArtifactView, field: ArtifactFormField): unknown {
  if (field.column === "details") return artifact.details?.[field.key];
  if (field.column === "category" || field.column === "trendArtifactId" || field.column === "title") return undefined;
  return artifact[field.column];
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-primary hover:underline">
      {children} <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

// A field's value, drawn by its kind.
function FieldValue({ field, value }: { field: ArtifactFormField; value: unknown }) {
  switch (field.kind) {
    case "link":
    case "recolorFolder":
      return <ExternalAnchor href={String(value)}>{String(value)}</ExternalAnchor>;
    case "date":
      return <span>{formatDate(String(value))}</span>;
    case "tags":
      return (
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </span>
      );
    case "files":
      return (
        <span className="grid gap-2">
          {(value as ArtifactFile[]).map((file, index) => (
            <span key={`${file.url}-${index}`} className="flex items-start gap-2">
              <DriveThumbnail driveRef={{ url: file.url, fileId: extractDriveFileId(file.url) }} size={THUMBNAIL_PX} />
              <span className="min-w-0 space-y-0.5">
                <ExternalAnchor href={file.url}>{file.name}</ExternalAnchor>
                {file.note && <span className="block text-xs text-muted-foreground">{file.note}</span>}
              </span>
            </span>
          ))}
        </span>
      );
    default:
      return <span className="whitespace-pre-wrap">{String(value)}</span>;
  }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * One Registry artifact in full: the fields its type's form asks for, what it came from and what
 * came from it, what it's linked to, and Archive.
 */
export function ArtifactDetailSheet({
  artifact,
  allArtifacts,
  onOpenChange,
  onManageLinks,
  onArchived,
  children,
}: {
  artifact: RegistryArtifactView | null;
  /** The whole Registry, to list the moodboards and kits that came from a trend. */
  allArtifacts: RegistryArtifactView[];
  onOpenChange: (open: boolean) => void;
  onManageLinks: (artifact: RegistryArtifactView) => void;
  onArchived: () => void;
  /** Extra sections from other features, e.g. the Team Tasks that link to this artifact. */
  children?: ReactNode;
}) {
  const [archiving, setArchiving] = useState(false);
  const { data: linksData } = useSWR<ArtifactLinksResponse>(
    artifact ? `/api/admin/knowledge/artifacts/${artifact.id}/links` : null,
    jsonFetcher
  );
  if (!artifact) return null;

  const form = formForPrefix(artifact.typePrefix);
  const formColumns = new Set(form.fields.map((f) => f.column));
  const shownFields = form.fields.filter((field) => hasValue(fieldValue(artifact, field)));
  const legacyFields = LEGACY_FIELDS.filter((field) => !formColumns.has(field.column) && hasValue(fieldValue(artifact, field)));
  const fromThisTrend = allArtifacts.filter((a) => a.trendArtifactId === artifact.id);
  const skus = linksData?.links.skus ?? [];
  const categories = linksData?.links.categories ?? [];

  async function archive() {
    if (!artifact) return;
    setArchiving(true);
    try {
      const { ok, data } = await apiCall(`/api/admin/knowledge/artifacts/${artifact.id}/archive`, { method: "POST" });
      if (!ok) {
        toast.error(data.error || "Couldn't archive it");
        return;
      }
      toast.success(`${artifact.artifactId} archived`);
      onArchived();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto p-6 space-y-5">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {artifact.artifactId}
            </Badge>
            <Badge variant="secondary">{artifact.typeLabel}</Badge>
          </div>
          <SheetTitle className="text-xl">{artifact.title}</SheetTitle>
          <SheetDescription>
            Added {formatDate(artifact.createdAt)}
            {artifact.addedByName ? ` by ${artifact.addedByName}` : ""}
          </SheetDescription>
        </SheetHeader>

        {shownFields.map((field) => (
          <Row key={field.key} label={field.label}>
            <FieldValue field={field} value={fieldValue(artifact, field)} />
          </Row>
        ))}

        {artifact.trendArtifactId && artifact.trendTitle && (
          <Row label="Trend it came from">
            {artifact.trendCode} · {artifact.trendTitle}
          </Row>
        )}

        {fromThisTrend.length > 0 && (
          <Row label="From this trend">
            <ul className="space-y-1">
              {fromThisTrend.map((a) => (
                <li key={a.id}>
                  <span className="font-mono text-xs">{a.artifactId}</span> {a.title}
                </li>
              ))}
            </ul>
          </Row>
        )}

        {legacyFields.map((field) => (
          <Row key={field.key} label={field.label}>
            <FieldValue field={field} value={fieldValue(artifact, field)} />
          </Row>
        ))}

        <Row label="Linked to">
          {skus.length === 0 && categories.length === 0 ? (
            <span className="text-muted-foreground">Nothing yet.</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {categories.map((c) => (
                <Badge key={c.linkId} variant="secondary">
                  {c.category}
                </Badge>
              ))}
              {skus.map((s) => (
                <Badge key={s.linkId} variant="outline" className="font-mono">
                  {s.sku}
                </Badge>
              ))}
            </span>
          )}
          <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => onManageLinks(artifact)}>
            <Link2 className="h-3 w-3" /> Manage links
          </Button>
        </Row>

        {children}

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <p className="text-xs text-muted-foreground">Archiving takes it out of the Registry. Its ID stays taken and nothing is deleted.</p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="shrink-0" disabled={archiving}>
                <Archive className="h-3.5 w-3.5" /> Archive
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Archive {artifact.artifactId}?</AlertDialogTitle>
                <AlertDialogDescription>
                  It leaves the Registry, the board&apos;s registry chips and the final-files checklist. The row and its links stay in the
                  database.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={archive}>Archive</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  );
}
