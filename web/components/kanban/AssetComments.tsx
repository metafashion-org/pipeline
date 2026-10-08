"use client";

import useSWR from "swr";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";
import { LinkifiedText } from "@/components/LinkifiedText";
import { MentionInput } from "@/components/team/MentionInput";

interface CommentsResponse {
  comments: { id: string; body: string; authorName: string | null; createdAt: string }[];
  people: { id: string; name: string; freelancer: boolean }[];
}

/**
 * The card's comment thread: notes and issues on this asset. Typing @ mentions the full-time team
 * or a freelancer; the team is told in the bell, by email and in #office, a freelancer by email and
 * in their own Discord channel. Staff only: the route answers 403 for anyone who can't see every asset.
 */
export function AssetComments({ sku, enabled }: { sku: string; enabled: boolean }) {
  const url = `/api/assets/${encodeURIComponent(sku)}/comments`;
  const { data, mutate } = useSWR<CommentsResponse>(enabled ? url : null, jsonFetcher, { shouldRetryOnError: false });
  if (!data) return null;

  const people = data.people.map((p) => ({ id: p.id, name: p.name, note: p.freelancer ? "Freelancer" : undefined }));

  async function post(body: string, mentionedIds: string[]): Promise<boolean> {
    const { ok, data: res } = await apiCall(url, { method: "POST", body: { body, mentionedIds } });
    if (!ok) {
      toast.error(res.error || "Couldn't post the comment");
      return false;
    }
    if (mentionedIds.length > 0) toast.success(`Posted and notified ${mentionedIds.length} ${mentionedIds.length === 1 ? "person" : "people"}`);
    await mutate();
    return true;
  }

  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <MessageSquare className="h-3.5 w-3.5" /> Comments{data.comments.length > 0 ? ` (${data.comments.length})` : ""}
      </h4>
      <div className="space-y-2 rounded-md bg-muted/30 p-3">
        {data.comments.length > 0 && (
          <ul className="space-y-2">
            {data.comments.map((comment) => (
              <li key={comment.id} className="rounded-md bg-muted/40 p-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  {comment.authorName ?? "Someone"} · {formatDateTime(comment.createdAt)}
                </p>
                <p className="whitespace-pre-wrap break-words">
                  <LinkifiedText text={comment.body} />
                </p>
              </li>
            ))}
          </ul>
        )}
        <MentionInput members={people} onPost={post} />
      </div>
    </section>
  );
}
