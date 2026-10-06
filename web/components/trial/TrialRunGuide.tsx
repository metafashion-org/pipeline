"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Circle, Bot, Mail, MessageSquare, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { cn } from "@/lib/utils";

interface TrialResponse {
  trial: { sku: string; status: string; reached: string[] } | null;
}

// How often the page re-reads the trial asset, so a step ticks itself off soon after it happens.
const REFRESH_MS = 4_000;

interface Step {
  /** The status the test asset reaches when this step is done. */
  reaches: string;
  who: "you" | "bot" | "arjun";
  title: string;
  /** What to click, for a step that's yours. */
  how?: React.ReactNode;
  /** What arrives, and where. */
  notices: { channel: "email" | "discord"; text: string }[];
}

// The pipeline, in order. "As the artist" notices go to the trial artist, whose email
// (jsingh+trial@metafashion.in) is Jayesh's inbox and whose Discord messages are Jayesh's DMs.
const STEPS: Step[] = [
  {
    reaches: "assigned",
    who: "you",
    title: "Assign the test asset to the bot",
    how: (
      <>
        Open the <Link href="/admin/board" className="underline">Board</Link>, find <b>TRIAL - End-to-end test hat</b> in Unassigned, open it and click{" "}
        <b>Assign</b>. Pick <b>Trial Artist (bot)</b>, any deadline, fee ₹1, and send the offer.
      </>
    ),
    notices: [
      { channel: "email", text: "As the artist: \"New offer: TRIAL - End-to-end test hat\"" },
      { channel: "discord", text: "As the artist: a DM, \"you have a new asset offer\"" },
    ],
  },
  {
    reaches: "in_review",
    who: "bot",
    title: "The bot accepts, works on it, and sends it for review",
    notices: [
      { channel: "email", text: "As the artist: the full brief, once the offer is accepted" },
      { channel: "email", text: "As a reviewer: \"Ready for review: TRIAL - End-to-end test hat from Trial Artist (bot)\"" },
      { channel: "discord", text: "In #office: \"Trial Artist (bot) sent TRIAL - End-to-end test hat for review\", pinging the reviewers" },
    ],
  },
  {
    reaches: "revisions_requested",
    who: "you",
    title: "Ask for changes",
    how: (
      <>
        On the Board, move the card from <b>In Review</b> to <b>Revisions Requested</b>. The bot makes the changes and sends it back for review a few
        seconds later.
      </>
    ),
    notices: [
      { channel: "email", text: "As the artist: \"Changes requested: TRIAL - End-to-end test hat\"" },
      { channel: "discord", text: "As the artist: a DM, \"the team asked for changes on your asset\"" },
      { channel: "email", text: "As a reviewer: \"Ready for review\" again once the bot resends it" },
    ],
  },
  {
    reaches: "approved",
    who: "you",
    title: "Approve it",
    how: (
      <>
        Once it's back in <b>In Review</b>, move it to <b>Approved</b>. The bot hands in a test .zip a few seconds later, which moves the card to{" "}
        <b>Ready for Upload</b>.
      </>
    ),
    notices: [
      { channel: "email", text: "As the artist: \"Approved: ... Hand in your final files\"" },
      { channel: "discord", text: "As the artist: a DM, \"your asset was approved. Hand in the final files\"" },
    ],
  },
  {
    reaches: "ready_for_upload",
    who: "bot",
    title: "The bot hands in the final files",
    notices: [
      { channel: "email", text: "As the uploader: \"Ready to upload: TRIAL - End-to-end test hat\", with the Drive folder of the .zip" },
      { channel: "discord", text: "In #office: \"TRIAL - End-to-end test hat is ready to upload to Roblox\", pinging you" },
    ],
  },
  {
    reaches: "uploaded_to_roblox",
    who: "you",
    title: "Add the Roblox link",
    how: (
      <>
        Open the <Link href="/publisher" className="underline">Uploader Queue</Link>, find the trial asset, paste any Roblox catalog link (for example
        an existing item of ours) and save.
      </>
    ),
    notices: [
      { channel: "email", text: "As the artist: \"Live on Roblox: TRIAL - End-to-end test hat\", with the link" },
      { channel: "discord", text: "As the artist: a DM, \"your asset is live on Roblox\"" },
    ],
  },
  {
    reaches: "marked_for_payment",
    who: "you",
    title: "Mark it for payment",
    how: (
      <>
        On the Board, move the card from <b>Uploaded to Roblox</b> to <b>Marked for Payment</b>.
      </>
    ),
    notices: [],
  },
  {
    reaches: "payment_done",
    who: "arjun",
    title: "Pay it (Arjun or a payment admin)",
    how: (
      <>
        On <b>Payments</b>, find <b>Trial Artist (bot)</b> and attach any PDF as the payment summary. Only admins and payment admins can mark a payment
        done, so this one is Arjun&apos;s; it can be done any time after.
      </>
    ),
    notices: [
      { channel: "email", text: "As the artist: \"Paid: 1 asset, ₹1.00\"" },
      { channel: "discord", text: "As the artist: a DM, \"you've been paid ₹1.00\"" },
    ],
  },
];

const WHO_LABEL = { you: "Your step", bot: "The bot does this", arjun: "Arjun's step" } as const;

/**
 * The Trial run page: start a trial, follow each step, and see each one tick itself off as the test
 * asset moves. Says what to click and which email and Discord message to expect at each step.
 */
export function TrialRunGuide() {
  const { data, mutate } = useSWR<TrialResponse>("/api/trial", jsonFetcher, { refreshInterval: REFRESH_MS });
  const [working, setWorking] = useState(false);
  const trial = data?.trial ?? null;
  const reached = new Set(trial?.reached ?? []);
  const nextIndex = STEPS.findIndex((s) => !reached.has(s.reaches));

  async function act(action: "start" | "end") {
    if (action === "end" && !window.confirm("End the trial? The test asset is hidden from the board and the bot is switched off.")) return;
    setWorking(true);
    try {
      const { ok, data: res } = await apiCall<{ sku?: string }>("/api/trial", { method: "POST", body: { action } });
      if (!ok) return toast.error(res.error || "That didn't work");
      toast.success(action === "start" ? `Trial started: ${res.sku} is in Unassigned` : "Trial ended");
      await mutate();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6 text-sm">
      <section className="rounded-lg border bg-card p-4 space-y-2">
        <h2 className="text-base font-semibold">How it works</h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            A bot, <b>Trial Artist (bot)</b>, plays the artist. A few seconds after you do your part, it does the artist&apos;s: accepts the offer, sends the
            work for review, makes changes when asked, and hands in a test .zip.
          </li>
          <li>
            Everything a real artist would get comes to you: emails at <b>jsingh+trial@metafashion.in</b> (your inbox) and Discord DMs from the bot.
          </li>
          <li>Each step below ticks itself off when it happens. Nothing here touches real artists or real payments; the fee is ₹1.</li>
        </ul>
        <div className="flex gap-2 pt-2">
          {trial ? (
            <>
              <span className="self-center">
                Test asset: <b className="font-mono">{trial.sku}</b>
              </span>
              <Button size="sm" variant="outline" className="ml-auto" onClick={() => act("end")} disabled={working}>
                <Square className="h-3.5 w-3.5" /> End the trial
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => act("start")} disabled={working}>
              <Play className="h-3.5 w-3.5" /> {working ? "Starting..." : "Start a trial"}
            </Button>
          )}
        </div>
      </section>

      {trial && (
        <ol className="space-y-3">
          {STEPS.map((step, index) => {
            const done = reached.has(step.reaches);
            const current = index === nextIndex;
            return (
              <li key={step.reaches} className={cn("rounded-lg border p-4 space-y-2", current && "border-primary", done && "opacity-70")}>
                <div className="flex items-start gap-2">
                  {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {index + 1}. {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {step.who === "bot" ? <Bot className="mr-1 inline h-3 w-3" /> : null}
                      {WHO_LABEL[step.who]}
                      {current && !done ? " · next" : ""}
                    </p>
                  </div>
                </div>
                {step.how && <p className="pl-6">{step.how}</p>}
                {step.notices.length > 0 && (
                  <ul className="space-y-1 pl-6">
                    {step.notices.map((n) => (
                      <li key={n.text} className="flex items-start gap-1.5 text-muted-foreground">
                        {n.channel === "email" ? <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        {n.text}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
