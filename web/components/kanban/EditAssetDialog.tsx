"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
import { Pencil } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { toLinkText } from "@/lib/assets/file-store";
import { KanbanAssetCard } from "@/lib/kanban/kanban-service";
import { toast } from "sonner";

// USD is the schema default and what every existing asset uses; the others are here for artists paid elsewhere.
const CURRENCIES = ["USD", "INR", "EUR"];

/**
 * Edits the fields of one asset that people need to correct after creation: name, category, budget, currency, deadline and the reference links.
 * Deliberately absent: status, artist, and the marketing and payment fields, which each have their own flow that records more than a field change.
 * Every save goes through PATCH /api/assets/[sku], which records the before and after of each changed field in the audit log, so the change is visible afterwards in the asset's history rather than being a silent overwrite.
 */
export function EditAssetDialog({ asset, onSaved }: { asset: KanbanAssetCard; onSaved?: () => void }) {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const { mutate } = useSWRConfig();

    const buildForm = () => ({
        itemName: asset.itemName,
        category: asset.category || "",
        feeAmount: asset.feeAmount || "",
        currency: asset.currency || "USD",
        deadline: asset.deadline ? new Date(asset.deadline).toISOString().slice(0, 10) : "",
        referenceImages: toLinkText(asset.referenceImages),
        recolorReferenceImages: toLinkText(asset.recolorReferenceImages),
    });

    const [form, setForm] = useState(buildForm);

    function openChange(next: boolean) {
        // Re-seed from the asset each time it opens so a cancelled edit does not linger into the next one.
        if (next) setForm(buildForm());
        setOpen(next);
    }

    async function save() {
        if (!form.itemName.trim()) {
            toast.error("Item name can't be empty");
            return;
        }
        setSubmitting(true);
        try {
            const res = await fetch(`/api/assets/${encodeURIComponent(asset.sku)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    itemName: form.itemName.trim(),
                    category: form.category.trim() || null,
                    feeAmount: form.feeAmount.trim() || null,
                    currency: form.currency,
                    deadline: form.deadline || null,
                    referenceImages: form.referenceImages,
                    recolorReferenceImages: form.recolorReferenceImages,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.error || "Failed to save changes");
                return;
            }
            toast.success(data.changed === false ? "No changes to save" : `${asset.sku} updated`);
            setOpen(false);
            mutate("/api/assets");
            onSaved?.();
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={openChange}>
            <DialogTrigger asChild>
                <Button size="sm" variant="outline" data-testid="edit-asset-open">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Edit {asset.sku}</DialogTitle>
                    <DialogDescription>
                        Changes are recorded in this asset&apos;s history with the previous value.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 py-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="edit-item-name">Item name</Label>
                        <Input
                            id="edit-item-name"
                            value={form.itemName}
                            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                        />
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="edit-category">Category</Label>
                        <Input
                            id="edit-category"
                            value={form.category}
                            onChange={(e) => setForm({ ...form, category: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="edit-fee">Budget</Label>
                            <Input
                                id="edit-fee"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="1"
                                placeholder="Not set"
                                value={form.feeAmount}
                                onChange={(e) => setForm({ ...form, feeAmount: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="edit-currency">Currency</Label>
                            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                                <SelectTrigger id="edit-currency" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="edit-deadline">Deadline</Label>
                            <Input
                                id="edit-deadline"
                                type="date"
                                value={form.deadline}
                                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid gap-1.5">
                        <Label htmlFor="edit-refs">Reference links</Label>
                        <Textarea
                            id="edit-refs"
                            rows={2}
                            placeholder="Paste Drive links, one per line"
                            value={form.referenceImages}
                            onChange={(e) => setForm({ ...form, referenceImages: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground">Shown as previews on the card and above.</p>
                    </div>

                    <div className="grid gap-1.5">
                        <Label htmlFor="edit-recolours">Recolour references</Label>
                        <Textarea
                            id="edit-recolours"
                            rows={2}
                            placeholder="Optional, one link per line"
                            value={form.recolorReferenceImages}
                            onChange={(e) => setForm({ ...form, recolorReferenceImages: e.target.value })}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>
                        Cancel
                    </Button>
                    <Button data-testid="edit-asset-save" onClick={save} disabled={submitting}>
                        {submitting ? "Saving..." : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
