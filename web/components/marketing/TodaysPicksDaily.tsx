"use client";

import useSWR from "swr";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import type { DailySettings } from "@/lib/marketing/todays-picks-daily";

const DAILY_URL = "/api/admin/marketing/todays-picks/daily";

/**
 * The daily automation switches: the Roblox check and the marketing email, both run at 19:00 India
 * time and both off until Arjun turns them on. The preview renders today's email without sending it.
 */
export function TodaysPicksDaily() {
  const { data, mutate } = useSWR<DailySettings & { recipients: string[] }>(DAILY_URL, jsonFetcher, { revalidateOnFocus: false });
  if (!data) return null;

  async function flip(key: "checkEnabled" | "emailEnabled" | "namingEnabled", value: boolean) {
    const label = key === "checkEnabled" ? "daily Roblox check" : key === "emailEnabled" ? "daily marketing email" : "daily AI naming";
    if (value && !window.confirm(`Turn on the ${label}? It runs every day at 19:00 India time until you turn it off.`)) return;
    const { ok, data: res } = await apiCall<{ error?: string }>(DAILY_URL, { method: "PUT", body: { [key]: value } });
    if (!ok) toast.error(res.error || "Couldn't change it");
    else toast.success(`${label} ${value ? "on" : "off"}`);
    await mutate();
  }

  const last = data.lastCheck;
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3 text-xs">
      <h2 className="text-sm font-semibold">Daily automation (19:00 India time)</h2>
      <label className="flex items-center gap-2">
        <Switch checked={data.checkEnabled} onCheckedChange={(v) => flip("checkEnabled", v)} />
        Check every live listing on Roblox, signed out, one request a second. Records what Roblox shows; never changes your ticks.
      </label>
      <p className="pl-11 text-muted-foreground">
        {last ? `Last run ${last.day}: ${last.checked} checked, ${last.failed} failed${last.stoppedEarly ? ", stopped by Roblox" : ""}.` : "Hasn't run yet."}
        {data.failedCheckRuns > 0 && ` ${data.failedCheckRuns} failed run(s) in a row; it turns itself off after 3.`}
      </p>
      <label className="flex items-center gap-2">
        <Switch checked={data.namingEnabled} onCheckedChange={(v) => flip("namingEnabled", v)} />
        Suggest names with Claude for items at Ready for upload (new or changed inputs only; at most 24 a day).
      </label>
      <label className="flex items-center gap-2">
        <Switch checked={data.emailEnabled} onCheckedChange={(v) => flip("emailEnabled", v)} />
        Email the day&apos;s marketing summary to {data.recipients.join(", ")}.
      </label>
      <a href={`${DAILY_URL}?preview=email`} target="_blank" rel="noopener noreferrer" className="pl-11 text-primary hover:underline">
        Preview today&apos;s email (not sent) <ExternalLink className="inline h-3 w-3" />
      </a>
    </section>
  );
}
