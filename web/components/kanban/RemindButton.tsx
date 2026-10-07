"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";

/**
 * Sends a reminder for one card or a whole column: the artist on an Approved card (hand in the
 * final files), the uploaders on a Ready for Upload card (add the Roblox links). Discord and email.
 */
export function RemindButton({ skus, label }: { skus: string[]; label: string }) {
  const [sending, setSending] = useState(false);

  async function remind() {
    setSending(true);
    try {
      const { ok, data } = await apiCall<{ results: { sku: string; sent: string | null }[] }>("/api/assets/remind", { method: "POST", body: { skus } });
      if (!ok) {
        toast.error(data.error || "Couldn't send the reminder");
        return;
      }
      const sent = data.results.filter((r) => r.sent).length;
      toast.success(sent === 0 ? "Nothing to remind about here" : `Reminder sent for ${sent} card${sent === 1 ? "" : "s"}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={sending || skus.length === 0} onClick={remind}>
      <BellRing className="h-3.5 w-3.5" /> {sending ? "Sending..." : label}
    </Button>
  );
}
