"use client";

import { useState } from "react";
import useSWR from "swr";
import { FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDate } from "@/lib/format-date";
import { ARTIST_DETAIL_KEYS, ARTIST_DOCUMENT_KINDS, ARTIST_FIELD_LABELS, type ArtistDetailsInput } from "@/lib/artist-details/details-rules";

interface TeamArtistRow {
  id: string;
  name: string;
  email: string;
  state: "missing" | "imported" | "saved";
  maskedAccount: string | null;
  maskedUpi: string | null;
  submittedAt: string | null;
  pendingChanges: number;
  hasDiscord: boolean;
}

interface StoredFile {
  id: string;
  kind: string;
  fileName: string;
}

interface RevealResponse {
  artist: { id: string; name: string; email: string };
  details: ArtistDetailsInput;
  files: StoredFile[];
  pendingChange: { id: string; fields: string[]; reason: string; createdAt: string } | null;
  pendingValues: Partial<ArtistDetailsInput> | null;
}

interface RemindResponse {
  results: { name: string; discord: boolean; email: boolean }[];
  wording: { fresh: string; prefilled: string };
}

const STATE_LABEL: Record<TeamArtistRow["state"], string> = { saved: "Filled in", imported: "Form copied, not checked", missing: "Not filled in" };
const FILE_COLUMNS = new Set<keyof ArtistDetailsInput>(ARTIST_DOCUMENT_KINDS.map((d) => d.column));

/** A field's value for display: a document's file name, or the text. */
function shown(key: keyof ArtistDetailsInput, value: string | null | undefined, files: StoredFile[]): string {
  if (!value) return "—";
  if (FILE_COLUMNS.has(key)) return files.find((f) => f.id === value)?.fileName ?? "New document";
  return value;
}

/** The artists list, the full-details sheet with approve and decline, and the reminder to artists who haven't filled it in. */
export function ArtistDetailsAdmin() {
  const { data, error, isLoading, mutate } = useSWR<{ artists: TeamArtistRow[] }>("/api/admin/artist-details", jsonFetcher);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<RemindResponse | null>(null);
  const [sending, setSending] = useState(false);

  async function previewReminder() {
    const { ok, data: res } = await apiCall<RemindResponse>("/api/admin/artist-details/remind", { method: "POST", body: { dryRun: true } });
    if (!ok) return toast.error(res.error || "Couldn't check who to remind");
    setPreview(res);
  }

  async function sendReminder() {
    setSending(true);
    try {
      const { ok, data: res } = await apiCall<RemindResponse>("/api/admin/artist-details/remind", { method: "POST", body: { dryRun: false } });
      if (!ok) return toast.error(res.error || "Couldn't send the reminder");
      const missed = res.results.filter((r) => !r.discord).map((r) => r.name);
      toast.success(`Reminded ${res.results.length} artists.${missed.length ? ` No Discord for: ${missed.join(", ")}.` : ""}`);
      setPreview(null);
    } finally {
      setSending(false);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading...</p>;
  if (error || !data) return <p className="text-sm text-destructive">{error?.message ?? "Couldn't load artists"}</p>;

  const notDone = data.artists.filter((a) => a.state !== "saved").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.artists.length - notDone} of {data.artists.length} active artists have filled in their details.
        </p>
        <Button variant="outline" size="sm" onClick={previewReminder} disabled={notDone === 0}>
          <Send className="h-4 w-4" /> Remind the {notDone} who haven&apos;t
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artist</TableHead>
            <TableHead>Details</TableHead>
            <TableHead>Account</TableHead>
            <TableHead>UPI</TableHead>
            <TableHead>Change waiting</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.artists.map((a) => (
            <TableRow key={a.id} className="cursor-pointer" onClick={() => setOpenId(a.id)}>
              <TableCell>
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted-foreground">{a.email}</div>
              </TableCell>
              <TableCell>
                <Badge variant={a.state === "saved" ? "secondary" : "outline"}>{STATE_LABEL[a.state]}</Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{a.maskedAccount ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{a.maskedUpi ?? "—"}</TableCell>
              <TableCell>{a.pendingChanges > 0 ? <Badge className="bg-amber-500 text-white">Needs approval</Badge> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {openId && <ArtistSheet personnelId={openId} onClose={() => setOpenId(null)} onDecided={() => mutate()} />}

      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Remind {preview?.results.length ?? 0} artists</DialogTitle>
            <DialogDescription>Each gets this on Discord. Those whose onboarding-form documents were copied also get an email asking them to check.</DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="space-y-3 text-sm max-h-[60vh] overflow-auto">
              <p className="text-xs text-muted-foreground">Artists with nothing copied from the form:</p>
              <p className="rounded-md border p-3 whitespace-pre-wrap">{preview.wording.fresh}</p>
              <p className="text-xs text-muted-foreground">Artists whose form documents were copied:</p>
              <p className="rounded-md border p-3 whitespace-pre-wrap">{preview.wording.prefilled}</p>
              <ul className="text-xs space-y-0.5">
                {preview.results.map((r) => (
                  <li key={r.name}>
                    {r.name}
                    {r.discord ? "" : " (no Discord linked, not reached there)"}
                    {r.email ? ", plus email" : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button onClick={sendReminder} disabled={sending}>
              {sending ? "Sending..." : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ArtistSheet({ personnelId, onClose, onDecided }: { personnelId: string; onClose: () => void; onDecided: () => void }) {
  const { data, error, mutate } = useSWR<RevealResponse>(`/api/admin/artist-details/${personnelId}`, jsonFetcher, { revalidateOnFocus: false });
  const [note, setNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  async function decide(approve: boolean) {
    if (!data?.pendingChange) return;
    setDeciding(true);
    try {
      const { ok, data: res } = await apiCall(`/api/admin/artist-details/changes/${data.pendingChange.id}`, { method: "POST", body: { approve, note: note || null } });
      if (!ok) return toast.error(res.error || "Couldn't save the decision");
      toast.success(approve ? "Approved. The artist's details are updated." : "Declined. The artist has been told.");
      setNote("");
      await mutate();
      onDecided();
    } finally {
      setDeciding(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-auto">
        <SheetHeader>
          <SheetTitle>{data?.artist.name ?? "Artist"}</SheetTitle>
          <SheetDescription>{data?.artist.email}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6 space-y-5 text-sm">
          {error && <p className="text-destructive">{error.message}</p>}
          {!data && !error && <p className="text-muted-foreground">Loading...</p>}
          {data?.pendingChange && data.pendingValues && (
            <section className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
              <p className="font-medium">Change requested {formatDate(data.pendingChange.createdAt)}</p>
              <p>Reason: {data.pendingChange.reason}</p>
              <table className="w-full text-xs">
                <tbody>
                  {(Object.keys(data.pendingValues) as (keyof ArtistDetailsInput)[]).map((key) => (
                    <tr key={key} className="align-top">
                      <td className="pr-2 py-0.5 text-muted-foreground">{ARTIST_FIELD_LABELS[key]}</td>
                      <td className="pr-2 py-0.5 line-through break-all">{shown(key, data.details[key], data.files)}</td>
                      <td className="py-0.5 font-medium break-all">{shown(key, data.pendingValues![key], data.files)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Textarea rows={2} placeholder="Note to the artist (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => decide(true)} disabled={deciding}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={deciding}>
                  Decline
                </Button>
              </div>
            </section>
          )}
          {data && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {ARTIST_DETAIL_KEYS.filter((k) => !FILE_COLUMNS.has(k)).map((key) => (
                  <div key={key} className="contents">
                    <dt className="text-muted-foreground">{ARTIST_FIELD_LABELS[key]}</dt>
                    <dd className="font-mono break-all">
                      {key === "ndaUrl" && data.details.ndaUrl ? (
                        <a href={data.details.ndaUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {data.details.ndaUrl}
                        </a>
                      ) : (
                        shown(key, data.details[key], data.files)
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              <section className="space-y-1">
                <h3 className="font-medium">Documents</h3>
                {ARTIST_DOCUMENT_KINDS.map((doc) => {
                  const id = data.details[doc.column];
                  const file = data.files.find((f) => f.id === id);
                  return (
                    <div key={doc.key} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{doc.label}</span>
                      {file ? (
                        <a href={`/api/artist/details/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary hover:underline max-w-48 truncate">
                          <FileText className="h-4 w-4 shrink-0" /> {file.fileName}
                        </a>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  );
                })}
              </section>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
