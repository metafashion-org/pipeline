"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// Manually triggers the payment cycle pull (POST /api/admin/payment-cycles/run),
// then refreshes the server-rendered archive page so the new cycle shows up.
// Useful when the real cron isn't wired up in this environment, and for testing.
export function RunPaymentPullButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/payment-cycles/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to run payment cycle pull");
        return;
      }
      if (data.result?.skipped) {
        toast.info(data.result.reason);
      } else {
        toast.success(`Pulled ${data.result.itemCount} pending payment(s) into a new cycle`);
      }
      router.refresh();
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button size="sm" variant="outline" disabled={running} onClick={run}>
      {running ? "Running..." : "Run pull now"}
    </Button>
  );
}
