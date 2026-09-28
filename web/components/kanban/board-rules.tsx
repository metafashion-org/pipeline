"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { MoveCard, MoveRule, MoveStatus, NextStepTone, TransitionActor } from "@/lib/kanban/move-rules";
import type { KanbanAssetCardClient } from "@/lib/kanban/kanban-service";

/** The colour for each next-step tone, shared by the card line, the column header and the legend. */
export const TONE_STYLES: Record<NextStepTone, { dot: string; text: string; legend: string }> = {
  you: { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400", legend: "Your move" },
  other: { dot: "bg-slate-400", text: "text-muted-foreground", legend: "Someone else's move" },
  auto: { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-400", legend: "Moves on its own" },
  blocked: { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400", legend: "Waiting on something" },
  done: { dot: "bg-slate-300 dark:bg-slate-600", text: "text-muted-foreground", legend: "Finished" },
};

// The tones the legend explains. "Finished" needs no explaining.
const LEGEND_TONES: NextStepTone[] = ["you", "other", "auto", "blocked"];

/** The colour key shown above the board. */
export function ToneLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Card colour key">
      {LEGEND_TONES.map((tone) => (
        <span key={tone} className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${TONE_STYLES[tone].dot}`} aria-hidden="true" />
          {TONE_STYLES[tone].legend}
        </span>
      ))}
    </div>
  );
}

interface BoardRules {
  actor: TransitionActor;
  statuses: MoveStatus[];
  rules: MoveRule[];
}

const BoardRulesContext = createContext<BoardRules | null>(null);

/** Gives every card on the board the rules and the viewer, so each can say what happens next. */
export function BoardRulesProvider({ value, children }: { value: BoardRules; children: ReactNode }) {
  return <BoardRulesContext.Provider value={value}>{children}</BoardRulesContext.Provider>;
}

/** The board's rules and viewer, or null for a card rendered outside a board. */
export function useBoardRules(): BoardRules | null {
  return useContext(BoardRulesContext);
}

/** The facts about a card that checkMove reads. */
export function toMoveCard(task: KanbanAssetCardClient): MoveCard {
  return {
    currentStatus: task.currentStatus,
    artistId: task.artistId,
    offerStatus: task.offerStatus,
    hasPaymentReceipt: task.hasPaymentReceipt,
    curatorId: task.curatorId,
    curationSentBack: task.curationSentBack,
  };
}
