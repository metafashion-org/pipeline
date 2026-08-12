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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface CurationFieldRow {
  fieldKey: string;
  displayName: string;
  includeInArtistEmail: boolean;
  sortOrder: number;
}

export function CurationFieldSelector({ initialFields }: { initialFields: CurationFieldRow[] }) {
  const [fields, setFields] = useState(initialFields);

  async function toggleField(fieldKey: string, includeInArtistEmail: boolean) {
    // Optimistic update, rolled back on failure
    setFields((prev) => prev.map((f) => (f.fieldKey === fieldKey ? { ...f, includeInArtistEmail } : f)));

    const res = await fetch("/api/admin/curation-fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldKey, includeInArtistEmail }),
    });
    const data = await res.json();

    if (!res.ok) {
      setFields((prev) => prev.map((f) => (f.fieldKey === fieldKey ? { ...f, includeInArtistEmail: !includeInArtistEmail } : f)));
      toast.error(data.error || "Failed to update field");
      return;
    }

    toast.success(`'${data.field.displayName}' ${includeInArtistEmail ? "will now" : "will no longer"} appear in assignment emails`);
  }

  return (
    <section>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Field</TableHead>
            <TableHead>Include in Artist Email</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.length === 0 && (
            <TableRow>
              <TableCell colSpan={2} className="text-center text-muted-foreground py-6">
                No curation fields configured yet.
              </TableCell>
            </TableRow>
          )}
          {fields.map((field) => (
            <TableRow key={field.fieldKey}>
              <TableCell>{field.displayName}</TableCell>
              <TableCell>
                <Switch
                  checked={field.includeInArtistEmail}
                  onCheckedChange={(checked) => toggleField(field.fieldKey, checked)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
