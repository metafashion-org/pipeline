"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";
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
import { toast } from "sonner";
import { Plus } from "lucide-react";

const EMPTY_FORM = {
    sku: "",
    itemName: "",
    category: "",
    deadline: "",
    feeAmount: "",
    currency: "USD",
    referenceImages: "",
    recolorReferenceImages: "",
};

// USD is the schema default and what every existing asset uses; INR is here for the India-based freelancers.
const CURRENCIES = ["USD", "INR", "EUR"];

/**
 * Creates an asset at status "unassigned".
 * Covers the fields of the assets table that are actually set at creation time: identity, category, deadline, budget, and the reference links the board previews. Status, artist, Gmail threads, marketing and payment fields are all set later by their own flows, so they are deliberately absent here.
 * Revalidates the board's "/api/assets" key on success, so it can sit anywhere on the page without being wired to the board component.
 */
export function NewAssetDialog() {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const { mutate } = useSWRConfig();

    const handleOpenChange = (next: boolean) => {
        if (!next) setForm(EMPTY_FORM);
        setOpen(next);
    };

    const handleSubmit = async () => {
        if (!form.itemName.trim()) {
            toast.error("Item name is required");
            return;
        }

        setSubmitting(true);
        try {
            const response = await fetch("/api/assets", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sku: form.sku.trim() || undefined,
                    itemName: form.itemName.trim(),
                    category: form.category.trim() || undefined,
                    deadline: form.deadline || undefined,
                    feeAmount: form.feeAmount.trim() || undefined,
                    currency: form.currency,
                    referenceImages: form.referenceImages.trim() || undefined,
                    recolorReferenceImages: form.recolorReferenceImages.trim() || undefined,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to create asset");
            }

            toast.success(`Asset created: ${result.asset.sku}`);
            handleOpenChange(false);
            mutate("/api/assets");
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Failed to create asset";
            toast.error(message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    New Asset
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>New Asset</DialogTitle>
                    <DialogDescription>
                        Starts at status &ldquo;unassigned&rdquo;. Leave SKU blank to auto-generate one.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 py-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="new-asset-item-name">Item name</Label>
                        <Input
                            id="new-asset-item-name"
                            placeholder="Coquette Double Heart Necklace"
                            value={form.itemName}
                            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="grid gap-1.5">
                            <Label htmlFor="new-asset-sku">SKU</Label>
                            <Input
                                id="new-asset-sku"
                                placeholder="Auto-generated"
                                value={form.sku}
                                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="new-asset-category">Category</Label>
                            <Input
                                id="new-asset-category"
                                placeholder="Necklace, Vest, ..."
                                value={form.category}
                                onChange={(e) => setForm({ ...form, category: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="grid gap-1.5 col-span-1">
                            <Label htmlFor="new-asset-fee">Budget</Label>
                            <Input
                                id="new-asset-fee"
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="1"
                                value={form.feeAmount}
                                onChange={(e) => setForm({ ...form, feeAmount: e.target.value })}
                            />
                        </div>
                        <div className="grid gap-1.5 col-span-1">
                            <Label htmlFor="new-asset-currency">Currency</Label>
                            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
                                <SelectTrigger id="new-asset-currency" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CURRENCIES.map((c) => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1.5 col-span-1">
                            <Label htmlFor="new-asset-deadline">Deadline</Label>
                            <Input
                                id="new-asset-deadline"
                                type="date"
                                value={form.deadline}
                                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="grid gap-1.5">
                        <Label htmlFor="new-asset-refs">Reference links</Label>
                        <Textarea
                            id="new-asset-refs"
                            rows={2}
                            placeholder="Paste Drive links, one per line"
                            value={form.referenceImages}
                            onChange={(e) => setForm({ ...form, referenceImages: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground">Shown as previews on the card and in the asset drawer.</p>
                    </div>

                    <div className="grid gap-1.5">
                        <Label htmlFor="new-asset-recolours">Recolour references</Label>
                        <Textarea
                            id="new-asset-recolours"
                            rows={2}
                            placeholder="Optional, one link per line"
                            value={form.recolorReferenceImages}
                            onChange={(e) => setForm({ ...form, recolorReferenceImages: e.target.value })}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button data-testid="new-asset-submit" onClick={handleSubmit} disabled={submitting}>
                        {submitting ? "Creating..." : "Create"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
