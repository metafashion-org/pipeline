"use client";

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

/**
 * The asset fields shared by the create and edit dialogs.
 *
 * Both dialogs edit the same seven columns, so they render from here rather than keeping two copies that drift apart: before this existed the two forms already disagreed about the help text under the reference links.
 * SKU is the only field either dialog has alone, since it is assigned once at creation and identifies the asset from then on.
 */

// INR is the schema default (MetaFashion's own currency); the others are here for artists paid elsewhere.
export const CURRENCIES = ["INR", "USD", "EUR"];

export interface AssetFormValues {
    sku: string;
    itemName: string;
    category: string;
    feeAmount: string;
    currency: string;
    deadline: string;
    referenceImages: string;
    recolorReferenceImages: string;
}

export const EMPTY_ASSET_FORM: AssetFormValues = {
    sku: "",
    itemName: "",
    category: "",
    feeAmount: "",
    currency: "INR",
    deadline: "",
    referenceImages: "",
    recolorReferenceImages: "",
};

export function AssetFormFields({
    values,
    onChange,
    idPrefix,
    showSku = false,
}: {
    values: AssetFormValues;
    onChange: (next: AssetFormValues) => void;
    /** Keeps input ids unique when both dialogs are mounted on the same page. */
    idPrefix: string;
    showSku?: boolean;
}) {
    const set = (patch: Partial<AssetFormValues>) => onChange({ ...values, ...patch });
    const id = (name: string) => `${idPrefix}-${name}`;

    return (
        <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
                <Label htmlFor={id("item-name")}>Item name</Label>
                <Input
                    id={id("item-name")}
                    placeholder="Coquette Double Heart Necklace"
                    value={values.itemName}
                    onChange={(e) => set({ itemName: e.target.value })}
                />
            </div>

            <div className={showSku ? "grid grid-cols-2 gap-3" : "grid gap-1.5"}>
                {showSku && (
                    <div className="grid gap-1.5">
                        <Label htmlFor={id("sku")}>SKU</Label>
                        <Input
                            id={id("sku")}
                            placeholder="Auto-generated"
                            value={values.sku}
                            onChange={(e) => set({ sku: e.target.value })}
                        />
                    </div>
                )}
                <div className="grid gap-1.5">
                    <Label htmlFor={id("category")}>Category</Label>
                    <Input
                        id={id("category")}
                        placeholder="Necklace, Vest, ..."
                        value={values.category}
                        onChange={(e) => set({ category: e.target.value })}
                    />
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-1.5">
                    <Label htmlFor={id("fee")}>Budget</Label>
                    <Input
                        id={id("fee")}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        placeholder="Not set"
                        value={values.feeAmount}
                        onChange={(e) => set({ feeAmount: e.target.value })}
                    />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor={id("currency")}>Currency</Label>
                    <Select value={values.currency} onValueChange={(v) => set({ currency: v })}>
                        <SelectTrigger id={id("currency")} className="w-full">
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
                    <Label htmlFor={id("deadline")}>Deadline</Label>
                    <Input
                        id={id("deadline")}
                        type="date"
                        value={values.deadline}
                        onChange={(e) => set({ deadline: e.target.value })}
                    />
                </div>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor={id("refs")}>Reference links</Label>
                <Textarea
                    id={id("refs")}
                    rows={2}
                    placeholder="Paste Drive links, one per line"
                    value={values.referenceImages}
                    onChange={(e) => set({ referenceImages: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Shown as previews on the card and in the asset drawer.</p>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor={id("recolours")}>Recolour references</Label>
                <Textarea
                    id={id("recolours")}
                    rows={2}
                    placeholder="Optional, one link per line"
                    value={values.recolorReferenceImages}
                    onChange={(e) => set({ recolorReferenceImages: e.target.value })}
                />
            </div>
        </div>
    );
}
