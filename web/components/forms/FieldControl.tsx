"use client";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { asList, asText, type FieldValue, type FormFieldSpec } from "./form-field-spec";

/**
 * Draws one form field.
 *
 * Input: the field, its current answer, and a callback for when the answer changes. Output: the label, the control, and any help text under it.
 *
 * There is one of these because the builder's preview renders it too. A preview drawn by separate
 * code is a picture of a form rather than the form, and drifts from it the first time either side
 * changes.
 */
export function FieldControl({
  field,
  value,
  onChange,
  idPrefix = "field",
  disabled = false,
}: {
  field: FormFieldSpec;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  idPrefix?: string;
  disabled?: boolean;
}) {
  const id = `${idPrefix}-${field.fieldKey}`;

  // A select or multi_select whose options were never configured has nothing to choose from.
  // Rendering the dropdown anyway gave a label with no control under it, and no way to answer a
  // question that might be required, so those fall through to a free-text input.
  const hasChoices = (field.fieldType === "select" || field.fieldType === "multi_select") && field.options.length > 0;
  const isMulti = field.fieldType === "multi_select" && field.options.length > 0;

  function toggle(option: string) {
    const current = asList(value);
    onChange(current.includes(option) ? current.filter((v) => v !== option) : [...current, option]);
  }

  return (
    <div className="space-y-1.5">
      {/* Tied to its control by id, so a screen reader announces the label with the field and
          clicking the label focuses it. */}
      <label htmlFor={id} className="block font-medium">
        {field.label}
        {field.isRequired && <span className="text-destructive"> *</span>}
      </label>
      {field.helpText && <p className="text-sm text-muted-foreground">{field.helpText}</p>}

      {field.fieldType === "textarea" && (
        <Textarea
          id={id}
          disabled={disabled}
          value={asText(value)}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      )}

      {isMulti && (
        // Several answers means several controls. A single Select could only ever hold one of
        // them, so a multi_select used to throw away every choice but the last.
        <div id={id} role="group" aria-label={field.label} className="flex flex-wrap gap-2">
          {field.options.map((opt) => {
            const on = asList(value).includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => toggle(opt.value)}
                className={`min-h-9 rounded-full border px-3.5 transition-colors disabled:opacity-60 ${
                  on ? "bg-primary text-primary-foreground border-primary" : "border-input hover:bg-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}

      {hasChoices && !isMulti && (
        <Select value={asText(value)} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.fieldType === "url" && (
        <Input
          id={id}
          type="url"
          inputMode="url"
          disabled={disabled}
          value={asText(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || "https://"}
        />
      )}

      {/* image and file are stored as a link rather than an upload. There is no file store behind
          this form, so an upload control would promise something the server cannot do; asking for
          the link is what the rest of the pipeline already does with Drive references. */}
      {(field.fieldType === "image" || field.fieldType === "file") && (
        <Input
          id={id}
          type="url"
          inputMode="url"
          disabled={disabled}
          value={asText(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || "Paste a link to the file"}
        />
      )}

      {field.fieldType !== "textarea" &&
        field.fieldType !== "url" &&
        field.fieldType !== "image" &&
        field.fieldType !== "file" &&
        !hasChoices && (
          <Input
            id={id}
            type={field.fieldKey.toLowerCase().includes("email") ? "email" : "text"}
            disabled={disabled}
            value={asText(value)}
            placeholder={field.placeholder || undefined}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
    </div>
  );
}
