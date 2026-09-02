"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";
import { toast } from "sonner";
import { Plus, ExternalLink, Link2 } from "lucide-react";
import { ArtifactLinksDialog } from "./ArtifactLinksDialog";

interface ArtifactType {
  id: string;
  prefix: string;
  label: string;
}

interface Artifact {
  id: string;
  artifactId: string;
  title: string;
  description: string | null;
  source: string | null;
  fileUrl: string | null;
  tags: string[] | null;
  usageNotes: string | null;
  createdAt: string;
  typeLabel: string;
  typePrefix: string;
}

const EMPTY_FORM = {
  artifactTypeId: "",
  title: "",
  description: "",
  source: "",
  fileUrl: "",
  tags: "",
  category: "",
  usageNotes: "",
};

/**
 * The Knowledge Registry — a list of every submitted artifact with its real,
 * permanent typed id (TR001, RK001, etc. — see lib/knowledge/artifact-id-service.ts),
 * plus the submission form that creates new ones.
 */
export function KnowledgeRegistry({
  initialArtifacts,
  artifactTypes,
}: {
  initialArtifacts: Artifact[];
  artifactTypes: ArtifactType[];
}) {
  const [artifacts, setArtifacts] = useState(initialArtifacts);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [linksArtifact, setLinksArtifact] = useState<Artifact | null>(null);
  const [linkCounts, setLinkCounts] = useState<Record<string, number>>({});

  const handleOpenChange = (next: boolean) => {
    if (!next) setForm(EMPTY_FORM);
    setOpen(next);
  };

  const handleSubmit = async () => {
    if (!form.artifactTypeId) {
      toast.error("Artifact type is required");
      return;
    }
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }

    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ artifact: Artifact }>("/api/admin/knowledge/artifacts", {
        method: "POST",
        body: {
          artifactTypeId: form.artifactTypeId,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          source: form.source.trim() || undefined,
          fileUrl: form.fileUrl.trim() || undefined,
          tags: form.tags.trim() ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          category: form.category.trim() || undefined,
          usageNotes: form.usageNotes.trim() || undefined,
        },
      });
      if (!ok) throw new Error(data.error || "Failed to create artifact");

      const type = artifactTypes.find((t) => t.id === form.artifactTypeId)!;
      setArtifacts((prev) => [
        ...prev,
        {
          id: data.artifact.id,
          artifactId: data.artifact.artifactId,
          title: data.artifact.title,
          description: data.artifact.description,
          source: data.artifact.source,
          fileUrl: data.artifact.fileUrl,
          tags: data.artifact.tags,
          usageNotes: data.artifact.usageNotes,
          createdAt: data.artifact.createdAt,
          typeLabel: type.label,
          typePrefix: type.prefix,
        },
      ]);
      toast.success(`Created ${data.artifact.artifactId}`);
      handleOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create artifact");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" /> New Artifact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Submit a Knowledge Artifact</DialogTitle>
              <DialogDescription>Gets a real, permanent ID (e.g. TR001) the moment you submit — citable and cross-referenceable from then on.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label htmlFor="artifact-type" className="text-xs text-muted-foreground mb-1 block">Type</label>
                <Select value={form.artifactTypeId} onValueChange={(v) => setForm({ ...form, artifactTypeId: v })}>
                  <SelectTrigger id="artifact-type">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {artifactTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label} ({t.prefix})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label htmlFor="artifact-title" className="text-xs text-muted-foreground mb-1 block">Title</label>
                <Input id="artifact-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Q3 streetwear color trends" />
              </div>
              <div>
                <label htmlFor="artifact-description" className="text-xs text-muted-foreground mb-1 block">Description</label>
                <Textarea id="artifact-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="artifact-source" className="text-xs text-muted-foreground mb-1 block">Source</label>
                  <Input id="artifact-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="Where this came from" />
                </div>
                <div>
                  <label htmlFor="artifact-file-url" className="text-xs text-muted-foreground mb-1 block">File / Link</label>
                  <Input id="artifact-file-url" value={form.fileUrl} onChange={(e) => setForm({ ...form, fileUrl: e.target.value })} placeholder="https://..." />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="artifact-tags" className="text-xs text-muted-foreground mb-1 block">Tags (comma-separated)</label>
                  <Input id="artifact-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="streetwear, y2k" />
                </div>
                <div>
                  <label htmlFor="artifact-category" className="text-xs text-muted-foreground mb-1 block">Category (links this artifact to it)</label>
                  <Input id="artifact-category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Outerwear" />
                </div>
              </div>
              <div>
                <label htmlFor="artifact-usage-notes" className="text-xs text-muted-foreground mb-1 block">Usage Notes</label>
                <Textarea id="artifact-usage-notes" value={form.usageNotes} onChange={(e) => setForm({ ...form, usageNotes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={submitting}>{submitting ? "Submitting..." : "Submit"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-2 font-medium">ID</th>
                <th className="text-left px-4 py-2 font-medium">Type</th>
                <th className="text-left px-4 py-2 font-medium">Title</th>
                <th className="text-left px-4 py-2 font-medium">Tags</th>
                <th className="text-left px-4 py-2 font-medium">Added</th>
                <th className="text-left px-4 py-2 font-medium">File</th>
                <th className="text-left px-4 py-2 font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No artifacts yet. Submit the first one above.
                  </td>
                </tr>
              )}
              {artifacts.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{a.artifactId}</td>
                  <td className="px-4 py-2 text-muted-foreground">{a.typeLabel}</td>
                  <td className="px-4 py-2">{a.title}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(a.tags || []).map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-2">
                    {a.fileUrl && (
                      <a href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLinksArtifact(a)}>
                      <Link2 className="h-3 w-3" />
                      {linkCounts[a.id] !== undefined ? linkCounts[a.id] : "Manage"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {linksArtifact && (
        <ArtifactLinksDialog
          open={!!linksArtifact}
          onOpenChange={(v) => !v && setLinksArtifact(null)}
          artifactId={linksArtifact.id}
          artifactLabel={`${linksArtifact.artifactId} — ${linksArtifact.title}`}
          onLinksChanged={(count) => setLinkCounts((prev) => ({ ...prev, [linksArtifact.id]: count }))}
        />
      )}
    </div>
  );
}
