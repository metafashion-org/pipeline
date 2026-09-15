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
import { Plus, Tags } from "lucide-react";

interface BrandGroupRow {
  id: string;
  name: string;
  robloxGroupUrl: string | null;
  sortOrder: number;
}

const EMPTY_FORM = { name: "", robloxGroupUrl: "" };

/**
 * Manages the list of Roblox creator groups/brands an asset can be assigned to for upload.
 * Fetches its own list via SWR instead of taking it as a prop — it's an independent section on
 * the Settings page, not wired into SettingsManager's existing status/rule/curation state.
 */
export function BrandGroupsManager() {
  const { data, mutate } = useSWR<{ brandGroups?: BrandGroupRow[] }>("/api/admin/brand-groups", jsonFetcher);
  const { mutate: globalMutate } = useSWRConfig();
  const groups = data?.brandGroups ?? [];

  const [form, setForm] = useState(EMPTY_FORM);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function saveGroup() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const { ok, data } = await apiCall<{ brandGroup: BrandGroupRow }>("/api/admin/brand-groups", {
        method: "POST",
        body: { name: form.name, robloxGroupUrl: form.robloxGroupUrl.trim() || undefined },
      });
      if (!ok) {
        toast.error(data.error || "Failed to save group");
        return;
      }
      toast.success(`Group '${data.brandGroup.name}' saved`);
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      mutate();
      // Every asset form's own group picker also reads this same endpoint — refresh it too, so a
      // group created here shows up without those components needing a manual page reload.
      globalMutate("/api/admin/brand-groups");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-4 w-4" /> Upload Groups / Brands
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add Group
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Add Upload Group</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="brand-group-name">Name</Label>
                <Input
                  id="brand-group-name"
                  placeholder="Meta Fashion Studio"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="brand-group-url">Roblox group URL (optional)</Label>
                <Input
                  id="brand-group-url"
                  placeholder="https://www.roblox.com/groups/..."
                  value={form.robloxGroupUrl}
                  onChange={(e) => setForm((f) => ({ ...f, robloxGroupUrl: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveGroup} disabled={submitting}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No upload groups yet. Add one so it can be assigned to assets.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Roblox Group</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    {g.robloxGroupUrl ? (
                      <a href={g.robloxGroupUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                        {g.robloxGroupUrl}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
