"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, ArrowUp, ArrowDown } from "lucide-react";

const FIELD_TYPES = ["text", "textarea", "select", "multi_select", "url", "image", "file"] as const;

const cardClass = "shadow-sm hover:shadow-md transition-shadow";

interface FormSummary {
  id: string;
  key: string;
  title: string;
  description: string | null;
  isActive: boolean;
  fieldCount: number;
}

interface FormField {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  sortOrder: number;
  isRequired: boolean;
}

export function FormBuilder({ initialForms }: { initialForms: FormSummary[] }) {
  const [forms, setForms] = useState(initialForms);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ key: "", title: "", description: "" });

  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [fieldForm, setFieldForm] = useState({ fieldKey: "", label: "", fieldType: "text", isRequired: false, optionsText: "" });
  const [addFieldOpen, setAddFieldOpen] = useState(false);

  async function refreshForms() {
    const res = await fetch("/api/admin/forms");
    const data = await res.json();
    if (res.ok) setForms(data.forms);
  }

  async function saveForm() {
    const res = await fetch("/api/admin/forms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createForm),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to create form");
      return;
    }
    setCreateOpen(false);
    setCreateForm({ key: "", title: "", description: "" });
    toast.success(`Form '${data.form.title}' created`);
    refreshForms();
  }

  async function openFormFields(formId: string) {
    setSelectedFormId(formId);
    const res = await fetch(`/api/admin/forms/${formId}`);
    const data = await res.json();
    if (res.ok) setFields(data.fields);
  }

  async function addField() {
    if (!selectedFormId) return;
    const options = fieldForm.optionsText
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .map((label) => ({ label, value: label.toLowerCase().replace(/\s+/g, "_") }));
    const res = await fetch(`/api/admin/forms/${selectedFormId}/fields`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fieldKey: fieldForm.fieldKey,
        label: fieldForm.label,
        fieldType: fieldForm.fieldType,
        isRequired: fieldForm.isRequired,
        options,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to add field");
      return;
    }
    setFields((prev) => [...prev, data.field].sort((a, b) => a.sortOrder - b.sortOrder));
    setAddFieldOpen(false);
    setFieldForm({ fieldKey: "", label: "", fieldType: "text", isRequired: false, optionsText: "" });
    refreshForms();
  }

  async function removeField(fieldId: string) {
    if (!selectedFormId) return;
    await fetch(`/api/admin/forms/${selectedFormId}/fields/${fieldId}`, { method: "DELETE" });
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    refreshForms();
  }

  async function moveField(index: number, direction: -1 | 1) {
    if (!selectedFormId) return;
    const newFields = [...fields];
    const target = index + direction;
    if (target < 0 || target >= newFields.length) return;
    [newFields[index], newFields[target]] = [newFields[target], newFields[index]];
    setFields(newFields);
    await fetch(`/api/admin/forms/${selectedFormId}/fields`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedFieldIds: newFields.map((f) => f.id) }),
    });
  }

  const selectedForm = forms.find((f) => f.id === selectedFormId);

  return (
    <div className="flex flex-col gap-8">
      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Forms</CardTitle>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">New form</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create form</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div>
                    <Label htmlFor="form-key">Key (unique, no spaces)</Label>
                    <Input id="form-key" value={createForm.key} onChange={(e) => setCreateForm({ ...createForm, key: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="form-title">Title</Label>
                    <Input id="form-title" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="form-desc">Description</Label>
                    <Input id="form-desc" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={saveForm}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24">No forms yet.</TableCell>
                </TableRow>
              ) : (
                forms.map((form) => (
                  <TableRow key={form.id} className={selectedFormId === form.id ? "bg-muted/50" : undefined}>
                    <TableCell className="font-medium">{form.title}</TableCell>
                    <TableCell className="font-mono text-sm">{form.key}</TableCell>
                    <TableCell>{form.fieldCount}</TableCell>
                    <TableCell>
                      <Badge variant={form.isActive ? "default" : "secondary"}>{form.isActive ? "Active" : "Inactive"}</Badge>
                    </TableCell>
                    <TableCell className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openFormFields(form.id)}>
                        Edit fields
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <a href={`/admin/forms/${form.id}/fill`}>Fill</a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedForm ? (
        <Card className={cardClass}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Fields for {selectedForm.title}</CardTitle>
              <Dialog open={addFieldOpen} onOpenChange={setAddFieldOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">Add field</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add field</DialogTitle>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    <div>
                      <Label htmlFor="field-key">Key</Label>
                      <Input id="field-key" value={fieldForm.fieldKey} onChange={(e) => setFieldForm({ ...fieldForm, fieldKey: e.target.value })} />
                    </div>
                    <div>
                      <Label htmlFor="field-label">Label</Label>
                      <Input id="field-label" value={fieldForm.label} onChange={(e) => setFieldForm({ ...fieldForm, label: e.target.value })} />
                    </div>
                    <div>
                      <Label>Type</Label>
                      <Select value={fieldForm.fieldType} onValueChange={(v) => setFieldForm({ ...fieldForm, fieldType: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {fieldForm.fieldType === "select" || fieldForm.fieldType === "multi_select" ? (
                      <div>
                        <Label htmlFor="field-options">Choices (comma-separated)</Label>
                        <Input
                          id="field-options"
                          placeholder="Small, Medium, Large"
                          value={fieldForm.optionsText}
                          onChange={(e) => setFieldForm({ ...fieldForm, optionsText: e.target.value })}
                        />
                      </div>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Switch checked={fieldForm.isRequired} onCheckedChange={(v) => setFieldForm({ ...fieldForm, isRequired: v })} />
                      <Label>Required</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={addField}>Add</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">No fields yet.</TableCell>
                  </TableRow>
                ) : (
                  fields.map((field, index) => (
                    <TableRow key={field.id}>
                      <TableCell className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => moveField(index, -1)}>
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === fields.length - 1} onClick={() => moveField(index, 1)}>
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                      </TableCell>
                      <TableCell>{field.label}</TableCell>
                      <TableCell className="font-mono text-sm">{field.fieldKey}</TableCell>
                      <TableCell>{field.fieldType}</TableCell>
                      <TableCell>{field.isRequired ? "Yes" : "No"}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeField(field.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
