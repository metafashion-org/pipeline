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
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Assign or reassign the artist on one asset.
 * Loads the pickable artists lazily (only once the dialog is opened) and, on success, revalidates the board's "/api/assets" SWR key so the card's artist updates without a page reload.
 */
export function AssignTaskDialog({ sku, currentArtistId, currentArtistName }: AssignTaskDialogProps) {
    const [open, setOpen] = useState(false);
    // Starts empty rather than pre-selecting the current artist. The list only contains Active artists, so seeding it with the current id showed a wrong name whenever that artist is Inactive or Blacklisted - the Select cannot render a value it has no option for and fell through to another name. An empty start also matches what the dialog is for: choosing someone new.
    const [artistId, setArtistId] = useState<string>("");
    const [submitting, setSubmitting] = useState(false);
    const { mutate } = useSWRConfig();

    const { data, error, isLoading } = useSWR<{ artists?: Artist[]; error?: string }>(
        open ? "/api/personnel/artists" : null,
        fetcher
    );
    const artists = data?.artists || [];

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

                <div className="grid gap-2 py-2">
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
