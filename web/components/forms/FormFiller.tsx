"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CheckCircle2, RotateCcw, Check } from "lucide-react";
import { FieldControl } from "./FieldControl";
import {
  groupIntoSections,
  isBlank,
  sectionProgress,
  type FieldValue,
  type FormFieldSpec,
  type FormValues,
} from "./form-field-spec";

/**
 * Where a form in progress is kept.
 *
 * Nobody filling a public form has a session to attach a draft to, so it lives in this browser.
 * Cleared on a successful submit.
 */
function draftKey(formKey: string) {
  return `pipeline_form_draft_${formKey}`;
}

/**
 * Keeps only the entries a control can render out of whatever is in localStorage.
 *
 * Input: the parsed draft — possibly written by an older version of this form, possibly edited by hand. Output: a map of strings and string arrays.
 * Anything else is dropped, so a stale draft costs one field rather than crashing the page it is restored into.
 */
function sanitizeDraft(parsed: unknown): FormValues {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: FormValues = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === "string");
  }
  return out;
}

/**
 * Fills a form.
 *
 * Every section is on the page at once and the rail on the left jumps to any of them, so someone
 * who knows the form can go straight to the part they came to fill instead of paging through it
 * in order. The rail also says how much of each section is done, which is the thing a linear form
 * cannot tell you without scrolling to the end.
 *
 * Input: the form's key, title, fields, and whether it still needs to ask for a contact address. Output: the filled form, submitted to /api/forms/<key>/submit.
 */
export function FormFiller({
  formKey,
  title,
  description,
  fields,
  knownEmail,
  requiresContactEmail,
}: {
  formKey: string;
  title: string;
  description: string | null;
  fields: FormFieldSpec[];
  knownEmail: string | null;
  requiresContactEmail: boolean;
}) {
  const [values, setValues] = useState<FormValues>({});
  const [contactEmail, setContactEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  const [attempted, setAttempted] = useState(false);

  const sections = useMemo(() => groupIntoSections(fields), [fields]);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);

  // Most forms declare their own "email" field. This asks for one only when the form does not and
  // nobody is signed in, so a form built without remembering to add an email field is still
  // answerable and still leaves a way to reach whoever answered it.
  const formHasEmailField = fields.some((f) => f.fieldKey.toLowerCase() === "email");
  const asksForContactEmail = requiresContactEmail && !formHasEmailField && !knownEmail;

  useEffect(() => {
    // localStorage does not exist during the server render, so there is no render-time value to
    // compute this from. It has to be read after mount, which is what this effect is for.
    try {
      const saved = localStorage.getItem(draftKey(formKey));
      if (!saved) return;
      const restored = sanitizeDraft(JSON.parse(saved));
      if (Object.keys(restored).length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setValues(restored);
        setRestoredDraft(true);
      }
    } catch {
      // Corrupt or unavailable localStorage is not worth failing the page over; it just starts blank.
    }
  }, [formKey]);

  useEffect(() => {
    if (submitted) return;
    if (Object.keys(values).length === 0) return;
    try {
      localStorage.setItem(draftKey(formKey), JSON.stringify(values));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedAt(Date.now());
    } catch {
      // Best-effort only. A browser that refuses storage still fills and submits the form.
    }
  }, [values, formKey, submitted]);

  // Which section the reader is looking at, so the rail marks it without them having to click.
  // An observer rather than a scroll handler, because it reports only when a boundary is crossed.
  useEffect(() => {
    const nodes = sectionRefs.current.filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const index = nodes.indexOf(top.target as HTMLElement);
        if (index >= 0) setActiveSection(index);
      },
      // Biased to the upper third: the section whose heading has just passed the top of the
      // window is the one being read, not whichever happens to occupy the most pixels.
      { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [sections.length]);

  function setField(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function jumpTo(index: number) {
    setActiveSection(index);
    sectionRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startOver() {
    setValues({});
    setAttempted(false);
    setSavedAt(null);
    try {
      localStorage.removeItem(draftKey(formKey));
    } catch {
      // best-effort
    }
    setRestoredDraft(false);
  }

  const missingFields = fields.filter((f) => f.isRequired && isBlank(values[f.fieldKey]));

  async function submit() {
    setAttempted(true);
    if (missingFields.length > 0) {
      // Jumping to the first unanswered required field beats a message naming fields the person
      // then has to go hunting for.
      const firstMissing = missingFields[0];
      const index = sections.findIndex((s) => s.fields.some((f) => f.fieldKey === firstMissing.fieldKey));
      if (index >= 0) jumpTo(index);
      toast.error(`${missingFields.length} required ${missingFields.length === 1 ? "answer is" : "answers are"} still blank.`);
      return;
    }
    if (asksForContactEmail && !contactEmail.trim()) {
      toast.error("Add an email address so someone can reply.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/forms/${encodeURIComponent(formKey)}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, submitterEmail: asksForContactEmail ? contactEmail.trim() : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Could not submit the form.");
        return;
      }
      try {
        localStorage.removeItem(draftKey(formKey));
      } catch {
        // best-effort
      }
      setSubmitted(true);
    } catch {
      toast.error("Could not reach the server. Your answers are saved in this browser.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="grid place-items-center p-6 py-16">
        <div className="w-full max-w-md text-center space-y-3">
          <CheckCircle2 className="h-8 w-8 text-success mx-auto" />
          <h2 className="text-xl">Submitted</h2>
          <p className="text-muted-foreground">
            {knownEmail
              ? `Recorded against ${knownEmail}. Someone will follow up by email.`
              : "Someone on the team will review it and reply by email."}
          </p>
        </div>
      </div>
    );
  }

  const answered = fields.filter((f) => !isBlank(values[f.fieldKey])).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 lg:py-10">
      <div className="mb-6">
        <h1 className="text-xl">{title}</h1>
        {description && <p className="text-muted-foreground mt-1">{description}</p>}
        <p className="text-sm text-muted-foreground mt-2">
          {knownEmail ? `Filling in as ${knownEmail}. ` : ""}
          {answered} of {fields.length} answered. Fill the sections in any order.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:items-start">
        {/* The rail. A row of chips that scrolls sideways on a phone, a sticky column from lg up.
            Either way every section is one click from every other, which is the point. */}
        <nav
          aria-label="Form sections"
          className="lg:sticky lg:top-6 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0"
        >
          {sections.map((section, i) => {
            const progress = sectionProgress(section, values);
            const complete = progress.missing === 0 && progress.answered > 0;
            const isActive = i === activeSection;
            return (
              <button
                key={section.key ?? `__default-${i}`}
                type="button"
                onClick={() => jumpTo(i)}
                aria-current={isActive ? "true" : undefined}
                className={`shrink-0 lg:w-full text-left rounded-md min-h-10 px-3 flex items-center gap-2 transition-colors ${
                  isActive ? "bg-muted font-medium" : "hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                <span className="truncate flex-1">{section.name}</span>
                {complete ? (
                  <Check className="w-4 h-4 text-success shrink-0" />
                ) : (
                  <span className="text-xs tabular-nums shrink-0">
                    {progress.answered}/{progress.total}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          {(restoredDraft || savedAt) && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
              <p className="text-sm text-muted-foreground">
                {restoredDraft ? "Picked up where you left off. " : ""}
                Saved in this browser as you type.
              </p>
              <Button size="sm" variant="ghost" className="gap-1.5 shrink-0" onClick={startOver}>
                <RotateCcw className="w-4 h-4" /> Clear
              </Button>
            </div>
          )}

          {sections.map((section, i) => (
            <section
              key={section.key ?? `__default-${i}`}
              ref={(node) => {
                sectionRefs.current[i] = node;
              }}
              // Clears the sticky header when the rail scrolls to it.
              className="scroll-mt-24 rounded-xl border border-border bg-card p-4 sm:p-5"
              aria-labelledby={`section-heading-${i}`}
            >
              <h2 id={`section-heading-${i}`} className="text-lg mb-4">
                {section.name}
              </h2>
              <div className="grid gap-5 sm:grid-cols-2">
                {section.fields.map((field) => {
                  const wide =
                    field.fieldType === "textarea" ||
                    (field.fieldType === "multi_select" && field.options.length > 0);
                  const showMissing = attempted && field.isRequired && isBlank(values[field.fieldKey]);
                  return (
                    <div key={field.fieldKey} className={wide ? "sm:col-span-2" : ""}>
                      <FieldControl
                        field={field}
                        value={values[field.fieldKey]}
                        onChange={(v) => setField(field.fieldKey, v)}
                      />
                      {showMissing && <p className="text-sm text-destructive mt-1.5">This one is required.</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {asksForContactEmail && (
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-1.5">
              <label htmlFor="contact-email" className="block font-medium">
                Your email<span className="text-destructive"> *</span>
              </label>
              <p className="text-sm text-muted-foreground">So someone can reply to what you send.</p>
              <Input
                id="contact-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </section>
          )}

          <div className="flex items-center justify-between gap-3 pb-8">
            <p className="text-sm text-muted-foreground">
              {missingFields.length > 0
                ? `${missingFields.length} required ${missingFields.length === 1 ? "answer" : "answers"} left`
                : "Everything required is filled in"}
            </p>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Submitting" : "Submit"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
