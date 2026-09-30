"use client";

import { toast } from "sonner";
import { apiCall } from "@/lib/api-client";

// The Team Tasks page's writes. Each calls its route through apiCall, shows the route's error as a
// toast when it fails, and reports whether it worked so the caller can refresh.

async function send(url: string, method: string, body: unknown, failure: string): Promise<boolean> {
  const { ok, data } = await apiCall(url, { method, body });
  if (!ok) toast.error(data.error || failure);
  return ok;
}

export interface NewTaskFields {
  title: string;
  area: string;
  ownerId: string;
  dueOn?: string | null;
  notes?: string | null;
  addToToday?: boolean;
}

/** Makes a task. Output: the new task's id, or null when it failed. */
export async function createTask(fields: NewTaskFields): Promise<string | null> {
  const { ok, data } = await apiCall<{ id: string }>("/api/team/tasks", { method: "POST", body: fields });
  if (!ok) {
    toast.error(data.error || "Couldn't make the task");
    return null;
  }
  return data.id;
}

export function updateTask(taskId: string, patch: Record<string, unknown>): Promise<boolean> {
  return send(`/api/team/tasks/${taskId}`, "PATCH", patch, "Couldn't save that change");
}

/** Sets a person's plan for today, first to last. */
export function setTodayPlan(personnelId: string, taskIds: string[]): Promise<boolean> {
  return send("/api/team/plan", "PUT", { personnelId, taskIds }, "Couldn't save today's plan");
}

/** Sets the order of a person's open tasks, most important first. */
export function setQueueOrder(ownerId: string, taskIds: string[]): Promise<boolean> {
  if (taskIds.length === 0) return Promise.resolve(true);
  return send("/api/team/queue", "PUT", { ownerId, taskIds }, "Couldn't save the order");
}

export function addSubtask(taskId: string, fields: { title: string; ownerId?: string | null; dueOn?: string | null }): Promise<boolean> {
  return send(`/api/team/tasks/${taskId}/subtasks`, "POST", fields, "Couldn't add the subtask");
}

export function updateSubtask(subtaskId: string, patch: Record<string, unknown>): Promise<boolean> {
  return send(`/api/team/subtasks/${subtaskId}`, "PATCH", patch, "Couldn't save the subtask");
}

export function deleteSubtask(subtaskId: string): Promise<boolean> {
  return send(`/api/team/subtasks/${subtaskId}`, "DELETE", undefined, "Couldn't remove the subtask");
}

export function addLink(taskId: string, kind: "task" | "asset" | "artifact", id: string): Promise<boolean> {
  return send(`/api/team/tasks/${taskId}/links`, "POST", { kind, id }, "Couldn't add the link");
}

export function removeLink(linkId: string): Promise<boolean> {
  return send(`/api/team/links/${linkId}`, "DELETE", undefined, "Couldn't remove the link");
}

export function addComment(taskId: string, body: string, mentionedIds: string[]): Promise<boolean> {
  return send(`/api/team/tasks/${taskId}/comments`, "POST", { body, mentionedIds }, "Couldn't post the update");
}
