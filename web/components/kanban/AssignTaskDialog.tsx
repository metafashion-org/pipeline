"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { UserPlus } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { jsonFetcher } from "@/lib/fetcher";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import Link from "next/link";

interface Artist {
    id: string;
    name: string;
    email: string;
}

interface AssignTaskDialogProps {
    sku: string;
    currentArtistId?: string | null;
    currentArtistName?: string | null;
}

/**
 * Assign or reassign the artist on one asset — plus deadline, fee, and CC
 * emails, all set at assignment time per the brief's §8 ("The assignment UI
 * supports artist selection from Personnel, deadline, fee, brief field
 * selector, and optional CC emails"). Those three fields already had full
 * backend support (assignArtistToAsset, the assign route's Zod schema) —
 * this dialog was the only piece that never collected them. Brief field
 * inclusion itself stays admin-configured globally (Curation → Brief
 * Fields) rather than re-selectable per assignment — shown here read-only
 * so whoever's assigning can see exactly what's about to go out, without
 * a second, competing place to configure the same thing.
 */
export function AssignTaskDialog({ sku, currentArtistId, currentArtistName }: AssignTaskDialogProps) {
    const [open, setOpen] = useState(false);
    // Starts empty rather than pre-selecting the current artist. The list only contains Active artists, so seeding it with the current id showed a wrong name whenever that artist is Inactive or Blacklisted - the Select cannot render a value it has no option for and fell through to another name. An empty start also matches what the dialog is for: choosing someone new.
    const [artistId, setArtistId] = useState<string>("");
    const [deadline, setDeadline] = useState<string>("");
    const [feeAmount, setFeeAmount] = useState<string>("");
    const [ccEmails, setCcEmails] = useState<string>("");
    const [submitting, setSubmitting] = useState(false);
    const { mutate } = useSWRConfig();

    const { data, error, isLoading } = useSWR<{ artists?: Artist[]; error?: string }>(
        open ? "/api/personnel/artists" : null,
        jsonFetcher
    );
    const artists = data?.artists || [];

    const { data: fieldsData } = useSWR<{ fields?: { displayName: string; includeInArtistEmail: boolean }[] }>(
        open ? "/api/admin/curation-fields" : null,
        jsonFetcher
    );
    const briefFieldNames = (fieldsData?.fields || []).filter((f) => f.includeInArtistEmail).map((f) => f.displayName);

    const isReassign = Boolean(currentArtistId);

    async function submit() {
        if (!artistId) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/assets/${encodeURIComponent(sku)}/assign`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    artistId,
                    deadline: deadline || undefined,
                    feeAmount: feeAmount.trim() || undefined,
                    ccEmails: ccEmails.split(",").map((e) => e.trim()).filter(Boolean),
                    reason: isReassign ? `Reassigned from ${currentArtistName || "previous artist"}` : undefined,
                }),
            });
            const result = await res.json();
            if (!res.ok) {
                toast.error(result.error || "Failed to assign artist");
                return;
            }
            const assigned = artists.find((a) => a.id === artistId);
            toast.success(`${sku} assigned to ${assigned?.name || "artist"} - brief email queued`);
            setOpen(false);
            mutate("/api/assets");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="assign-open">
                    <UserPlus className="h-3.5 w-3.5" />
                    {isReassign ? "Reassign" : "Assign artist"}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{isReassign ? "Reassign" : "Assign"} {sku}</DialogTitle>
                    <DialogDescription>
                        {isReassign
                            ? `Currently with ${currentArtistName || "an artist"}. Reassigning ends their assignment and queues a fresh brief email to the new artist.`
                            : "Picks the artist and queues their brief email."}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 py-2">
                    <div className="grid gap-2">
                        <Label htmlFor="assign-artist">Artist</Label>
                        {error || data?.error ? (
                            <p className="text-sm text-destructive">{data?.error || "Couldn't load artists"}</p>
                        ) : (
                            <Select value={artistId} onValueChange={setArtistId} disabled={isLoading}>
                                <SelectTrigger id="assign-artist" className="w-full">
                                    <SelectValue placeholder={isLoading ? "Loading artists..." : "Select an artist"} />
                                </SelectTrigger>
                                <SelectContent>
                                    {artists.map((artist) => (
                                        <SelectItem key={artist.id} value={artist.id}>
                                            {artist.name} - {artist.email}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        {!isLoading && !error && artists.length === 0 && (
                            <p className="text-xs text-muted-foreground">No active artists. Add one under Personnel first.</p>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-2">
                            <Label htmlFor="assign-deadline">Deadline</Label>
                            <Input id="assign-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="assign-fee">Fee</Label>
                            <Input id="assign-fee" type="number" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} placeholder="0" />
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="assign-cc">CC (comma-separated, optional)</Label>
                        <Input id="assign-cc" value={ccEmails} onChange={(e) => setCcEmails(e.target.value)} placeholder="reference-support@example.com" />
                    </div>

                    {briefFieldNames.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Brief will include: {briefFieldNames.join(", ")}.{" "}
                            <Link href="/admin/curation-fields" className="text-primary hover:underline">
                                Change
                            </Link>
                        </p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button
                        data-testid="assign-submit"
                        onClick={submit}
                        disabled={!artistId || artistId === currentArtistId || submitting}
                    >
                        {submitting ? "Assigning..." : isReassign ? "Reassign" : "Assign"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
