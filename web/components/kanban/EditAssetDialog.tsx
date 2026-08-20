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
import { AssetFormFields, AssetFormValues } from "./asset-form-fields";
import { KanbanAssetCard } from "@/lib/kanban/kanban-service";
import { toLinkText } from "@/lib/assets/file-store";
import { toast } from "sonner";

/**
 * Corrects the fields of an existing asset.
 * Renders the same fields as the create dialog, minus SKU, which is assigned once and identifies the asset from then on.
 * Every save goes through PATCH /api/assets/[sku], which records the before and after of each changed field in the audit log, so the change shows up in the asset's history rather than being a silent overwrite.
 */
export function EditAssetDialog({ asset, onSaved }: { asset: KanbanAssetCard; onSaved?: () => void }) {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const { mutate } = useSWRConfig();

    const buildForm = (): AssetFormValues => ({
        sku: asset.sku,
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

                <AssetFormFields values={form} onChange={setForm} idPrefix="edit" />

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
