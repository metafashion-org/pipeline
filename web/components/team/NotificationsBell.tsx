"use client";

import useSWR from "swr";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import type { NotificationView } from "./team-types";

const NOTIFICATIONS_URL = "/api/team/notifications";

/**
 * The caller's Team Tasks notifications: mentions and tasks given to them. Opening the list marks
 * them read. The same notices also went out by email and in the office Discord channel.
 */
export function NotificationsBell({ unread, onOpenTask, onRead }: { unread: number; onOpenTask: (taskId: string) => void; onRead: () => void }) {
  const { data, mutate } = useSWR<{ notifications: NotificationView[] }>(NOTIFICATIONS_URL, jsonFetcher);

  async function handleOpenChange(open: boolean) {
    if (!open || unread === 0) return;
    const { ok } = await apiCall(NOTIFICATIONS_URL, { method: "POST" });
    if (ok) {
      await mutate();
      onRead();
    }
  }

  return (
    <Popover onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative h-8" aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}>
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-b px-3 py-2 text-sm font-medium">Notifications</p>
        <ul className="max-h-80 overflow-y-auto">
          {(data?.notifications ?? []).length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">Nothing yet.</li>}
          {data?.notifications.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                disabled={!n.taskId}
                onClick={() => n.taskId && onOpenTask(n.taskId)}
                className={cn("block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-muted", !n.readAt && "bg-primary/5")}
              >
                <span className="block">{n.message}</span>
                <span className="block text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
