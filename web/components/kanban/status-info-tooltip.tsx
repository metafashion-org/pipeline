"use client";

import React from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface StatusInfoTooltipProps {
  statusLabel: string;
  whoCanMoveIn?: string | null;
  nextActionHint?: string | null;
  automationNote?: string | null;
}

export function StatusInfoTooltip({
  statusLabel,
  whoCanMoveIn,
  nextActionHint,
  automationNote,
}: StatusInfoTooltipProps) {
  if (!whoCanMoveIn && !nextActionHint && !automationNote) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">Status info for {statusLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs space-y-2 p-3 shadow-md" align="start">
        <h4 className="font-semibold text-sm border-b pb-1 mb-2">{statusLabel} Details</h4>
        {whoCanMoveIn && (
          <div>
            <span className="font-medium text-foreground">Who Can Move In: </span>
            <span className="text-muted-foreground">{whoCanMoveIn}</span>
          </div>
        )}
        {nextActionHint && (
          <div>
            <span className="font-medium text-foreground">Next Action Hint: </span>
            <span className="text-muted-foreground">{nextActionHint}</span>
          </div>
        )}
        {automationNote && (
          <div>
            <span className="font-medium text-foreground">Automation Note: </span>
            <span className="text-muted-foreground">{automationNote}</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
