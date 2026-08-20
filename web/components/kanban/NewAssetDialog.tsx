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
import { AssetFormFields, EMPTY_ASSET_FORM } from "./asset-form-fields";
import { toast } from "sonner";
import { Plus } from "lucide-react";

/**
 * Creates an asset at status "unassigned".
 * Shares its fields with the edit dialog, so anything settable here can be corrected later and the two never drift apart. Status, artist, Gmail threads, marketing and payment fields are all set by their own flows and are deliberately absent.
 * Revalidates the board's "/api/assets" key on success, so it can sit anywhere on the page without being wired to the board component.
 */
export function NewAssetDialog() {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState(EMPTY_ASSET_FORM);
    const { mutate } = useSWRConfig();

    const handleOpenChange = (next: boolean) => {
        if (!next) setForm(EMPTY_ASSET_FORM);
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

                <AssetFormFields values={form} onChange={setForm} idPrefix="new-asset" showSku />

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
