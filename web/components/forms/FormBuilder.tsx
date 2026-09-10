"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";
import { normalizeFieldOptions } from "@/lib/forms/field-options";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, ExternalLink, Pencil, Check, X } from "lucide-react";
import { FormPreview } from "./FormPreview";
import { SubmissionsTable } from "./SubmissionsTable";
import type { FormFieldSpec } from "./form-field-spec";

const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "url", "image", "file"] as const;
const ROLES = ["admin", "operator", "curator", "artist", "publisher", "marketing", "payment_admin"];

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Short answer",
  textarea: "Paragraph",
  select: "Choose one",
  multi_select: "Choose several",
  url: "Link",
  image: "Image link",
  file: "File link",
};

const BEHAVIORS = [
  { value: "record_only", label: "Just record it", help: "Stores the submission for someone to review. Nothing else happens." },
  {
    value: "trigger_personnel_onboarding",
    label: "Queue an access request",
    help: "Stores the submission as pending. An admin still has to approve it on the Personnel page before an account exists.",
  },
  {
    value: "trigger_artifact_creation",
    label: "Create a knowledge artifact",
    help: "Writes the artifact straight into the registry on submit. Only available on a form that is not public.",
  },
] as const;

const AUDIENCES = [
  { value: "public", label: "Anyone with the link", help: "No account needed. The form asks for an email address so someone can reply." },
  { value: "roles", label: "People with a role", help: "Whoever signs in carrying one of the roles below." },
  { value: "emails", label: "Specific email addresses", help: "Only the addresses below, and only when signed in as one of them." },
] as const;

interface FormSummary {
  id: string;
  key: string;
  title: string;
  description: string | null;
  audience: "public" | "roles" | "emails";
  targetRoles: string[];
  allowedEmails: string[];
  onSubmissionBehavior: string;
  isActive: boolean;
  fieldCount: number;
  submissionCount: number;
  createdByName: string | null;
  createdAt: string;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  section: string | null;
  helpText: string | null;
  placeholder: string | null;
  options: unknown;
}

interface SubmissionRow {
  id: string;
  submitterEmail: string | null;
  status: string;
  values: Record<string, unknown>;
  createdAt: string;
}

// SWR treats a thrown error as the error state; without this a 500 response would hand the
// component its error body as if it were data.
async function fetcher<T>(url: string): Promise<T> {
  const { ok, data } = await apiCall<T>(url);
  if (!ok) throw new Error(data.error || "Failed to load");
  return data as T;
}

// Throwing wrapper over the shared client, because every call site here is a try/catch.
async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const { ok, data } = await apiCall(url, { method, body });
  if (!ok) throw new Error(data.error || "Request failed");
  return data;
}

/** Turns a stored field row into the shape both the preview and the filler render. */
function toSpec(f: FieldRow): FormFieldSpec {
  return {
    fieldKey: f.fieldKey,
    label: f.label,
    fieldType: f.fieldType,
    isRequired: f.isRequired,
    options: normalizeFieldOptions(f.options),
    section: f.section,
    helpText: f.helpText,
    placeholder: f.placeholder,
  };
}

/**
 * The form builder.
 *
 * Two panes: what the form is made of on the left, what it looks like on the right. The preview
 * renders the same component the real form does, so it is the form rather than a picture of one.
 * Before this the only way to see a form was to open its link in another tab, and fields could be
 * added and deleted but never edited — a typo in a label meant deleting the field and rebuilding
 * it, which orphaned every answer already recorded under its key.
 */
export function FormBuilder() {
  const { data, mutate } = useSWR<{ forms: FormSummary[] }>("/api/admin/forms", fetcher);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const forms = data?.forms ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-lg">Forms</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> New
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {forms.length === 0 && <p className="text-muted-foreground">No forms yet.</p>}
          {forms.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={`w-full text-left rounded-md px-3 py-2.5 transition-colors ${
                selectedId === f.id ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{f.title}</span>
                {!f.isActive && <Badge variant="secondary">Off</Badge>}
              </div>
              <div className="text-sm text-muted-foreground mt-0.5">
                {f.fieldCount} field{f.fieldCount === 1 ? "" : "s"} · {f.submissionCount} response
                {f.submissionCount === 1 ? "" : "s"} · {AUDIENCES.find((a) => a.value === f.audience)?.label ?? f.audience}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {selectedId ? (
        <FormDetail formId={selectedId} onChanged={() => mutate()} />
      ) : (
        <Card className="h-fit">
          <CardContent className="py-12 text-center text-muted-foreground">
            Pick a form to edit it, or make a new one.
          </CardContent>
        </Card>
      )}

      <CreateFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          mutate();
          setSelectedId(id);
        }}
      />
    </div>
  );
}

function CreateFormDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // A key is what URLs and code address the form by, and it cannot be changed later, so it is
  // suggested from the title rather than left as a second thing to invent.
  function suggestKey(fromTitle: string) {
    return fromTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
  }

  async function submit() {
    setSaving(true);
    try {
      const data = await send("/api/admin/forms", "POST", { key: key || suggestKey(title), title, description });
      const form = data.form as { id: string };
      toast.success(`Created ${title}`);
      setKey("");
      setTitle("");
      setDescription("");
      onOpenChange(false);
      onCreated(form.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the form");
    } finally {
      setSaving(false);
    }
  }

  const effectiveKey = key || suggestKey(title);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>New forms start private to admins. You choose who can fill it next.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-form-title" className="block font-medium">Title</label>
            <Input id="new-form-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Artist feedback" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-form-key" className="block font-medium">Key</label>
            <Input
              id="new-form-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={effectiveKey || "artist_feedback"}
            />
            <p className="text-sm text-muted-foreground">
              The form&apos;s address: /forms/{effectiveKey || "…"}. It cannot be changed later.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-form-description" className="block font-medium">Description</label>
            <Textarea id="new-form-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !title.trim() || !effectiveKey}>
            {saving ? "Creating" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function publicPath(formKey: string) {
  return `/forms/${encodeURIComponent(formKey)}`;
}

/**
 * Shows the form's full URL with a copy button.
 *
 * The origin is read on the client rather than baked in, so the link is right in development and
 * in production without a configured base URL.
 */
function ShareLink({ formKey }: { formKey: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // window does not exist during the server render, so there is no render-time value to derive
    // this from — it has to be read after mount, which is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}${publicPath(formKey)}`;

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted/40 px-2.5 py-2 text-sm">{url}</code>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
          } catch {
            // Clipboard access is denied outside a secure context, which on http:// is normal.
            toast.error("Could not copy. Select the link and copy it by hand.");
          }
        }}
      >
        <Copy className="h-4 w-4" /> Copy
      </Button>
    </div>
  );
}

function FormDetail({ formId, onChanged }: { formId: string; onChanged: () => void }) {
  const { data, mutate } = useSWR<{
    definition: FormSummary;
    fields: FieldRow[];
    submissions: SubmissionRow[];
  }>(`/api/admin/forms/${formId}`, fetcher);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FieldRow | null>(null);

  if (!data?.definition) {
    return (
      <Card>
        <CardContent className="py-12 text-muted-foreground">Loading</CardContent>
      </Card>
    );
  }

  const { definition, fields, submissions } = data;

  async function patchForm(patch: Record<string, unknown>) {
    try {
      await send(`/api/admin/forms/${formId}`, "PATCH", patch);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...fields];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      // Section travels with the order, so moving a field past a section boundary moves it into
      // that section rather than leaving it visually out of place.
      await send(`/api/admin/forms/${formId}/fields`, "PATCH", {
        orderedFieldIds: next.map((f) => ({ id: f.id, section: f.section })),
      });
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reorder");
    }
  }

  async function removeField(field: FieldRow) {
    try {
      await send(`/api/admin/forms/${formId}/fields/${field.id}`, "DELETE");
      toast.success(`Removed ${field.label}. Answers already recorded under it are kept.`);
      setPendingDelete(null);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the field");
    }
  }

  const specs = fields.map(toSpec);

  return (
    <div className="space-y-5 min-w-0">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-lg">{definition.title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              <span className="font-mono">{definition.key}</span>
              {definition.createdByName ? ` · built by ${definition.createdByName}` : " · built by a seeder"}
              {` · ${formatDate(definition.createdAt)}`}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" asChild className="gap-1.5">
              <a href={publicPath(definition.key)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Open
              </a>
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Accepting</span>
              <Switch checked={definition.isActive} onCheckedChange={(v) => patchForm({ isActive: v })} />
            </label>
          </div>
        </CardHeader>
      </Card>

      <Tabs defaultValue="build">
        <TabsList>
          <TabsTrigger value="build">Build</TabsTrigger>
          <TabsTrigger value="share">Who can fill it</TabsTrigger>
          <TabsTrigger value="responses">Responses ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="build" className="mt-4">
          <div className="grid gap-5 2xl:grid-cols-2 2xl:items-start">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-lg">Fields</CardTitle>
                <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5">
                  <Plus className="h-4 w-4" /> Add field
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {adding && (
                  <FieldEditor
                    formId={formId}
                    knownSections={[...new Set(fields.map((f) => f.section).filter((s): s is string => Boolean(s)))]}
                    onCancel={() => setAdding(false)}
                    onSaved={() => {
                      setAdding(false);
                      mutate();
                      onChanged();
                    }}
                  />
                )}

                {fields.length === 0 && !adding && (
                  <p className="text-muted-foreground">No fields yet. This form would submit nothing.</p>
                )}

                {fields.map((f, i) =>
                  editingId === f.id ? (
                    <FieldEditor
                      key={f.id}
                      formId={formId}
                      field={f}
                      knownSections={[...new Set(fields.map((x) => x.section).filter((s): s is string => Boolean(s)))]}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => {
                        setEditingId(null);
                        mutate();
                        onChanged();
                      }}
                    />
                  ) : (
                    <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <div className="flex flex-col shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label={`Move ${f.label} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => move(i, 1)}
                          disabled={i === fields.length - 1}
                          aria-label={`Move ${f.label} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{f.label}</span>
                          {f.isRequired && <span className="text-destructive">*</span>}
                        </div>
                        <div className="text-sm text-muted-foreground truncate">
                          {FIELD_TYPE_LABELS[f.fieldType] ?? f.fieldType}
                          {f.section ? ` · ${f.section}` : ""}
                          {" · "}
                          <span className="font-mono">{f.fieldKey}</span>
                        </div>
                      </div>
                      <Button variant="ghost" size="icon-sm" onClick={() => setEditingId(f.id)} aria-label={`Edit ${f.label}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setPendingDelete(f)}
                        aria-label={`Remove ${f.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                )}
              </CardContent>
            </Card>

            <Card className="2xl:sticky 2xl:top-4">
              <CardHeader>
                <CardTitle className="text-lg">Preview</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Exactly what someone filling this form sees. Try it — nothing here is submitted.
                </p>
              </CardHeader>
              <CardContent>
                <FormPreview title={definition.title} description={definition.description} fields={specs} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="share" className="mt-4">
          <AudiencePanel definition={definition} onPatch={patchForm} />
        </TabsContent>

        <TabsContent value="responses" className="mt-4">
          <SubmissionsTable fields={specs} submissions={submissions} formKey={definition.key} />
        </TabsContent>
      </Tabs>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops appearing on the form. Answers already recorded under{" "}
              <span className="font-mono">{pendingDelete?.fieldKey}</span> are kept and stay readable in Responses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && removeField(pendingDelete)}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

/**
 * Adds a field, or edits one in place.
 *
 * One component for both, because the two forms are the same shape and the only differences are
 * the field key (fixed once answers exist under it) and which endpoint is called.
 */
function FieldEditor({
  formId,
  field,
  knownSections,
  onCancel,
  onSaved,
}: {
  formId: string;
  field?: FieldRow;
  knownSections: string[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(field);
  const [draft, setDraft] = useState({
    fieldKey: field?.fieldKey ?? "",
    label: field?.label ?? "",
    fieldType: field?.fieldType ?? "text",
    isRequired: field?.isRequired ?? false,
    section: field?.section ?? "",
    helpText: field?.helpText ?? "",
    placeholder: field?.placeholder ?? "",
    options: normalizeFieldOptions(field?.options)
      .map((o) => o.label)
      .join(", "),
  });
  const [saving, setSaving] = useState(false);

  function suggestKey(label: string) {
    const words = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ");
    return words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("").slice(0, 40);
  }

  const effectiveKey = editing ? draft.fieldKey : draft.fieldKey || suggestKey(draft.label);
  const needsOptions = draft.fieldType === "select" || draft.fieldType === "multi_select";

  async function save() {
    setSaving(true);
    try {
      const payload = {
        label: draft.label,
        fieldType: draft.fieldType,
        isRequired: draft.isRequired,
        section: draft.section || null,
        helpText: draft.helpText || null,
        placeholder: draft.placeholder || null,
        options: draft.options ? draft.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
      };
      if (editing) {
        await send(`/api/admin/forms/${formId}/fields/${field!.id}`, "PATCH", payload);
      } else {
        await send(`/api/admin/forms/${formId}/fields`, "POST", { ...payload, fieldKey: effectiveKey });
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the field");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-primary/40 bg-muted/30 p-3.5 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="field-editor-label" className="block font-medium">Question</label>
          <Input
            id="field-editor-label"
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="What should we call you?"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="field-editor-type" className="block font-medium">Type</label>
          <Select value={draft.fieldType} onValueChange={(v) => setDraft({ ...draft, fieldType: v })}>
            <SelectTrigger id="field-editor-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="field-editor-section" className="block font-medium">Section</label>
          <Input
            id="field-editor-section"
            value={draft.section}
            onChange={(e) => setDraft({ ...draft, section: e.target.value })}
            placeholder="Leave blank for the first section"
            list="known-sections"
          />
          <datalist id="known-sections">
            {knownSections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        {needsOptions && (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="field-editor-options" className="block font-medium">Choices</label>
            <Input
              id="field-editor-options"
              value={draft.options}
              onChange={(e) => setDraft({ ...draft, options: e.target.value })}
              placeholder="Small, Medium, Large"
            />
            <p className="text-sm text-muted-foreground">Separated by commas.</p>
          </div>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="field-editor-help" className="block font-medium">Help text</label>
          <Input
            id="field-editor-help"
            value={draft.helpText}
            onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
            placeholder="Shown under the question. Optional."
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="field-editor-key" className="block font-medium">Key</label>
          <Input
            id="field-editor-key"
            value={editing ? field!.fieldKey : draft.fieldKey}
            disabled={editing}
            onChange={(e) => setDraft({ ...draft, fieldKey: e.target.value })}
            placeholder={effectiveKey || "fullName"}
            className="font-mono"
          />
          <p className="text-sm text-muted-foreground">
            {editing
              ? "Fixed. Every answer already given is stored under this key, so renaming it would orphan them."
              : `Answers are stored under this name. Defaults to ${effectiveKey || "the question"}.`}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-muted-foreground">
          <Switch checked={draft.isRequired} onCheckedChange={(v) => setDraft({ ...draft, isRequired: v })} />
          Required
        </label>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5">
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !draft.label.trim() || !effectiveKey} className="gap-1.5">
            <Check className="h-4 w-4" /> {saving ? "Saving" : editing ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Who can fill the form, and the link to send them. */
function AudiencePanel({
  definition,
  onPatch,
}: {
  definition: FormSummary;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [emailDraft, setEmailDraft] = useState("");

  const audience = AUDIENCES.find((a) => a.value === definition.audience) ?? AUDIENCES[0];
  const behavior = BEHAVIORS.find((b) => b.value === definition.onSubmissionBehavior) ?? BEHAVIORS[0];

  async function addEmails() {
    // One paste of addresses separated by commas, spaces or newlines is how a list of people
    // actually arrives.
    const added = emailDraft.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (added.length === 0) return;
    await onPatch({ allowedEmails: [...new Set([...definition.allowedEmails, ...added])] });
    setEmailDraft("");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Who can fill it</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {AUDIENCES.map((a) => (
              <label
                key={a.value}
                className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  definition.audience === a.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="audience"
                  className="mt-1"
                  checked={definition.audience === a.value}
                  onChange={() => onPatch({ audience: a.value })}
                />
                <div className="min-w-0">
                  <div className="font-medium">{a.label}</div>
                  <p className="text-sm text-muted-foreground">{a.help}</p>
                </div>
              </label>
            ))}
          </div>

          {definition.audience === "roles" && (
            <div className="space-y-2">
              <p className="font-medium">Roles</p>
              <div className="flex flex-wrap gap-2">
                {ROLES.map((r) => {
                  const on = definition.targetRoles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() =>
                        onPatch({
                          targetRoles: on
                            ? definition.targetRoles.filter((x) => x !== r)
                            : [...definition.targetRoles, r],
                        })
                      }
                      className={`min-h-9 rounded-full border px-3.5 transition-colors ${
                        on ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {definition.audience === "emails" && (
            <div className="space-y-2">
              <p className="font-medium">Addresses</p>
              <div className="flex flex-wrap gap-2">
                {definition.allowedEmails.map((email) => (
                  <span key={email} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5">
                    {email}
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      onClick={() => onPatch({ allowedEmails: definition.allowedEmails.filter((e) => e !== email) })}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </span>
                ))}
                {definition.allowedEmails.length === 0 && (
                  <p className="text-sm text-muted-foreground">Nobody yet, so nobody can fill it.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  value={emailDraft}
                  onChange={(e) => setEmailDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addEmails();
                    }
                  }}
                  placeholder="someone@example.com, another@example.com"
                />
                <Button variant="outline" onClick={addEmails} disabled={!emailDraft.trim()}>
                  Add
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                They have to sign in. An address typed into a form proves nothing about who typed it.
              </p>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <p className="font-medium">Link</p>
            <ShareLink formKey={definition.key} />
            <p className="text-sm text-muted-foreground">{audience.help}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What happens on submit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {BEHAVIORS.map((b) => {
            const blocked = b.value === "trigger_artifact_creation" && definition.audience === "public";
            return (
              <label
                key={b.value}
                className={`flex gap-3 rounded-lg border p-3 transition-colors ${
                  blocked ? "opacity-50 cursor-not-allowed border-border" : "cursor-pointer"
                } ${
                  definition.onSubmissionBehavior === b.value && !blocked
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                <input
                  type="radio"
                  name="behavior"
                  className="mt-1"
                  disabled={blocked}
                  checked={definition.onSubmissionBehavior === b.value}
                  onChange={() => onPatch({ onSubmissionBehavior: b.value })}
                />
                <div className="min-w-0">
                  <div className="font-medium">{b.label}</div>
                  <p className="text-sm text-muted-foreground">{b.help}</p>
                  {blocked && (
                    <p className="text-sm text-warning mt-1">
                      Set this form to roles or addresses first.
                    </p>
                  )}
                </div>
              </label>
            );
          })}
          <p className="text-sm text-muted-foreground pt-1">Currently: {behavior.label}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
