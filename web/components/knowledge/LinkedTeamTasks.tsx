"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { ListChecks } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";
import { statusLabel, TEAM_TASK_AREAS } from "@/lib/team-tasks/task-rules";
import { useViewerCapabilities, useViewerPersonnelId } from "@/components/providers/ViewerProvider";

interface LinkedTask {
  id: string;
  title: string;
  status: string;
  ownerName: string;
}

/**
 * The Team Tasks that came from a Registry artifact, e.g. the hiring work an insight turned into,
 * and a way to make one from it. The new task is the viewer's, linked to the artifact; it can be
 * given to someone else on Team Tasks.
 */
export function LinkedTeamTasks({ artifactId, artifactTitle }: { artifactId: string; artifactTitle: string }) {
  const caps = useViewerCapabilities();
  const personnelId = useViewerPersonnelId();
  const { data, mutate } = useSWR<{ tasks: LinkedTask[] }>(`/api/admin/knowledge/artifacts/${artifactId}/tasks`, jsonFetcher);
  const [making, setMaking] = useState(false);
  const [title, setTitle] = useState(artifactTitle);
  const [area, setArea] = useState("");
  const [saving, setSaving] = useState(false);

  async function make() {
    if (!personnelId) return;
    if (!title.trim() || !area) {
      toast.error("Give the task a title and pick what kind it is");
      return;
    }
    setSaving(true);
    try {
      const { ok, data: result } = await apiCall<{ id: string }>("/api/team/tasks", {
        method: "POST",
        body: { title, area, ownerId: personnelId, artifactIds: [artifactId] },
      });
      if (!ok) {
        toast.error(result.error || "Couldn't make the task");
        return;
      }
      toast.success("Task made on Team Tasks");
      setMaking(false);
      await mutate();
    } finally {
      setSaving(false);
    }
  }

  const tasks = data?.tasks ?? [];
  if (!caps.canUseTeamTasks && tasks.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">Team Tasks from this</p>
      {tasks.length === 0 && !making && <p className="text-sm text-muted-foreground">None yet.</p>}
      <ul className="space-y-1">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2 text-sm">
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Link href={`/team?task=${task.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {task.title}
            </Link>
            <span className="shrink-0 text-xs text-muted-foreground">
              {task.ownerName} · {statusLabel(task.status)}
            </span>
          </li>
        ))}
      </ul>
      {caps.canUseTeamTasks && !making && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMaking(true)}>
          Make a task from this
        </Button>
      )}
      {making && (
        <div className="space-y-2 rounded-md border p-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 text-sm" aria-label="Task title" />
          <div className="flex flex-wrap gap-1.5">
            {TEAM_TASK_AREAS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setArea(a.key)}
                className={cn("rounded-full border px-2 py-0.5 text-xs", area === a.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMaking(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={make} disabled={saving}>
              {saving ? "Making..." : "Make task"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
