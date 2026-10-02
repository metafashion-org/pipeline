"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";
import { useViewerCapabilities } from "@/components/providers/ViewerProvider";

/**
 * For admins: makes the office Discord channel if it isn't there yet, gives the full-time team
 * access, and opens it. Team Tasks posts mentions and the 7 pm summary there.
 */
export function OfficeChannelButton() {
  const caps = useViewerCapabilities();
  const [working, setWorking] = useState(false);
  if (!caps.canManageSystemConfig) return null;

  async function open() {
    setWorking(true);
    try {
      const { ok, data } = await apiCall<{ url: string; withoutDiscord: string[] }>("/api/team/office-channel", { method: "POST" });
      if (!ok) {
        toast.error(data.error || "Couldn't set up the office channel");
        return;
      }
      toast.success(
        data.withoutDiscord.length > 0
          ? `Office channel ready. No Discord linked for: ${data.withoutDiscord.join(", ")}.`
          : "Office channel ready, with the whole team in it."
      );
      window.open(data.url, "_blank", "noopener,noreferrer");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Button variant="outline" size="sm" className="h-8" onClick={open} disabled={working} title="Open the office channel on Discord">
      <MessageSquare className="h-4 w-4" /> {working ? "Setting up..." : "#office"}
    </Button>
  );
}
