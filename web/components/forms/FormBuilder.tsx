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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, ExternalLink } from "lucide-react";

const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "url", "image", "file"] as const;
const BEHAVIORS = ["record_only", "trigger_personnel_onboarding", "trigger_artifact_creation"] as const;
const ROLES = ["admin", "operator", "curator", "artist", "publisher", "marketing", "payment_admin"];

const BEHAVIOR_HELP: Record<string, string> = {
  record_only: "Stores the submission for someone to review. Nothing happens automatically.",
  trigger_personnel_onboarding:
    "Stores the submission as pending. It still takes an admin approving it on the Personnel page to create the account — a public form can't grant its own access.",
  trigger_artifact_creation: "Creates the knowledge artifact immediately on submit. Only safe on a role-restricted form.",
};

interface FormSummary {
  id: string;
  key: string;
  title: string;
  description: string | null;
  targetRoles: string[];
  onSubmissionBehavior: string;
  isActive: boolean;
  fieldCount: number;
  submissionCount: number;
}

interface FieldRow {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  sortOrder: number;
  options: unknown;
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

/**
 * The admin form builder — create a form, give it fields, decide who can fill it.
 *
 * The forms engine was already config-driven in the database; the only way to add a form was to
 * write a seeder and redeploy. Field answers live in form_submissions.values as JSONB keyed by
 * field key, so adding, retyping or removing a field here needs no migration, and submissions
 * recorded under a removed field stay readable.
 */
export function FormBuilder() {
  const { data, mutate } = useSWR<{ forms: FormSummary[] }>("/api/admin/forms", fetcher);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const forms = data?.forms ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="h-fit">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Forms</CardTitle>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> New
          </Button>
        </CardHeader>
        <CardContent className="space-y-1">
          {forms.length === 0 && <p className="text-sm text-muted-foreground">No forms yet.</p>}
          {forms.map((f) => (
            <button
              key={f.id}
              onClick={() => setSelectedId(f.id)}
              className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                selectedId === f.id ? "bg-muted" : "hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{f.title}</span>
                {!f.isActive && <Badge variant="secondary" className="text-[10px]">inactive</Badge>}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {f.fieldCount} field{f.fieldCount === 1 ? "" : "s"} · {f.submissionCount} submission
                {f.submissionCount === 1 ? "" : "s"}
                {f.targetRoles.length === 0 && " · public"}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {selectedId ? (
        <FormDetail formId={selectedId} onChanged={() => mutate()} />
      ) : (
        <Card className="h-fit">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a form to edit its fields, or create one.
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

  async function submit() {
    setSaving(true);
    try {
      const data = await send("/api/admin/forms", "POST", { key, title, description });
      const form = data.form as { id: string };
      toast.success(`Created "${title}"`);
      setKey("");
      setTitle("");
      setDescription("");
      onOpenChange(false);
      onCreated(form.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create form");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New form</DialogTitle>
          <DialogDescription>
            The key is how code and URLs address this form, and it can&apos;t be changed later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="new-form-key" className="text-xs text-muted-foreground mb-1 block">Key</label>
            <Input
              id="new-form-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="artist_feedback"
            />
          </div>
          <div>
            <label htmlFor="new-form-title" className="text-xs text-muted-foreground mb-1 block">Title</label>
            <Input id="new-form-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Artist Feedback" />
          </div>
          <div>
            <label htmlFor="new-form-description" className="text-xs text-muted-foreground mb-1 block">Description</label>
            <Textarea id="new-form-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !key.trim() || !title.trim()}>
            {saving ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The path a public form is served at. Mirrors app/f/[formKey]/page.tsx. */
function publicPath(formKey: string) {
  return `/forms/${encodeURIComponent(formKey)}`;
}

/**
 * Shows a public form's full URL with a copy button.
 *
 * The origin is read on the client rather than baked in, so the link is right in local
 * development and in production without a configured base URL.
 */
function ShareLink({ formKey }: { formKey: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}${publicPath(formKey)}`;

  return (
    <div className="flex items-center gap-1.5">
      <code className="flex-1 min-w-0 truncate rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs">
        {url}
      </code>
      <Button
        variant="outline"
        size="sm"
        className="gap-1 text-xs shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            toast.success("Link copied");
          } catch {
            // Clipboard access is denied outside a secure context, and on http:// that is normal
            // rather than an error worth alarming anyone about.
            toast.error("Couldn't copy — select the link and copy it by hand.");
          }
        }}
      >
        <Copy className="h-3 w-3" /> Copy
      </Button>
    </div>
  );
}

function FormDetail({ formId, onChanged }: { formId: string; onChanged: () => void }) {
  const { data, mutate } = useSWR<{
    definition: FormSummary;
    fields: FieldRow[];
    submissions: Array<{ id: string; submitterEmail: string | null; status: string; createdAt: string }>;
  }>(`/api/admin/forms/${formId}`, fetcher);

  const [adding, setAdding] = useState(false);
  const [newField, setNewField] = useState({ fieldKey: "", label: "", fieldType: "text", isRequired: false, options: "" });

  if (!data?.definition) return <Card><CardContent className="py-10 text-sm text-muted-foreground">Loading…</CardContent></Card>;

  const { definition, fields, submissions } = data;

  async function patchForm(patch: Record<string, unknown>) {
    try {
      await send(`/api/admin/forms/${formId}`, "PATCH", patch);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function addNewField() {
    try {
      await send(`/api/admin/forms/${formId}/fields`, "POST", {
        fieldKey: newField.fieldKey,
        label: newField.label,
        fieldType: newField.fieldType,
        isRequired: newField.isRequired,
        options: newField.options ? newField.options.split(",").map((o) => o.trim()).filter(Boolean) : [],
      });
      setNewField({ fieldKey: "", label: "", fieldType: "text", isRequired: false, options: "" });
      setAdding(false);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add field");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const next = [...fields];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await send(`/api/admin/forms/${formId}/fields`, "PATCH", { orderedFieldIds: next.map((f) => f.id) });
      mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder");
    }
  }

  async function removeFieldById(fieldId: string, fieldKey: string) {
    try {
      await send(`/api/admin/forms/${formId}/fields/${fieldId}`, "DELETE");
      toast.success(`Removed "${fieldKey}". Answers already recorded under it are kept.`);
      mutate();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove field");
    }
  }

  const isPublic = definition.targetRoles.length === 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">{definition.title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{definition.key}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isPublic && (
              <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
                <a href={publicPath(definition.key)} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3" /> Open
                </a>
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Active</span>
              <Switch checked={definition.isActive} onCheckedChange={(v) => patchForm({ isActive: v })} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <fieldset>
            <legend className="text-xs text-muted-foreground mb-1 block">Who can fill it</legend>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => patchForm({ targetRoles: [] })}
                className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                  isPublic ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                }`}
              >
                Anyone (public)
              </button>
              {ROLES.map((r) => {
                const on = definition.targetRoles.includes(r);
                return (
                  <button
                    key={r}
                    onClick={() =>
                      patchForm({
                        targetRoles: on
                          ? definition.targetRoles.filter((x) => x !== r)
                          : [...definition.targetRoles, r],
                      })
                    }
                    className={`text-xs rounded-full border px-2.5 py-1 transition-colors ${
                      on ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
            {isPublic ? (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  Anyone with this link can fill it in — no account needed. They&apos;re asked for an email so
                  someone can follow up.
                </p>
                <ShareLink formKey={definition.key} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-1.5">
                Restricted to the roles above. It has no public link and won&apos;t open for anyone else.
              </p>
            )}
          </fieldset>

          <div>
            <label htmlFor="form-submission-behavior" className="text-xs text-muted-foreground mb-1 block">On submission</label>
            <Select value={definition.onSubmissionBehavior} onValueChange={(v) => patchForm({ onSubmissionBehavior: v })}>
              <SelectTrigger id="form-submission-behavior" className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BEHAVIORS.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1.5">{BEHAVIOR_HELP[definition.onSubmissionBehavior]}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Fields</CardTitle>
          <Button size="sm" onClick={() => setAdding(!adding)} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Add field
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {adding && (
            <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  placeholder="fieldKey"
                  value={newField.fieldKey}
                  onChange={(e) => setNewField({ ...newField, fieldKey: e.target.value })}
                />
                <Input
                  placeholder="Label shown to the person"
                  value={newField.label}
                  onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                />
                <Select value={newField.fieldType} onValueChange={(v) => setNewField({ ...newField, fieldType: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(newField.fieldType === "select" || newField.fieldType === "multi_select") && (
                  <Input
                    placeholder="Options, comma separated"
                    value={newField.options}
                    onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={newField.isRequired}
                    onCheckedChange={(v) => setNewField({ ...newField, isRequired: v })}
                  />
                  Required
                </label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={addNewField} disabled={!newField.fieldKey.trim() || !newField.label.trim()}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

          {fields.length === 0 && !adding && (
            <p className="text-sm text-muted-foreground">No fields yet — this form would submit nothing.</p>
          )}

          {fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${f.label} up`}
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === fields.length - 1}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                  aria-label={`Move ${f.label} down`}
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{f.label}</span>
                  {f.isRequired && <span className="text-destructive text-xs">*</span>}
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  {f.fieldKey} · {f.fieldType}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => removeFieldById(f.id, f.fieldKey)}
                aria-label={`Remove ${f.label}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submissions ({submissions.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing submitted yet.</p>
          ) : (
            <div className="space-y-1">
              {submissions.slice(0, 20).map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-sm py-1">
                  <span className="truncate">{s.submitterEmail || "(no email)"}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={s.status === "approved" ? "default" : "secondary"} className="text-[10px]">
                      {s.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(s.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
