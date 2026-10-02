"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Sheet as SheetIcon, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";

interface TaskSheetResponse {
  sheet: { url: string; email: string } | null;
  lastSync: string | null;
}

/**
 * The Google Sheet Instinct (the AI assistant) writes rows in to add Team Tasks. Setting it up
 * makes the sheet in the shared drive and shares it with Instinct's email as an editor.
 */
export function TaskSheetManager() {
  const { data, mutate } = useSWR<TaskSheetResponse>("/api/admin/task-sheet", jsonFetcher);
  const [name, setName] = useState("Instinct AI");
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);

  async function setUp() {
    setWorking(true);
    try {
      const { ok, data: res } = await apiCall("/api/admin/task-sheet", { method: "POST", body: { name, email } });
      if (!ok) return toast.error(res.error || "Couldn't make the sheet");
      toast.success("Sheet made and shared");
      await mutate();
    } finally {
      setWorking(false);
    }
  }

  async function syncNow() {
    setWorking(true);
    try {
      const { ok, data: res } = await apiCall<{ added: number; errors: number; artifactsAdded: number; artifactErrors: number }>("/api/admin/task-sheet/sync", {
        method: "POST",
      });
      if (!ok) return toast.error(res.error || "Couldn't read the sheet");
      const failed = res.errors + res.artifactErrors;
      toast.success(`Added ${res.added} task(s) and ${res.artifactsAdded} artifact(s)${failed ? `. ${failed} row(s) have errors; see the sheet` : ""}`);
      await mutate();
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SheetIcon className="h-4 w-4" /> Task and artifact sheet for Instinct
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Instinct writes rows in two tabs: Tasks (title, owner, area, dueOn, notes) adds Team Tasks, and Artifacts (type, title and the
          type&apos;s fields) adds to the Registry. The Kanban reads new rows when anyone opens Team Tasks (at most once a minute) and at 7 pm,
          and writes &quot;Added&quot; or the error in each row&apos;s status column.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {data?.sheet ? (
          <>
            <p>
              <a href={data.sheet.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Open the task sheet
              </a>{" "}
              · shared with {data.sheet.email}
            </p>
            <p className="text-muted-foreground">Last read: {formatDateTime(data.lastSync, "never")}</p>
            <Button size="sm" variant="outline" onClick={syncNow} disabled={working}>
              <RefreshCw className="h-4 w-4" /> Read it now
            </Button>
          </>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="sheet-name">Name</Label>
              <Input id="sheet-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sheet-email">Its email</Label>
              <Input id="sheet-email" value={email} placeholder="assistant@example.com" onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button onClick={setUp} disabled={working || !name.trim() || !email.trim()}>
              {working ? "Making..." : "Make and share the sheet"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
