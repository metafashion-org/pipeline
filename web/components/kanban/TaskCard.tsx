"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Maximize2 } from "lucide-react";
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

/**
 * Whole calendar days between today and the deadline (negative once overdue). Compared by
 * calendar day, not exact milliseconds — a deadline at 11:59pm today shouldn't read as "0.001
 * days left" or round down to "overdue" just because the clock ticked past noon.
 */
function daysUntil(deadline: string | Date | null): number | null {
    if (!deadline) return null;
    const d = new Date(deadline);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfDeadline = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((startOfDeadline.getTime() - startOfToday.getTime()) / 86_400_000);
}

/**
 * Colour tiers deliberately coarse (not a different shade per day): overdue/today is the one
 * state that needs to read as "drop everything," 1-2 days is "soon," 3-5 is "keep an eye on it,"
 * anything further out shouldn't compete for attention at a glance.
 */
function deadlineTier(days: number): { label: string; className: string } {
    if (days < 0) return { label: `${Math.abs(days)}d overdue`, className: "bg-red-500/90 text-white" };
    if (days === 0) return { label: "Due today", className: "bg-red-500/90 text-white" };
    if (days <= 2) return { label: `${days}d left`, className: "bg-orange-500/90 text-white" };
    if (days <= 5) return { label: `${days}d left`, className: "bg-amber-500/90 text-black" };
    return { label: `${days}d left`, className: "bg-emerald-600/90 text-white" };
}

function DeadlineBadge({ deadline }: { deadline: string | Date | null }) {
    const days = daysUntil(deadline);
    if (days === null) return null;
    const tier = deadlineTier(days);
    return (
        <span
            className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded backdrop-blur-sm ${tier.className}`}
        >
            {tier.label}
        </span>
    );
}

// lucide-react deliberately ships no brand/logo icons, so this is the actual Discord mark
// (Simple Icons' path data) rather than a generic stand-in like MessageCircle.
function DiscordIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
        </svg>
    );
}

export function TaskCard({ task, role }: TaskCardProps) {
    // The `|| task.skuId`, `|| task.productionStatus`, `|| task.artist` fallbacks that used to sit
    // here read fields no card has ever carried — they were left over from an earlier shape and
    // were only reachable because the prop was typed `any`. What remains is the placeholder for a
    // card mid-creation, which is real.
    const sku = task.sku || "temp-sku";
    const itemName = task.itemName || "Unnamed Asset";
    const currentStatus = task.currentStatus || "unassigned";
    const artistName = task.artistName;
    const artistDiscordUrl = task.artistDiscordUrl;

    // Opens straight to this card's drawer when the board is loaded as .../board?asset=<SKU> —
    // the other half of openArtistDiscord's copied link below. Read once on first render: if
    // someone closes the drawer, we don't want it snapping back open just because the URL still
    // carries the param.
    const searchParams = useSearchParams();
    const [drawerOpen, setDrawerOpen] = useState(() => searchParams.get("asset") === sku);

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

    // Discord deep links (https://discord.com/channels/{guild}/{channel}) open the channel but
    // can't pre-fill a message — confirmed there's genuinely no URL parameter or scheme for that,
    // official or otherwise. So this copies a ready-to-paste reference instead of trying to fake
    // one: the person still has to paste it themselves, but the reference is a real clickable
    // link to this asset's own page (/artist?asset=<SKU> — the artist's own board, which they
    // have access to, rather than /admin/board, which they don't), not just the bare SKU text.
    // TaskCard renders under both /admin/board and /artist, and both read the same ?asset= param
    // (see the drawerOpen initializer above), so whichever page this link points at, opening it
    // lands straight on this card's drawer, already open.
    const openArtistDiscord = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const assetUrl = `${window.location.origin}/artist?asset=${encodeURIComponent(sku)}`;
            await navigator.clipboard.writeText(`Re: ${sku} — ${itemName}\n${assetUrl}`);
            toast.success(`Copied a reference + link to ${sku} — paste it in the channel`);
        } catch {
            // Clipboard can fail outside a secure context; the link below still opens regardless.
        }
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
                <div className={`w-full aspect-square overflow-hidden relative bg-gradient-to-br ${gradient} p-3 flex flex-col justify-between text-white`}>
                    {coverRef?.fileId && (
                        <>
                            <DriveImage
                                fileId={coverRef.fileId}
                                alt=""
                                sizes="220px"
                                className="object-cover"
                            />
                            {/* Darkens the cover so the deadline badge and item name stay readable over any image. */}
                            <div className="absolute inset-0 bg-black/40" />
                        </>
                    )}
                    <div className="relative flex items-center justify-between gap-1">
                        <DeadlineBadge deadline={task.deadline} />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 ml-auto text-white/80 hover:text-white hover:bg-black/30 rounded"
                            onClick={(e) => {
                                e.stopPropagation();
                                setDrawerOpen(true);
                            }}
                        >
                            <Maximize2 className="h-3 w-3" />
                        </Button>
                    </div>
                    {/* Two lines rather than one: at 220px-wide columns a single truncated line was
                        cutting off most item names after only a few words. */}
                    <p className="relative text-sm font-semibold line-clamp-2 leading-tight">{itemName}</p>
                </div>

                <div className="px-3 py-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                        {/* A real button rather than a span with onClick: copying the SKU is an
                            action, and as a span it was mouse-only — no focus, no Enter/Space.
                            The browser gives all of that for free here.
                            ponytail: this does sit inside the card's own role="button", which is
                            nested interactive content. Resolving that properly means dropping the
                            whole-card click target in favour of an explicit open affordance —
                            a board redesign, not a fix.
                            This is now the card's only SKU display — it used to also sit on the
                            image overlay above, showing the same value twice for no reason. */}
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
                        <div className="flex items-center gap-1 text-xs">
                            <span className="text-muted-foreground shrink-0">Artist:</span>
                            {artistDiscordUrl ? (
                                <a
                                    href={artistDiscordUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={openArtistDiscord}
                                    title={`Open ${artistName}'s Discord channel — copies "${sku}" to paste there`}
                                    className="flex items-center gap-1 min-w-0 text-primary hover:underline"
                                >
                                    <DiscordIcon className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{artistName}</span>
                                </a>
                            ) : (
                                <span className="text-muted-foreground truncate" title={artistName}>
                                    {artistName}
                                </span>
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
