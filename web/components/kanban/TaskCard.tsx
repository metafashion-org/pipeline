"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { AssetDrawer } from "./asset-drawer";
import { KanbanAssetCard } from "@/lib/kanban/kanban-service";

interface TaskCardProps {
    task: KanbanAssetCard | any;
    role: string;
    onDelete?: (skuId: string) => void;
    onEdit?: (skuId: string, updates: any) => Promise<void>;
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

    const sku = task.sku || task.skuId || "temp-sku";
    const itemName = task.itemName || "Unnamed Asset";
    const currentStatus = task.currentStatus || task.productionStatus || "unassigned";
    const artistName = task.artistName || task.artist || null;

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

    const copySku = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(sku);
        toast.success("SKU copied to clipboard");
    };

    const formattedAsset: KanbanAssetCard = {
        id: task.id || sku,
        sku,
        itemName,
        category: task.category || task.itemCategory || null,
        currentStatus,
        feeAmount: task.feeAmount || task.budget || null,
        artistId: task.artistId || null,
        artistName,
        artistEmail: task.artistEmail || task.emailAddress || null,
        gmailThreadId: task.gmailThreadId || task.assignmentThreadId || null,
        updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
    };

    return (
        <>
            <div
                ref={setNodeRef}
                style={style}
                {...attributes}
                {...listeners}
                data-testid={`task-card-${sku}`}
                onClick={() => setDrawerOpen(true)}
                className="group relative mb-2 cursor-pointer touch-none rounded-lg border border-border bg-card overflow-hidden shadow-sm hover:shadow-md hover:border-border/80 transition-all"
            >
                <div className={`w-full h-24 overflow-hidden relative bg-gradient-to-br ${gradient} p-3 flex flex-col justify-between text-white`}>
                    <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-black/40 text-white backdrop-blur-sm">
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
                    <p className="text-sm font-semibold truncate leading-tight">{itemName}</p>
                </div>

                <div className="px-3 py-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                        <span
                            className="font-mono text-[10px] text-muted-foreground hover:underline cursor-pointer"
                            onClick={copySku}
                            title="Copy SKU"
                        >
                            {sku} <Copy className="inline h-2.5 w-2.5" />
                        </span>
                        <span className="capitalize text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">
                            {currentStatus.replace(/_/g, " ")}
                        </span>
                    </div>
                    {artistName && (
                        <p className="text-[11px] text-muted-foreground truncate" title={artistName}>
                            Artist: {artistName}
                        </p>
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