"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw } from "lucide-react";

interface FormField {
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  options: string[];
}

// A public, unauthenticated submitter has no server-side session to attach
// a saved draft to, so autosave lives in localStorage instead - the same
// "don't lose real work to an accidental tab close" goal the user's
// draft-storage complaint was about, just via the mechanism that actually
// works with nobody logged in. Cleared on a successful submit.
function draftKey(formKey: string) {
  return `pipeline_form_draft_${formKey}`;
}

export function PublicForm({ formKey, fields }: { formKey: string; fields: FormField[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  // Every public submission needs a way to reach the person who made it — nobody is logged in, so
  // the address they type is the only contact there will ever be, and the server rejects a public
  // submission without one. Most forms declare their own "email" field; this input is for the
  // ones that don't, so a form built in the admin builder is usable without remembering to add it.
  const [contactEmail, setContactEmail] = useState("");
  const formHasEmailField = fields.some((f) => f.fieldKey.toLowerCase() === "email");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);

  useEffect(() => {
    // A genuine exception to "adjust state during render instead of in an
    // effect": localStorage doesn't exist during SSR, so there's no
    // render-time value to compute — this has to run after mount, once,
    // client-only, which is exactly what useEffect is for. Reading it into
    // a lazy useState initializer instead would run during the server
    // render too (where window is undefined) and the client's first render
    // (where it isn't), producing a real hydration mismatch.
    try {
      const saved = localStorage.getItem(draftKey(formKey));
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValues(JSON.parse(saved));
        setRestoredDraft(true);
      }
    } catch {
      // Corrupt/unavailable localStorage is not worth failing the page over — just starts blank.
    }
  }, [formKey]);

  useEffect(() => {
    if (submitted) return;
    if (Object.keys(values).length === 0) return;
    try {
      localStorage.setItem(draftKey(formKey), JSON.stringify(values));
    } catch {
      // Same as above — best-effort only.
    }
  }, [values, formKey, submitted]);

  function setField(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function startOver() {
    setValues({});
    try {
      localStorage.removeItem(draftKey(formKey));
    } catch {
      // best-effort
    }
    setRestoredDraft(false);
  }

  async function submit() {
    const missing = fields.filter((f) => f.isRequired && !values[f.fieldKey]?.trim());
    if (missing.length > 0) {
      toast.error(`Please fill in: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    if (!formHasEmailField && !contactEmail.trim()) {
      toast.error("Please give us an email address so we can get back to you.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, submitterEmail: formHasEmailField ? undefined : contactEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to submit");
        return;
      }
      try {
        localStorage.removeItem(draftKey(formKey));
      } catch {
        // best-effort
      }
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-6 text-center space-y-2">
        <CheckCircle2 className="h-6 w-6 text-primary mx-auto" />
        <p className="font-medium">Submitted — thanks!</p>
        <p className="text-sm text-muted-foreground">Someone on the team will review it and follow up by email.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {restoredDraft && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>Restored what you&apos;d already filled in.</span>
          <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={startOver}>
            <RotateCcw className="h-3 w-3" /> Start over
          </Button>
        </div>
      )}

      {!formHasEmailField && (
        <div>
          <label htmlFor="contact-email" className="text-xs text-muted-foreground mb-1 block">
            Your email<span className="text-destructive"> *</span>
          </label>
          <input
            id="contact-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
          />
          <p className="text-xs text-muted-foreground mt-1">So someone can follow up on what you send.</p>
        </div>
      )}

      {/* Every field visible at once, fillable in any order — same
          flow-state principle the internal curation form uses. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => {
          const value = values[f.fieldKey] || "";
          const wide = f.fieldType === "textarea" || f.fieldType === "multi_select";
          return (
            <div key={f.fieldKey} className={wide ? "sm:col-span-2" : ""}>
              {/* Tied to its control by id so a screen reader announces the label with the
                  field, and clicking the label focuses it. */}
              <label htmlFor={`field-${f.fieldKey}`} className="text-xs text-muted-foreground mb-1 block">
                {f.label}
                {f.isRequired && <span className="text-destructive"> *</span>}
              </label>
              {f.fieldType === "textarea" && (
                <Textarea id={`field-${f.fieldKey}`} value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} rows={3} />
              )}
              {(f.fieldType === "select" || f.fieldType === "multi_select") && f.options.length > 0 && (
                <Select value={value} onValueChange={(v) => setField(f.fieldKey, v)}>
                  <SelectTrigger id={`field-${f.fieldKey}`} className="w-full">
                    <SelectValue placeholder={`Select ${f.label.toLowerCase()}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {f.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.fieldType === "url" && (
                <Input id={`field-${f.fieldKey}`} type="url" value={value} onChange={(e) => setField(f.fieldKey, e.target.value)} placeholder="https://..." />
              )}
              {!["textarea", "select", "multi_select", "url"].includes(f.fieldType) && (
                <Input
                  id={`field-${f.fieldKey}`}
                  type={f.fieldKey.toLowerCase().includes("email") ? "email" : "text"}
                  value={value}
                  onChange={(e) => setField(f.fieldKey, e.target.value)}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={submit} disabled={submitting}>
          {submitting ? "Submitting..." : "Submit"}
        </Button>
      </div>
    </div>
  );
}
