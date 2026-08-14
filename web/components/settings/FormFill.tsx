"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

interface FieldOption {
  label: string;
  value: string;
}

interface FormFieldConfig {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  options: FieldOption[];
}

export function FormFill({ formId, title, description, fields }: { formId: string; title: string; description: string | null; fields: FormFieldConfig[] }) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function setValue(key: string, value: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function toggleMultiSelect(key: string, optionValue: string) {
    const current = (values[key] as string[]) || [];
    const next = current.includes(optionValue) ? current.filter((v) => v !== optionValue) : [...current, optionValue];
    setValue(key, next);
  }

  async function handleSubmit() {
    const missing = fields.filter((f) => f.isRequired && !values[f.fieldKey]);
    if (missing.length > 0) {
      toast.error(`Required: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/admin/forms/${formId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Submission failed");
      return;
    }
    setSubmitted(true);
    toast.success("Submitted");
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        <p className="text-lg font-medium">Thanks! Your response was recorded.</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground text-sm mt-1">{description}</p> : null}
      </div>

      <div className="flex flex-col gap-5">
        {fields.map((field) => (
          <div key={field.id}>
            <Label htmlFor={field.fieldKey}>
              {field.label}
              {field.isRequired ? <span className="text-destructive"> *</span> : null}
            </Label>

            {field.fieldType === "textarea" ? (
              <Textarea id={field.fieldKey} onChange={(e) => setValue(field.fieldKey, e.target.value)} />
            ) : field.fieldType === "select" ? (
              <Select onValueChange={(v) => setValue(field.fieldKey, v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.fieldType === "multi_select" ? (
              <div className="flex flex-wrap gap-2 mt-1">
                {field.options.map((opt) => {
                  const active = ((values[field.fieldKey] as string[]) || []).includes(opt.value);
                  return (
                    <Badge
                      key={opt.value}
                      variant={active ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleMultiSelect(field.fieldKey, opt.value)}
                    >
                      {opt.label}
                    </Badge>
                  );
                })}
              </div>
            ) : field.fieldType === "image" || field.fieldType === "file" ? (
              <Input
                id={field.fieldKey}
                placeholder="Paste a link (upload not available in this demo)"
                onChange={(e) => setValue(field.fieldKey, e.target.value)}
              />
            ) : (
              <Input
                id={field.fieldKey}
                type={field.fieldType === "url" ? "url" : "text"}
                onChange={(e) => setValue(field.fieldKey, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <Button onClick={handleSubmit} disabled={submitting}>
        {submitting ? "Submitting..." : "Submit"}
      </Button>
    </div>
  );
}
