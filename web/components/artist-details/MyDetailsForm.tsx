"use client";

import { useState } from "react";
import useSWR from "swr";
import { Eye, EyeOff, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import {
  ARTIST_DOCUMENT_KINDS,
  ARTIST_FIELD_LABELS,
  maskNumber,
  type ArtistDetailsInput,
  type ArtistDocumentKind,
} from "@/lib/artist-details/details-rules";

interface StoredFile {
  id: string;
  kind: string;
  fileName: string;
  driveUrl: string | null;
}

interface DetailsResponse {
  details: ArtistDetailsInput;
  submittedAt: string | null;
  importedFromFormAt: string | null;
  files: StoredFile[];
  pendingChange: { id: string; fields: string[]; reason: string; createdAt: string } | null;
}

const API = "/api/artist/details";

// The text fields in the order they're shown, and which ones hold numbers that stay hidden until Show is pressed.
const TEXT_FIELDS: { key: keyof ArtistDetailsInput; placeholder: string; secret?: boolean }[] = [
  { key: "mobile", placeholder: "98765 43210" },
  { key: "upiId", placeholder: "name@okbank", secret: true },
  { key: "accountHolderName", placeholder: "As written on your passbook" },
  { key: "bankAccountNumber", placeholder: "Account number", secret: true },
  { key: "ifsc", placeholder: "SBIN0001234" },
  { key: "bankName", placeholder: "State Bank of India" },
  { key: "panNumber", placeholder: "ABCDE1234F", secret: true },
];

/** Where a document opens. The route serves the app's own copy, or redirects to Drive when there isn't one. */
function fileHref(file: StoredFile): string {
  return `/api/artist/details/files/${file.id}`;
}

/**
 * My details: the artist's UPI, bank account, PAN and identity documents, filled in once. After the
 * first save the form is read-only, and any change is sent with a reason for Arjun or Jayesh to approve.
 */
export function MyDetailsForm() {
  const { data, error, isLoading, mutate } = useSWR<DetailsResponse>(API, jsonFetcher);
  const [draft, setDraft] = useState<ArtistDetailsInput | null>(null);
  const [extraFiles, setExtraFiles] = useState<StoredFile[]>([]);
  const [reason, setReason] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<ArtistDocumentKind | null>(null);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error || !data) return <p className="text-sm text-destructive">{error?.message ?? "Couldn't load your details"}</p>;

  const submitted = Boolean(data.submittedAt);
  const editing = draft !== null;
  const values = draft ?? data.details;
  const files = [...data.files, ...extraFiles];
  const fileById = (id: string | null) => (id ? files.find((f) => f.id === id) ?? null : null);

  function startEditing() {
    setDraft({ ...data!.details });
    setReason("");
  }

  function set(key: keyof ArtistDetailsInput, value: string) {
    setDraft((d) => ({ ...(d ?? data!.details), [key]: value || null }));
  }

  async function upload(kind: ArtistDocumentKind, column: keyof ArtistDetailsInput, file: File) {
    setUploading(kind);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("kind", kind);
      const res = await fetch(`${API}/files`, { method: "POST", body });
      const json = await res.json().catch(() => ({ error: "Upload failed" }));
      if (!res.ok) {
        toast.error(json.error || "Upload failed");
        return;
      }
      setExtraFiles((f) => [...f, json.file]);
      set(column, json.file.id);
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    const details = draft ?? data!.details;
    setSaving(true);
    try {
      const { ok, data: res } = submitted
        ? await apiCall(`${API}/change`, { method: "POST", body: { details, reason } })
        : await apiCall(API, { method: "POST", body: details });
      if (!ok) {
        toast.error(res.error || "Couldn't save");
        return;
      }
      toast.success(submitted ? "Change sent for approval. Your current details stay in use until then." : "Saved. Thank you.");
      setDraft(null);
      setExtraFiles([]);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      {data.pendingChange && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">Change waiting for approval</p>
          <p className="text-muted-foreground">
            {data.pendingChange.fields.join(", ")}. Reason: {data.pendingChange.reason}
          </p>
        </div>
      )}
      {!submitted && data.importedFromFormAt && (
        <div className="rounded-md border p-3 text-sm text-muted-foreground">
          We copied what you sent on the onboarding form. Check it, add your bank details, and save.
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Payment details</h2>
          <Button variant="ghost" size="sm" onClick={() => setShow((s) => !s)}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} {show ? "Hide" : "Show"}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {TEXT_FIELDS.map(({ key, placeholder, secret }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={key}>{ARTIST_FIELD_LABELS[key]}</Label>
              {editing || !submitted ? (
                <Input
                  id={key}
                  value={values[key] ?? ""}
                  placeholder={placeholder}
                  autoComplete="off"
                  // Hidden like a password until Show is pressed, so the numbers aren't readable over a shoulder.
                  type={secret && !show ? "password" : "text"}
                  onChange={(e) => set(key, e.target.value)}
                  onFocus={() => !editing && startEditing()}
                />
              ) : (
                <p id={key} className="h-9 flex items-center text-sm font-mono">
                  {(secret && !show ? maskNumber(values[key]) : values[key]) ?? "—"}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="space-y-1">
          <Label htmlFor="portfolioLinks">{ARTIST_FIELD_LABELS.portfolioLinks}</Label>
          {editing || !submitted ? (
            <Textarea id="portfolioLinks" rows={2} value={values.portfolioLinks ?? ""} onChange={(e) => set("portfolioLinks", e.target.value)} onFocus={() => !editing && startEditing()} />
          ) : (
            <p className="text-sm whitespace-pre-wrap break-all">{values.portfolioLinks ?? "—"}</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Documents</h2>
        <p className="text-xs text-muted-foreground">Kept in the company Drive, visible only to the team, and in the app.</p>
        {ARTIST_DOCUMENT_KINDS.map((doc) => {
          const current = fileById(values[doc.column]);
          return (
            <div key={doc.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
              <span className="flex-1 min-w-48">
                {doc.label}
                {doc.required ? "" : " (optional)"}
              </span>
              {current ? (
                <a href={fileHref(current)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary underline-offset-2 hover:underline max-w-56 truncate">
                  <FileText className="h-4 w-4 shrink-0" /> {current.fileName}
                </a>
              ) : (
                <span className="text-muted-foreground">Not added</span>
              )}
              {(editing || !submitted) && (
                <Button asChild variant="outline" size="sm" disabled={uploading !== null}>
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4" /> {uploading === doc.key ? "Uploading..." : current ? "Replace" : "Upload"}
                    <input
                      type="file"
                      className="hidden"
                      accept={doc.key === "nda" ? "application/pdf" : "image/*,application/pdf"}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) upload(doc.key, doc.column, file);
                      }}
                    />
                  </label>
                </Button>
              )}
            </div>
          );
        })}
        <div className="space-y-1">
          <Label htmlFor="ndaUrl">{ARTIST_FIELD_LABELS.ndaUrl}</Label>
          {editing || !submitted ? (
            <Input id="ndaUrl" value={values.ndaUrl ?? ""} placeholder="https://drive.google.com/..." onChange={(e) => set("ndaUrl", e.target.value)} onFocus={() => !editing && startEditing()} />
          ) : values.ndaUrl ? (
            <a href={values.ndaUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-primary break-all hover:underline">
              {values.ndaUrl}
            </a>
          ) : (
            <p className="text-sm">—</p>
          )}
          <p className="text-xs text-muted-foreground">A link to your signed NDA is enough. You can upload the signed PDF above as well.</p>
        </div>
      </section>

      {submitted && !editing ? (
        <Button variant="outline" onClick={startEditing} disabled={Boolean(data.pendingChange)}>
          {data.pendingChange ? "A change is waiting for approval" : "Request a change"}
        </Button>
      ) : (
        <section className="space-y-3">
          {submitted && (
            <div className="space-y-1">
              <Label htmlFor="reason">Why are these details changing?</Label>
              <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I moved my account to another bank" />
              <p className="text-xs text-muted-foreground">Arjun or Jayesh approves the change. Until then we pay you on your current details.</p>
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving || uploading !== null || (submitted && !reason.trim())}>
              {saving ? "Saving..." : submitted ? "Send for approval" : "Save my details"}
            </Button>
            {submitted && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            )}
          </div>
          {!submitted && <p className="text-xs text-muted-foreground">After you save, changes need a reason and our approval.</p>}
        </section>
      )}
    </div>
  );
}
