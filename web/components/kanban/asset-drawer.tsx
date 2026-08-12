"use client";

import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { KanbanAssetCard } from "@/lib/kanban/kanban-service";
import { ExternalLink, Mail, DollarSign, Image, Calendar, Tag, ShieldCheck, History } from "lucide-react";

export interface AssetDrawerProps {
  asset: KanbanAssetCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRoles?: string[];
}

export function AssetDrawer({ asset, open, onOpenChange, userRoles = ["admin"] }: AssetDrawerProps) {
  if (!asset) return null;

  const isAdminOrOperator = userRoles.includes("admin") || userRoles.includes("operator");
  const isCurator = userRoles.includes("curator") || isAdminOrOperator;
  const isMarketing = userRoles.includes("marketing") || isAdminOrOperator;
  const isPaymentAdmin = userRoles.includes("payment_admin") || isAdminOrOperator;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-6 space-y-6">
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="font-mono">{asset.sku}</Badge>
            <Badge variant="secondary" className="capitalize">{asset.currentStatus.replace(/_/g, " ")}</Badge>
          </div>
          <SheetTitle className="text-xl font-bold mt-2">{asset.itemName}</SheetTitle>
          {asset.category && <p className="text-xs text-muted-foreground">{asset.category}</p>}
        </SheetHeader>

        {/* 1. Basic Details */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Tag className="h-3.5 w-3.5" /> 1. Basic Details
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm bg-muted/30 p-3 rounded-md">
            <div><span className="text-xs text-muted-foreground">SKU:</span> <p className="font-mono">{asset.sku}</p></div>
            <div><span className="text-xs text-muted-foreground">Category:</span> <p>{asset.category || "N/A"}</p></div>
            <div><span className="text-xs text-muted-foreground">Status:</span> <p className="capitalize">{asset.currentStatus}</p></div>
            <div><span className="text-xs text-muted-foreground">Updated:</span> <p>{new Date(asset.updatedAt).toLocaleDateString()}</p></div>
          </div>
        </section>

        {/* 2. Artist Assignment */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> 2. Artist Assignment
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-sm space-y-1">
            <p><span className="text-xs text-muted-foreground">Assigned Artist:</span> {asset.artistName || "Unassigned"}</p>
            {asset.artistEmail && <p><span className="text-xs text-muted-foreground">Email:</span> {asset.artistEmail}</p>}
          </div>
        </section>

        {/* 3. Curation & Concept (Internal - hidden from artists) */}
        {isCurator && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Image className="h-3.5 w-3.5" /> 3. Curation & Concept
            </h4>
            <div className="bg-muted/30 p-3 rounded-md text-sm">
              <p className="text-xs text-muted-foreground italic">Curator moodboards & concept links</p>
            </div>
          </section>
        )}

        {/* 4. Technical Specs & Mannequin Rig */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> 4. Technical Specs & Rigs
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-sm">
            <p className="text-xs text-muted-foreground">Target Roblox R15 Mannequin Rig Specs</p>
          </div>
        </section>

        {/* 5. Financials & Budget (Gated) */}
        {isPaymentAdmin && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5" /> 5. Financials & Budget
            </h4>
            <div className="bg-muted/30 p-3 rounded-md text-sm">
              <p><span className="text-xs text-muted-foreground">Budget/Fee:</span> {asset.feeAmount ? `$${asset.feeAmount}` : "Not set"}</p>
            </div>
          </section>
        )}

        {/* 8. Gmail Thread & Communications */}
        {asset.gmailThreadId && (
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> 8. Gmail Thread
            </h4>
            <div className="bg-muted/30 p-3 rounded-md text-sm flex items-center justify-between">
              <span className="font-mono text-xs truncate max-w-[250px]">{asset.gmailThreadId}</span>
              <a
                href={`https://mail.google.com/mail/u/0/#inbox/${asset.gmailThreadId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-500 hover:underline flex items-center gap-1"
              >
                Open Thread <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </section>
        )}

        {/* 11. Status History & Audit Trail */}
        <section className="space-y-2 border-t pt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" /> 11. Status History & Audit Log
          </h4>
          <div className="bg-muted/30 p-3 rounded-md text-xs text-muted-foreground">
            <p>Timeline entries extracted from status history log</p>
          </div>
        </section>
      </SheetContent>
    </Sheet>
  );
}
