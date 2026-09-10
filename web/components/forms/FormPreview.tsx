"use client";

import { useMemo, useState } from "react";
import { FieldControl } from "./FieldControl";
import {
  groupIntoSections,
  isBlank,
  sectionProgress,
  type FieldValue,
  type FormFieldSpec,
  type FormValues,
} from "./form-field-spec";
import { Check } from "lucide-react";

/**
 * The live preview in the builder.
 *
 * It renders the real controls, arranged into the real sections, with the same jump rail the
 * filler has — so what an admin sees while building is what the person filling it will get,
 * including whether the sections they made actually break the form up sensibly.
 *
 * It is interactive on purpose. Reading a disabled form tells you nothing about whether a
 * dropdown has the right choices in it. Nothing here is submitted; the answers live in this
 * component and are thrown away.
 *
 * Input: the form's title, description and fields. Output: the form as it will be filled.
 */
export function FormPreview({
  title,
  description,
  fields,
}: {
  title: string;
  description: string | null;
  fields: FormFieldSpec[];
}) {
  const [values, setValues] = useState<FormValues>({});
  const [active, setActive] = useState(0);

  const sections = useMemo(() => groupIntoSections(fields), [fields]);

  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
        Add a field and it appears here.
      </div>
    );
  }

  function setField(key: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const visible = sections[Math.min(active, sections.length - 1)];

  return (
    <div className="rounded-lg border border-border bg-background p-4 space-y-4">
      <div>
        <h3 className="text-lg">{title}</h3>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>

      {/* One section at a time here rather than all of them stacked, because the preview sits in a
          panel beside the builder and has far less room than the real page. The rail is the same
          control, so the section structure still reads the way it will. */}
      {sections.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {sections.map((section, i) => {
            const progress = sectionProgress(section, values);
            const complete = progress.missing === 0 && progress.answered > 0;
            return (
              <button
                key={section.key ?? `__default-${i}`}
                type="button"
                onClick={() => setActive(i)}
                className={`shrink-0 rounded-md min-h-9 px-3 flex items-center gap-2 transition-colors ${
                  i === active ? "bg-muted font-medium" : "hover:bg-muted/60 text-muted-foreground"
                }`}
              >
                <span className="truncate">{section.name}</span>
                {complete && <Check className="w-4 h-4 text-success shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {visible.fields.map((field) => {
          const wide =
            field.fieldType === "textarea" || (field.fieldType === "multi_select" && field.options.length > 0);
          return (
            <div key={field.fieldKey} className={wide ? "sm:col-span-2" : ""}>
              <FieldControl
                field={field}
                value={values[field.fieldKey]}
                onChange={(v) => setField(field.fieldKey, v)}
                idPrefix="preview"
              />
            </div>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground border-t border-border pt-3">
        {fields.filter((f) => f.isRequired && isBlank(values[f.fieldKey])).length} required left. This preview does not
        submit.
      </p>
    </div>
  );
}
