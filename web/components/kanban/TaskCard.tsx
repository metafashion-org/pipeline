"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Maximize2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AssetDrawer } from "./asset-drawer";
import type { KanbanAssetCard, KanbanAssetCardClient } from "@/lib/kanban/kanban-service";
import { parseDriveRefs } from "@/lib/assets/drive-links";
import { DriveImage } from "./drive-image";

interface TaskCardProps {
    task: KanbanAssetCardClient;
    role: string;
}

const GRADIENTS = [
    "from-violet-900/80 to-indigo-900/80",
    "from-rose-900/80 to-pink-900/80",
    "from-emerald-900/80 to-teal-900/80",
    "from-amber-900/80 to-orange-900/80",
    "from-sky-900/80 to-blue-900/80",
    "from-fuchsia-900/80 to-purple-900/80",
];

function getGradient(sku: string | undefined): string {
    if (!sku) return GRADIENTS[0];
    const hash = sku.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return GRADIENTS[hash % GRADIENTS.length];
}

export function TaskCard({ task, role }: TaskCardProps) {
    const [drawerOpen, setDrawerOpen] = useState(false);

    // The `|| task.skuId`, `|| task.productionStatus`, `|| task.artist` fallbacks that used to sit
    // here read fields no card has ever carried — they were left over from an earlier shape and
    // were only reachable because the prop was typed `any`. What remains is the placeholder for a
    // card mid-creation, which is real.
    const sku = task.sku || "temp-sku";
    const itemName = task.itemName || "Unnamed Asset";
    const currentStatus = task.currentStatus || "unassigned";
    const artistName = task.artistName;
    const artistDiscordUrl = task.artistDiscordUrl;

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: sku, data: { task } });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };

    const gradient = getGradient(sku);

    const copySku = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(sku);
        } catch {
            // Clipboard access is refused outside a secure context; say so rather than claiming
            // a copy that did not happen.
            toast.error("Could not copy. Select the SKU and copy it by hand.");
            return;
        }
        toast.success("SKU copied to clipboard");
    };

    // The drawer wants real Dates; the wire carries ISO strings. This is the one place they are
    // converted.
    const formattedAsset: KanbanAssetCard = {
        ...task,
        id: task.id || sku,
        sku,
        itemName,
        currentStatus,
        currency: task.currency || "INR",
        deadline: task.deadline ? new Date(task.deadline) : null,
        updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
        referenceImages: task.referenceImages ?? [],
        recolorReferenceImages: task.recolorReferenceImages ?? [],
    };

    // First reference that is an actual Drive file becomes the card's cover art; the colour gradient underneath stays visible when there is no such reference or no source can fetch it.
    const coverRef = parseDriveRefs(formattedAsset.referenceImages).find((r) => r.fileId);

    return (
        <>
            <div
                ref={setNodeRef}
                style={style}
                {...attributes}
                {...listeners}
                data-testid={`task-card-${sku}`}
                role="button"
                tabIndex={0}
                aria-label={`${sku}: ${itemName}`}
                onClick={() => setDrawerOpen(true)}
                // The card opens the drawer on click, so it needs a keyboard path to the same action; dnd-kit's own listeners cover dragging but not this.
                onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDrawerOpen(true);
                    }
                }}
                className="group relative mb-2 cursor-pointer touch-none rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:shadow-md hover:border-border/80 transition-[box-shadow,border-color]"
            >
                <div className={`w-full h-24 overflow-hidden relative bg-gradient-to-br ${gradient} p-3 flex flex-col justify-between text-white`}>
                    {coverRef?.fileId && (
                        <>
                            <DriveImage
                                fileId={coverRef.fileId}
                                alt=""
                                sizes="280px"
                                className="object-cover"
                            />
                            {/* Darkens the cover so the SKU chip and item name stay readable over any image. */}
                            <div className="absolute inset-0 bg-black/40" />
                        </>
                    )}
                    <div className="relative flex items-center justify-between">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-black/40 text-white backdrop-blur-sm">
                            {sku}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-white/80 hover:text-white hover:bg-black/30 rounded"
                            onClick={(e) => {
                                e.stopPropagation();
                                setDrawerOpen(true);
                            }}
                        >
                            <Maximize2 className="h-3 w-3" />
                        </Button>
                    </div>
                    <p className="relative text-sm font-semibold truncate leading-tight">{itemName}</p>
                </div>

                <div className="px-3 py-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                        {/* A real button rather than a span with onClick: copying the SKU is an
                            action, and as a span it was mouse-only — no focus, no Enter/Space.
                            The browser gives all of that for free here.
                            ponytail: this does sit inside the card's own role="button", which is
                            nested interactive content. Resolving that properly means dropping the
                            whole-card click target in favour of an explicit open affordance —
                            a board redesign, not a fix. */}
                        <button
                            type="button"
                            className="font-mono text-xs text-muted-foreground hover:underline cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={copySku}
                            title="Copy SKU"
                            aria-label={`Copy SKU ${sku}`}
                        >
                            {sku} <Copy className="inline h-2.5 w-2.5" />
                        </button>
                        <span className="capitalize text-xs px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                            {currentStatus.replace(/_/g, " ")}
                        </span>
                    </div>
                    {artistName && (
                        <div className="flex items-center justify-between gap-1">
                            <p className="text-xs text-muted-foreground truncate" title={artistName}>
                                Artist: {artistName}
                            </p>
                            {artistDiscordUrl && (
                                <a
                                    href={artistDiscordUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    title={`Open ${artistName}'s Discord channel`}
                                    className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                                >
                                    <MessageCircle className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <AssetDrawer
                asset={formattedAsset}
                open={drawerOpen}
                onOpenChange={setDrawerOpen}
                userRoles={[role]}
            />
        </>
    );
}