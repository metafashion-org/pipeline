"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import useSWR from "swr";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ReferenceUploadButton } from "./reference-upload-button";
import { DriveThumbnail } from "./drive-thumbnail";
import { parseDriveRefs } from "@/lib/assets/drive-links";
import { jsonFetcher } from "@/lib/fetcher";

interface BrandGroup {
    id: string;
    name: string;
}

interface Category {
    id: string;
    name: string;
}

/**
 * A file mid-upload, shown from its local object URL rather than a Drive link — there is no
 * Drive link yet, and even once there is, Drive hasn't generated a thumbnail for a file this new.
 * A plain `<img>` rather than next/image: `objectUrl` is a blob: URL, which next/image's remote
 * optimizer does not accept.
 */
function UploadingPreview({ objectUrl }: { objectUrl: string }) {
    return (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={objectUrl} alt="Uploading" className="h-full w-full object-cover opacity-50" />
            <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-white drop-shadow" />
            </div>
        </div>
    );
}

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
    // The Roblox creator group/brand this asset uploads to. Empty string means unset (the
    // "(none)" option) — converted to null before it reaches the API, since brandGroupId is a
    // real uuid column, never an empty string.
    brandGroupId: string;
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
    brandGroupId: "",
    deadline: "",
    referenceImages: "",
    recolorReferenceImages: "",
};

export function AssetFormFields({
    values,
    onChange,
    idPrefix,
    showSku = false,
    skuPreview = null,
}: {
    values: AssetFormValues;
    onChange: (next: AssetFormValues) => void;
    /** Keeps input ids unique when both dialogs are mounted on the same page. */
    idPrefix: string;
    showSku?: boolean;
    /**
     * The SKU this asset will most likely get, for display only — the field never accepts
     * typing. The real SKU is always computed fresh at creation time (see NewAssetDialog), so
     * this can occasionally be one behind if someone else creates an asset in between; that's
     * expected, not a bug to chase.
     */
    skuPreview?: string | null;
}) {
    const set = (patch: Partial<AssetFormValues>) => onChange({ ...values, ...patch });
    const id = (name: string) => `${idPrefix}-${name}`;
    // Edit mode already has the real SKU in values.sku (EditAssetDialog seeds it even though the
    // field itself is hidden there). Create mode never writes to values.sku — the SKU field is
    // display-only — so it falls back to the previewed one instead.
    const uploadSku = values.sku || skuPreview || "";
    const appendLinks = (field: "referenceImages" | "recolorReferenceImages", urls: string[]) =>
        set({ [field]: [values[field], ...urls].filter(Boolean).join("\n") });
    // Drops whichever line is exactly this URL. Line-exact rather than a substring replace, so a
    // legacy row that packs a URL alongside other text or other links on the same line (see
    // lib/assets/drive-links.ts's own comment on that shape) is left untouched instead of mangled
    // — its thumbnail just won't offer a working remove button, which beats corrupting the row.
    const removeLink = (field: "referenceImages" | "recolorReferenceImages", url: string) =>
        set({ [field]: values[field].split("\n").filter((line) => line.trim() !== url).join("\n") });

    const referenceRefs = parseDriveRefs(values.referenceImages);
    const recolorRefs = parseDriveRefs(values.recolorReferenceImages);
    // The raw link textarea stays out of sight until asked for — someone uploading files only
    // ever needs to look at the thumbnails, never at a Drive URL. Starts open if the field
    // already holds a link with no matching thumbnail (an unparsed/legacy value), so existing
    // text is never hidden out from under whoever's editing it.
    const [showRefLinks, setShowRefLinks] = useState(
        values.referenceImages.trim() !== "" && referenceRefs.length === 0
    );
    const [showRecolorLinks, setShowRecolorLinks] = useState(
        values.recolorReferenceImages.trim() !== "" && recolorRefs.length === 0
    );

    // Local object-URL previews for files mid-upload, shown instead of waiting on Drive's own
    // thumbnail (which isn't generated yet for a file that just landed — see
    // ReferenceUploadButton's onFilesSelected doc comment). Cleared, revoking each URL, once the
    // batch that created them settles either way.
    const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
    const [recolorPreviews, setRecolorPreviews] = useState<string[]>([]);
    const clearPreviews = (setPreviews: Dispatch<SetStateAction<string[]>>) =>
        setPreviews((prev) => {
            prev.forEach((url) => URL.revokeObjectURL(url));
            return [];
        });

    // Open to any signed-in user (not gated on canManageSystemConfig) — see app/api/admin/brand-groups/route.ts's GET comment.
    const { data: brandGroupsData } = useSWR<{ brandGroups?: BrandGroup[] }>("/api/admin/brand-groups", jsonFetcher);
    const brandGroups = brandGroupsData?.brandGroups ?? [];
    const NO_GROUP = "__none__";

    // Same reasoning as brand groups — open to any signed-in user, gated only on the admin side.
    const { data: categoriesData } = useSWR<{ categories?: Category[] }>("/api/admin/categories", jsonFetcher);
    const categoryOptions = categoriesData?.categories ?? [];
    const NO_CATEGORY = "__none__";
    // An older asset's category can be free text that predates this managed list (see
    // categories.ts's own doc comment) — kept as a selectable option of its own so editing the
    // asset never silently drops or overwrites a value nobody's added to the list yet.
    const hasUnlistedCategory = values.category !== "" && !categoryOptions.some((c) => c.name === values.category);

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
                            disabled
                            placeholder="Auto-generating…"
                            value={skuPreview ?? ""}
                            className="disabled:opacity-100 disabled:cursor-default text-muted-foreground"
                        />
                    </div>
                )}
                <div className="grid gap-1.5">
                    <Label htmlFor={id("category")}>Category</Label>
                    <Select
                        value={values.category || NO_CATEGORY}
                        onValueChange={(v) => set({ category: v === NO_CATEGORY ? "" : v })}
                    >
                        <SelectTrigger id={id("category")} className="w-full">
                            <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_CATEGORY}>Not set</SelectItem>
                            {hasUnlistedCategory && (
                                <SelectItem value={values.category}>{values.category}</SelectItem>
                            )}
                            {categoryOptions.map((c) => (
                                <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid gap-1.5">
                <Label htmlFor={id("brand-group")}>Upload group / brand</Label>
                <Select
                    value={values.brandGroupId || NO_GROUP}
                    onValueChange={(v) => set({ brandGroupId: v === NO_GROUP ? "" : v })}
                >
                    <SelectTrigger id={id("brand-group")} className="w-full">
                        <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={NO_GROUP}>Not set</SelectItem>
                        {brandGroups.map((g) => (
                            <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Which Roblox creator group this asset uploads to. Shown to the uploader once it&apos;s ready to publish.
                </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
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
                <div className="flex items-center justify-between">
                    <Label>Reference files</Label>
                    <ReferenceUploadButton
                        sku={uploadSku}
                        disabled={!uploadSku}
                        onFilesSelected={(files) =>
                            setReferencePreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))])
                        }
                        onUploaded={(urls) => appendLinks("referenceImages", urls)}
                        onSettled={() => clearPreviews(setReferencePreviews)}
                    />
                </div>
                {(referenceRefs.length > 0 || referencePreviews.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                        {referenceRefs.map((ref) => (
                            <DriveThumbnail
                                key={ref.url}
                                driveRef={ref}
                                size={64}
                                onRemove={() => removeLink("referenceImages", ref.url)}
                            />
                        ))}
                        {referencePreviews.map((url) => (
                            <UploadingPreview key={url} objectUrl={url} />
                        ))}
                    </div>
                )}
                {showRefLinks ? (
                    <Textarea
                        id={id("refs")}
                        rows={2}
                        autoFocus
                        className="text-xs"
                        placeholder="Paste Drive links, one per line"
                        value={values.referenceImages}
                        onChange={(e) => set({ referenceImages: e.target.value })}
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowRefLinks(true)}
                        className="justify-self-start text-xs text-muted-foreground underline underline-offset-2"
                    >
                        Have a link instead of a file?
                    </button>
                )}
            </div>

            <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                    <Label>Recolour references</Label>
                    <ReferenceUploadButton
                        sku={uploadSku}
                        disabled={!uploadSku}
                        onFilesSelected={(files) =>
                            setRecolorPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))])
                        }
                        onUploaded={(urls) => appendLinks("recolorReferenceImages", urls)}
                        onSettled={() => clearPreviews(setRecolorPreviews)}
                    />
                </div>
                {(recolorRefs.length > 0 || recolorPreviews.length > 0) && (
                    <div className="flex flex-wrap gap-2">
                        {recolorRefs.map((ref) => (
                            <DriveThumbnail
                                key={ref.url}
                                driveRef={ref}
                                size={64}
                                onRemove={() => removeLink("recolorReferenceImages", ref.url)}
                            />
                        ))}
                        {recolorPreviews.map((url) => (
                            <UploadingPreview key={url} objectUrl={url} />
                        ))}
                    </div>
                )}
                {showRecolorLinks ? (
                    <Textarea
                        id={id("recolours")}
                        rows={2}
                        autoFocus
                        className="text-xs"
                        placeholder="Paste Drive links, one per line"
                        value={values.recolorReferenceImages}
                        onChange={(e) => set({ recolorReferenceImages: e.target.value })}
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setShowRecolorLinks(true)}
                        className="justify-self-start text-xs text-muted-foreground underline underline-offset-2"
                    >
                        Have a link instead of a file?
                    </button>
                )}
            </div>
        </div>
    );
}
