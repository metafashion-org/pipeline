"use client";

import { useState } from "react";
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
import { toast } from "sonner";
import { Plus } from "lucide-react";

interface NewAssetDialogProps {
    onCreated: () => void;
}

const EMPTY_FORM = {
    sku: "",
    itemName: "",
    category: "",
    deadline: "",
    feeAmount: "",
};

export function NewAssetDialog({ onCreated }: NewAssetDialogProps) {
    const [open, setOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

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
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || "Failed to create asset");
            }

            toast.success(`Task created — SKU ${result.asset.sku}`);
            handleOpenChange(false);
            onCreated();
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
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>New Asset</DialogTitle>
                    <DialogDescription>
                        Creates a task at status &ldquo;unassigned&rdquo;. Leave SKU blank to auto-generate one.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-asset-sku" className="text-right">
                            SKU
                        </Label>
                        <Input
                            id="new-asset-sku"
                            className="col-span-3"
                            placeholder="Auto-generated if blank"
                            value={form.sku}
                            onChange={(e) => setForm({ ...form, sku: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-asset-item-name" className="text-right">
                            Item name
                        </Label>
                        <Input
                            id="new-asset-item-name"
                            className="col-span-3"
                            value={form.itemName}
                            onChange={(e) => setForm({ ...form, itemName: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-asset-category" className="text-right">
                            Category
                        </Label>
                        <Input
                            id="new-asset-category"
                            className="col-span-3"
                            value={form.category}
                            onChange={(e) => setForm({ ...form, category: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-asset-deadline" className="text-right">
                            Deadline
                        </Label>
                        <Input
                            id="new-asset-deadline"
                            type="date"
                            className="col-span-3"
                            value={form.deadline}
                            onChange={(e) => setForm({ ...form, deadline: e.target.value })}
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="new-asset-fee" className="text-right">
                            Fee
                        </Label>
                        <Input
                            id="new-asset-fee"
                            type="number"
                            step="0.01"
                            className="col-span-3"
                            value={form.feeAmount}
                            onChange={(e) => setForm({ ...form, feeAmount: e.target.value })}
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
