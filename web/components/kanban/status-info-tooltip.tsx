"use client";

import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ColumnGuide } from "@/lib/kanban/move-rules";
import { TONE_STYLES } from "./board-rules";

export interface StatusInfoTooltipProps {
  statusLabel: string;
  /** What the column means, from statuses.description. */
  description?: string | null;
  /** What happens to a card here, from statuses.next_action_hint. */
  nextActionHint?: string | null;
  /** What the pipeline does on its own, from statuses.automation_note. */
  automationNote?: string | null;
  guide: ColumnGuide;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

/**
 * The "i" next to a column's name. Says what the column means, where its cards go next, who moves
 * them there and how, and whether the viewer can move them. The rules part is worked out from the
 * same status_transition_rules rows the server enforces (lib/kanban/move-rules.ts).
 */
export function StatusInfoTooltip({ statusLabel, description, nextActionHint, automationNote, guide }: StatusInfoTooltipProps) {
  const youCanButItIsNotYourJob = guide.canMoveOut && !guide.exits.some((e) => e.tone === "you");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">How cards move out of {statusLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3 text-xs shadow-md" align="start">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">{statusLabel}</h4>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>

        {nextActionHint && (
          <Section title="What happens next">
            <p>{nextActionHint}</p>
          </Section>
        )}

        <Section title="Moves on to">
          {guide.exits.length === 0 ? (
            <p className="text-muted-foreground">Nothing. This is the last step.</p>
          ) : (
            <ul className="space-y-1.5">
              {guide.exits.map((exit) => (
                <li key={exit.toKey} className="flex gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TONE_STYLES[exit.tone].dot}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{exit.toLabel}</span>
                      <span className={`ml-1.5 ${TONE_STYLES[exit.tone].text}`}>{exit.who}</span>
                    </p>
                    {exit.how && <p className="text-muted-foreground">{exit.how}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {youCanButItIsNotYourJob && (
            <p className="text-muted-foreground">You can also move these cards yourself.</p>
          )}
          {!guide.canMoveOut && guide.exits.length > 0 && (
            <p className="text-muted-foreground">You can&apos;t move cards out of this column.</p>
          )}
        </Section>

        {guide.whoCanMoveIn && (
          <Section title="Who can put cards here">
            <p>{guide.whoCanMoveIn}</p>
          </Section>
        )}

        {automationNote && (
          <Section title="Automatic">
            <p>{automationNote}</p>
          </Section>
        )}
      </PopoverContent>
    </Popover>
  );
}
