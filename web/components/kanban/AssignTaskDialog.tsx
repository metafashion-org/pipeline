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
import { apiCall } from "@/lib/api-client";
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
import { MAX_DEADLINE_EXTENSION_DAYS } from "@/lib/offers/offer-rules";
import { formatFee } from "@/lib/format-money";

interface Artist {
    id: string;
    name: string;
    email: string;
}

interface AssignTaskDialogProps {
    sku: string;
    currentArtistId?: string | null;
    currentArtistName?: string | null;
    /** The asset's own deadline, pre-filled below and still editable for this assignment. */
    currentDeadline?: Date | string | null;
    /** The asset's fee and currency, shown read-only: the offer uses the fee set on the asset, which is changed with Edit. */
    currentFeeAmount?: string | null;
    currentCurrency?: string | null;
}

// The date input needs exactly YYYY-MM-DD regardless of locale, same conversion EditAssetDialog
// already uses for the same field.
function toDateInputValue(deadline: Date | string | null | undefined): string {
    return deadline ? new Date(deadline).toISOString().slice(0, 10) : "";
}

/**
 * Assigns or reassigns the artist on one asset, which sends them the offer. Only the artist and
 * the deadline are asked for. The fee is the one already set on the asset and is shown read-only,
 * since asking for it again here meant typing the same number twice; CC was never used. The brief
 * fields that follow once the artist accepts stay configured in one place (Curation → Brief
 * Fields) and are listed here so it's clear what goes out.
 */
export function AssignTaskDialog({
    sku,
    currentArtistId,
    currentArtistName,
    currentDeadline,
    currentFeeAmount,
    currentCurrency,
}: AssignTaskDialogProps) {
    const [open, setOpen] = useState(false);
    // Starts empty rather than pre-selecting the current artist. The list only contains Active artists, so seeding it with the current id showed a wrong name whenever that artist is Inactive or Blacklisted - the Select cannot render a value it has no option for and fell through to another name. An empty start also matches what the dialog is for: choosing someone new.
    const [artistId, setArtistId] = useState<string>("");
    // Pre-filled from the asset's own deadline, and still editable for this assignment.
    const [deadline, setDeadline] = useState<string>(() => toDateInputValue(currentDeadline));
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
            const { ok, data: result } = await apiCall(`/api/assets/${encodeURIComponent(sku)}/assign`, {
                method: "POST",
                body: {
                    artistId,
                    deadline: deadline || undefined,
                    reason: isReassign ? `Reassigned from ${currentArtistName || "previous artist"}` : undefined,
                },
            });
            if (!ok) {
                toast.error(result.error || "Failed to assign artist");
                return;
            }
            const assigned = artists.find((a) => a.id === artistId);
            toast.success(`Offer sent to ${assigned?.name || "the artist"} by email and Discord`);
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
                            ? `Currently with ${currentArtistName || "an artist"}. Reassigning ends their assignment and sends the new artist an offer.`
                            : "Pick the artist. They're sent an offer to accept."}
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
                            <span className="text-sm font-medium">Fee</span>
                            <p className="h-9 flex items-center text-sm">{formatFee(currentFeeAmount, currentCurrency, "Not set")}</p>
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-1">The fee comes from the asset. Change it with Edit.</p>

                    <p className="text-xs text-muted-foreground">
                        The artist is sent an offer by email and Discord: the asset&apos;s picture, name, SKU, accessory
                        type, fee and deadline. They accept it, ask for up to {MAX_DEADLINE_EXTENSION_DAYS} more days
                        (you approve it), or decline.
                    </p>
                    {briefFieldNames.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                            Once they accept, the full brief follows: {briefFieldNames.join(", ")}.{" "}
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
                        disabled={!artistId || !deadline || artistId === currentArtistId || submitting}
                        title={!deadline ? "Set a deadline to offer the asset with" : undefined}
                    >
                        {submitting ? "Sending offer..." : isReassign ? "Reassign and send offer" : "Assign and send offer"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
