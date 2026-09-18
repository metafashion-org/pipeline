"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { toast } from "sonner";
import { Plus, LayoutGrid } from "lucide-react";

interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * Manages the list an asset's Category field is picked from.
 * Fetches its own list via SWR instead of taking it as a prop — it's an independent section on
 * the Settings page, same as BrandGroupsManager.
 */
export function CategoriesManager() {
  const { data, mutate } = useSWR<{ categories?: CategoryRow[] }>("/api/admin/categories", jsonFetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const rows = data?.categories ?? [];

  const [name, setName] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function saveCategory() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ category: CategoryRow }>("/api/admin/categories", {
        method: "POST",
        body: { name },
      });
      if (!ok) {
        toast.error(data.error || "Failed to save category");
        return;
      }
      toast.success(`Category '${data.category.name}' saved`);
      setDialogOpen(false);
      setName("");
      mutate();
      // The asset form's own Category picker reads this same endpoint — refresh it too, so a
      // category created here shows up without that component needing a manual page reload.
      globalMutate("/api/admin/categories");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <LayoutGrid className="h-4 w-4" /> Categories
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Category
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Add Category</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="category-name">Name</Label>
                <Input
                  id="category-name"
                  placeholder="Hair (wigs, hairstyles, hairpieces)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveCategory} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No categories yet. Add one so it can be assigned to assets.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
