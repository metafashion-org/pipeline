import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Panel primitives for the admin overview board.
 *
 * Severity is carried by form as well as by number: a stat turns red, a bar fills amber, a row gets a stripe. That is what lets the board be scanned rather than read, which is the whole point of a page that shows twenty numbers at once.
 */

export type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-foreground",
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  accent: "text-primary",
};

const TONE_BG: Record<Tone, string> = {
  neutral: "bg-muted-foreground/40",
  good: "bg-emerald-500/70",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  accent: "bg-primary/80",
};

export function Panel({
  title,
  hint,
  className,
  children,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-0 py-0 shadow-sm", className)}>
      <CardContent className="flex h-full flex-col gap-2 p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            {title}
          </h3>
          {hint && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** A single headline number with a line of context under it. */
export function Stat({
  value,
  note,
  tone = "neutral",
  small,
}: {
  value: string | number;
  note?: React.ReactNode;
  tone?: Tone;
  small?: boolean;
}) {
  return (
    <>
      <p className={cn("font-mono font-semibold leading-none tracking-tight tabular-nums", small ? "text-2xl" : "text-3xl", TONE_TEXT[tone])}>
        {value}
      </p>
      {note && <p className="text-[11.5px] leading-snug text-muted-foreground">{note}</p>}
    </>
  );
}

/** A labelled horizontal bar, sized against the largest value in its group. */
export function BarRow({
  label,
  value,
  max,
  tone = "accent",
  suffix,
}: {
  label: string;
  value: number;
  max: number;
  tone?: Tone;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 2;
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_1fr_2.25rem] items-center gap-2 text-[11.5px]">
      <span className="truncate text-muted-foreground" title={label}>{label}</span>
      <span className="h-2 overflow-hidden rounded-sm bg-muted">
        <span className={cn("block h-full rounded-sm", TONE_BG[tone])} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-right font-mono font-semibold tabular-nums">{value}{suffix}</span>
    </div>
  );
}

/** The stage distribution: one column per pipeline status, in pipeline order. */
export function StageColumns({
  stages,
}: {
  stages: { key: string; label: string; count: number; oldestDays: number | null }[];
}) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ minHeight: "8rem" }}>
      {stages.map((s) => {
        // A stage is flagged when work is both present and ageing, not merely present.
        const stuck = s.count > 0 && (s.oldestDays ?? 0) >= 30;
        const terminal = s.key === "payment_done";
        return (
          <div key={s.key} className="flex min-w-[3.25rem] flex-1 flex-col justify-end gap-1">
            <span className="text-center font-mono text-xs font-semibold tabular-nums">{s.count}</span>
            <span
              className={cn(
                "rounded-t-sm",
                stuck ? "bg-amber-500" : terminal ? "bg-emerald-500/50" : "bg-primary/75"
              )}
              style={{ height: `${Math.max(3, Math.round((s.count / max) * 88))}px` }}
            />
            <span className="truncate text-center text-xs leading-tight text-muted-foreground" title={s.label}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** A two-tone proportion bar, used where a total splits cleanly in two. */
export function SplitBar({ parts }: { parts: { value: number; tone: Tone; label: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <>
      <span className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {parts.map((p) => (
          <span key={p.label} className={cn("block h-full", TONE_BG[p.tone])} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </span>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <i className={cn("inline-block size-2 rounded-[2px] not-italic", TONE_BG[p.tone])} />
            {p.label}
          </span>
        ))}
      </div>
    </>
  );
}

/** A ratio shown as "n of total" plus the proportion it represents. */
export function RatioPanel({ value, total, tone, note }: { value: number; total: number; tone: Tone; note: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <>
      <Stat value={`${value} / ${total}`} tone={tone} small />
      <span className="flex h-2 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full", TONE_BG[tone])} style={{ width: `${pct}%` }} />
      </span>
      <p className={cn("text-[11.5px] leading-snug", tone === "good" ? "text-muted-foreground" : TONE_TEXT[tone])}>{note}</p>
    </>
  );
}

export function AccessBadge({ status }: { status: string }) {
  const tone = status === "Active" ? "outline" : "destructive";
  return <Badge variant={tone} className="px-1.5 font-normal">{status}</Badge>;
}

/** Used where a panel has nothing to show and that absence is itself worth stating. */
export function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed px-2 py-4 text-center">
      <p className="text-[13px] font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
