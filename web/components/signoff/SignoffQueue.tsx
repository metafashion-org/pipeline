"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, Trash2, Undo2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DriveImage } from "@/components/kanban/drive-image";
import { EditAssetDialog } from "@/components/kanban/EditAssetDialog";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatFee } from "@/lib/format-money";
import { parseDriveRefs } from "@/lib/assets/drive-links";
import { SENT_BACK, WAITING } from "@/lib/signoff/signoff-rules";
import type { KanbanAssetCard } from "@/lib/kanban/kanban-service";
import type { SignoffItem } from "@/lib/signoff/signoff-service";

// A sign-off item as it arrives over JSON: its dates are ISO strings.
type ItemView = Omit<SignoffItem, "submittedAt"> & { submittedAt: string };

interface SignoffResponse {
  items: ItemView[];
  viewerSignsOff: boolean;
  viewerId: string | null;
}

type Decision = { kind: "sendBack" | "drop"; item: ItemView } | null;

/**
 * The Sign-off page. Arjun sees everything waiting for him and approves it onto the board (one at a
 * time or several at once), sends it back with feedback, or drops it. Everyone else sees what's
 * waiting, and fixes and resubmits what was sent back to them.
 */
export function SignoffQueue() {
  const { data, error, isLoading, mutate } = useSWR<SignoffResponse>("/api/signoff", jsonFetcher);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decision, setDecision] = useState<Decision>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error || !data) return <p className="text-sm text-destructive">{error?.message ?? "Couldn't load sign-off"}</p>;

  const { items, viewerSignsOff, viewerId } = data;
  const waiting = items.filter((i) => i.state === WAITING);
  const sentBack = items.filter((i) => i.state === SENT_BACK);
  const mineSentBack = sentBack.filter((i) => i.submittedById === viewerId);

  async function run(action: () => Promise<{ ok: boolean; data: { error?: string } }>, success: string) {
    setWorking(true);
    try {
      const { ok, data: res } = await action();
      if (!ok) {
        toast.error(res.error || "That didn't work");
        return false;
      }
      toast.success(success);
      await mutate();
      return true;
    } finally {
      setWorking(false);
    }
  }

  const approve = (skus: string[]) =>
    run(() => apiCall("/api/signoff/approve", { method: "POST", body: { skus } }), skus.length === 1 ? `${skus[0]} is on the board` : `${skus.length} assets are on the board`).then(
      (ok) => ok && setSelected(new Set())
    );

  async function decide() {
    if (!decision) return;
    const sku = encodeURIComponent(decision.item.card.sku);
    const ok =
      decision.kind === "sendBack"
        ? await run(() => apiCall(`/api/signoff/${sku}/send-back`, { method: "POST", body: { feedback: note } }), `Sent back to ${decision.item.submittedByName ?? "whoever added it"}`)
        : await run(() => apiCall(`/api/signoff/${sku}/drop`, { method: "POST", body: { reason: note || null } }), `${decision.item.card.sku} dropped`);
    if (ok) {
      setDecision(null);
      setNote("");
    }
  }

  const resubmit = (item: ItemView) =>
    run(() => apiCall(`/api/signoff/${encodeURIComponent(item.card.sku)}/resubmit`, { method: "POST" }), `${item.card.sku} sent to Arjun again`);

  function toggle(sku: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }

  return (
    <div className="max-w-4xl space-y-8">
      {!viewerSignsOff && mineSentBack.length > 0 && (
        <Section title={`Sent back to you (${mineSentBack.length})`} hint="Make the changes, then resubmit it to Arjun.">
          {mineSentBack.map((item) => (
            <AssetRow key={item.card.sku} item={item} onEdited={() => mutate()}>
              <Button size="sm" onClick={() => resubmit(item)} disabled={working}>
                <Send className="h-3.5 w-3.5" /> Resubmit
              </Button>
            </AssetRow>
          ))}
        </Section>
      )}

      <Section
        title={viewerSignsOff ? `Waiting for you (${waiting.length})` : `Waiting for Arjun (${waiting.length})`}
        hint={viewerSignsOff ? "Approve puts it on the board in Unassigned. Whoever added it is told either way." : "These go on the board once Arjun signs them off."}
        action={
          viewerSignsOff && waiting.length > 0 ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(selected.size === waiting.length ? new Set() : new Set(waiting.map((i) => i.card.sku)))}>
                {selected.size === waiting.length ? "Clear" : "Select all"}
              </Button>
              <Button size="sm" onClick={() => approve([...selected])} disabled={working || selected.size === 0}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve {selected.size || ""} selected
              </Button>
            </div>
          ) : null
        }
      >
        {waiting.length === 0 && <p className="text-sm text-muted-foreground">Nothing is waiting.</p>}
        {waiting.map((item) => (
          <AssetRow
            key={item.card.sku}
            item={item}
            onEdited={() => mutate()}
            checkbox={viewerSignsOff ? { checked: selected.has(item.card.sku), onChange: () => toggle(item.card.sku) } : undefined}
          >
            {viewerSignsOff && (
              <>
                <Button size="sm" onClick={() => approve([item.card.sku])} disabled={working}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDecision({ kind: "sendBack", item })} disabled={working}>
                  <Undo2 className="h-3.5 w-3.5" /> Send back
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDecision({ kind: "drop", item })} disabled={working} aria-label={`Drop ${item.card.sku}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </AssetRow>
        ))}
      </Section>

      {(viewerSignsOff ? sentBack : sentBack.filter((i) => i.submittedById !== viewerId)).length > 0 && (
        <Section title="Sent back, waiting on changes" hint="These come back to the queue when they're resubmitted.">
          {(viewerSignsOff ? sentBack : sentBack.filter((i) => i.submittedById !== viewerId)).map((item) => (
            <AssetRow key={item.card.sku} item={item} onEdited={() => mutate()}>
              {viewerSignsOff && (
                <Button size="sm" variant="outline" onClick={() => resubmit(item)} disabled={working}>
                  Put back in my queue
                </Button>
              )}
            </AssetRow>
          ))}
        </Section>
      )}

      <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision?.kind === "sendBack" ? `Send ${decision.item.card.sku} back` : `Drop ${decision?.item.card.sku}`}</DialogTitle>
            <DialogDescription>
              {decision?.kind === "sendBack"
                ? `${decision.item.submittedByName ?? "Whoever added it"} gets this by email and Discord, makes the changes and resubmits it.`
                : "It's hidden from the board, not deleted, and can be put back from the board's Hidden cards."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={decision?.kind === "sendBack" ? "What to change" : "Why (optional)"}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button onClick={decide} disabled={working || (decision?.kind === "sendBack" && !note.trim())}>
              {decision?.kind === "sendBack" ? "Send back" : "Drop it"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function AssetRow({
  item,
  onEdited,
  checkbox,
  children,
}: {
  item: ItemView;
  onEdited: () => void;
  checkbox?: { checked: boolean; onChange: () => void };
  children?: React.ReactNode;
}) {
  const { card } = item;
  const cover = parseDriveRefs(card.referenceImages).find((ref) => ref.fileId);
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border bg-card p-3">
      {checkbox && <input type="checkbox" checked={checkbox.checked} onChange={checkbox.onChange} className="mt-1 h-4 w-4 accent-primary" aria-label={`Select ${card.sku}`} />}
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {cover?.fileId && <DriveImage fileId={cover.fileId} alt="" sizes="64px" className="object-cover" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium">{card.itemName}</p>
        <p className="text-xs text-muted-foreground">
          {card.sku}
          {card.category ? ` · ${card.category}` : ""}
          {card.brandGroupName ? ` · ${card.brandGroupName}` : ""}
          {card.feeAmount ? ` · ${formatFee(card.feeAmount, card.currency, "")}` : ""}
          {card.deadline ? ` · due ${formatDate(card.deadline)}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Added by {item.submittedByName ?? "someone"}, {formatDateTime(item.submittedAt)}
        </p>
        {item.state === SENT_BACK && item.feedback && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-sm">
            <Badge variant="outline" className="mr-1.5">
              Feedback
            </Badge>
            {item.feedback}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {/* The card's dates arrive as strings over JSON; EditAssetDialog reads them through new Date(). */}
        <EditAssetDialog asset={card as unknown as KanbanAssetCard} onSaved={onEdited} />
        {children}
      </div>
    </div>
  );
}
