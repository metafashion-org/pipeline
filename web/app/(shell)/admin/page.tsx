import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { getDashboardData } from "@/lib/dashboard/dashboard-service";
import {
    Panel,
    Stat,
    BarRow,
    StageColumns,
    SplitBar,
    RatioPanel,
    AccessBadge,
    EmptyPanel,
} from "@/components/dashboard/panels";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const CURRENCY_SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", INR: "₹", RUB: "₽" };

/**
 * Formats an amount in its own currency.
 * Amounts are never summed across currencies anywhere on this page: adding dollars to rupees produces a figure that means nothing, and converting at today's rate would make every historical total drift daily.
 */
function money(amount: number, currency = "INR"): string {
    return `${CURRENCY_SYMBOLS[currency] || ""}${Math.round(amount).toLocaleString("en-US")}`;
}

function monthLabel(key: string): string {
    const [year, month] = key.split("-");
    // Built in UTC: a local-midnight Date formatted as UTC rolls back a month east of Greenwich.
    return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
}

export default async function AdminDashboardPage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "admin") {
        redirect("/unauthorized");
    }

    const d = await getDashboardData();
    const primaryCurrency = d.currencies[0]?.currency || "INR";
    const maxWip = Math.max(1, ...d.artists.map((a) => a.wip));
    const maxFeeCount = Math.max(1, ...d.feeSpread.map((f) => f.count));
    const maxMonth = Math.max(1, ...d.flow.byMonth.map((m) => m.transitions));
    const activeArtists = d.artists.filter((a) => a.wip > 0);
    const delivered = d.artists.filter((a) => a.delivered > 0);
    const totalDelivered = delivered.reduce((sum, a) => sum + a.delivered, 0);
    const ageingStages = d.stages
        .filter((s) => s.count > 0 && s.oldestDays !== null)
        .sort((a, b) => (b.oldestDays ?? 0) - (a.oldestDays ?? 0))
        .slice(0, 5);
    const maxAge = Math.max(1, ...ageingStages.map((s) => s.oldestDays ?? 0));

    return (
        <div className="flex h-screen flex-col bg-background text-foreground">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3 sm:px-6">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h1 className="truncate text-lg font-semibold">Overview</h1>
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {d.totals.assets} assets, {d.roster.active} people with access
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary md:inline">
                        {session.user.email}
                    </span>
                    <ModeToggle />
                    <LogoutButton />
                </div>
            </header>

            <main className="flex-1 overflow-auto p-4 sm:p-6">
                <div className="mx-auto flex max-w-[1400px] flex-col gap-5">

                    <RowLabel title="Position" hint="where the pipeline stands right now" />
                    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
                        <Panel title="Assets"><Stat value={d.totals.assets} note="tracked end to end" /></Panel>
                        <Panel title="In production">
                            <Stat value={d.totals.inProduction} tone="accent" note="assigned, building, or in review" />
                        </Panel>
                        <Panel title="Paid out">
                            <Stat value={money(d.totals.paidAmount, primaryCurrency)} tone="good"
                                note={`${d.totals.paidCount} assets, ${primaryCurrency} only`} />
                        </Panel>
                        <Panel title="Owed now">
                            <Stat value={money(d.totals.owedAmount, primaryCurrency)} tone={d.totals.owedAmount > 0 ? "bad" : "good"}
                                note={d.totals.oldestOwedDays !== null
                                    ? `${d.totals.owedCount} assets, oldest waiting ${d.totals.oldestOwedDays} days`
                                    : `${d.totals.owedCount} assets`} />
                        </Panel>
                        <Panel title="Artists working">
                            <Stat value={d.totals.artistsWorking} note={`of ${d.roster.active} with access`} />
                        </Panel>
                        <Panel title="Average fee">
                            <Stat small value={d.totals.avgFee !== null ? money(d.totals.avgFee, primaryCurrency) : "-"}
                                tone="neutral"
                                note={d.gaps.noFee > 0 ? <span className="text-amber-600 dark:text-amber-400">{d.gaps.noFee} assets carry no fee</span> : "every asset has a fee"} />
                        </Panel>
                    </div>

                    <RowLabel title="Pipeline shape" hint="where work sits, and how long it has sat there" />
                    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                        <Panel title="Assets by stage" hint="amber = ageing" className="lg:col-span-7">
                            <StageColumns stages={d.stages} />
                        </Panel>
                        <Panel title="Oldest item in stage" hint="days" className="lg:col-span-5">
                            <div className="flex flex-col gap-1.5">
                                {ageingStages.map((s) => (
                                    <BarRow key={s.key} label={s.label} value={s.oldestDays ?? 0} max={maxAge}
                                        tone={(s.oldestDays ?? 0) >= 30 ? "bad" : "accent"} suffix="d" />
                                ))}
                            </div>
                            {ageingStages[0] && (ageingStages[0].oldestDays ?? 0) >= 30 && (
                                <p className="text-[11.5px] text-red-600 dark:text-red-400">
                                    One asset has sat in {ageingStages[0].label} for {ageingStages[0].oldestDays} days.
                                </p>
                            )}
                        </Panel>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                        <Panel title="Work in hand, by artist" className="lg:col-span-5">
                            <div className="flex flex-col gap-1.5">
                                {activeArtists.map((a) => (
                                    <BarRow key={a.name} label={a.name} value={a.wip} max={maxWip}
                                        tone={a.status !== "Active" ? "bad" : "accent"} />
                                ))}
                                {activeArtists.length === 0 && <p className="text-[11.5px] text-muted-foreground">Nobody is holding work.</p>}
                            </div>
                            {d.gaps.heldByLockedOut > 0 && (
                                <p className="text-[11.5px] text-red-600 dark:text-red-400">Red bars cannot sign in.</p>
                            )}
                        </Panel>
                        <Panel title="Delivery mix" hint="all time" className="lg:col-span-7">
                            {totalDelivered === 0 ? (
                                <EmptyPanel title="Nothing delivered yet" detail="This fills in as assets reach payment." />
                            ) : (
                                <>
                                    <SplitBar parts={delivered.slice(0, 4).map((a, i) => ({
                                        value: a.delivered,
                                        tone: (["accent", "good", "warn", "neutral"] as const)[i],
                                        label: `${a.name} · ${a.delivered}`,
                                    }))} />
                                    <div className="mt-1 overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="h-7 text-[9.5px] uppercase tracking-wider">Artist</TableHead>
                                                    <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Delivered</TableHead>
                                                    <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Share</TableHead>
                                                    <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Value</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {delivered.map((a) => (
                                                    <TableRow key={a.name}>
                                                        <TableCell className="py-1.5 text-xs font-medium">{a.name}</TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{a.delivered}</TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">
                                                            {Math.round((a.delivered / totalDelivered) * 100)}%
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">
                                                            {money(a.earned, primaryCurrency)}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                                {d.artists.length - delivered.length > 0 && (
                                                    <TableRow>
                                                        <TableCell className="py-1.5 text-xs text-muted-foreground">
                                                            {d.artists.length - delivered.length} others hold work, none delivered yet
                                                        </TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">0</TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">0%</TableCell>
                                                        <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{money(0, primaryCurrency)}</TableCell>
                                                    </TableRow>
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </>
                            )}
                        </Panel>
                    </div>

                    <RowLabel title="Money" hint="totals never mix currencies" />
                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                        <Panel title="Paid vs owed" hint={primaryCurrency}>
                            <SplitBar parts={[
                                { value: d.totals.paidAmount, tone: "good", label: `Paid ${money(d.totals.paidAmount, primaryCurrency)}` },
                                { value: d.totals.owedAmount, tone: "bad", label: `Owed ${money(d.totals.owedAmount, primaryCurrency)}` },
                            ]} />
                            <p className="text-[11.5px] text-muted-foreground">
                                {Math.round((d.totals.owedAmount / Math.max(1, d.totals.paidAmount + d.totals.owedAmount)) * 100)}
                                {" "}percent of everything committed is still outstanding.
                            </p>
                        </Panel>
                        <Panel title="Totals by currency" hint="never summed together">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="h-7 text-[9.5px] uppercase tracking-wider">Currency</TableHead>
                                        <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Assets</TableHead>
                                        <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Paid</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {d.currencies.map((c) => (
                                        <TableRow key={c.currency}>
                                            <TableCell className="py-1.5 text-xs font-medium">{c.currency}</TableCell>
                                            <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{c.assets}</TableCell>
                                            <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{money(c.paid, c.currency)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <p className="text-[11.5px] text-muted-foreground">A second currency adds a row. It never merges into one figure.</p>
                        </Panel>
                        <Panel title="Fee spread" hint={`${d.feeSpread.reduce((s, f) => s + f.count, 0)} assets with a fee`}>
                            <div className="flex flex-col gap-1.5">
                                {d.feeSpread.map((f) => (
                                    <BarRow key={f.fee} label={money(f.fee, primaryCurrency)} value={f.count} max={maxFeeCount} />
                                ))}
                                {d.feeSpread.length === 0 && <p className="text-[11.5px] text-muted-foreground">No fees recorded.</p>}
                            </div>
                        </Panel>
                    </div>

                    <RowLabel title="People" hint="who is delivering, who is idle, who is locked out" />
                    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                        <Panel title="Artist ledger" hint="sorted by delivered" className="lg:col-span-8">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="h-7 text-[9.5px] uppercase tracking-wider">Artist</TableHead>
                                            <TableHead className="h-7 text-[9.5px] uppercase tracking-wider">Access</TableHead>
                                            <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">In hand</TableHead>
                                            <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Delivered</TableHead>
                                            <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Earned</TableHead>
                                            <TableHead className="h-7 text-right text-[9.5px] uppercase tracking-wider">Avg fee</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {d.artists.map((a) => (
                                            <TableRow key={a.name}>
                                                <TableCell className="py-1.5 text-xs font-medium">{a.name}</TableCell>
                                                <TableCell className="py-1.5"><AccessBadge status={a.status} /></TableCell>
                                                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{a.wip}</TableCell>
                                                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{a.delivered}</TableCell>
                                                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{money(a.earned, primaryCurrency)}</TableCell>
                                                <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">
                                                    {a.avgFee !== null ? money(a.avgFee, primaryCurrency) : "-"}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </Panel>
                        <Panel title="Roster" className="lg:col-span-2">
                            <Stat small value={d.roster.active} tone="good" note="with access" />
                            <div className="flex flex-col gap-1.5">
                                <BarRow label="Inactive" value={d.roster.inactive} max={Math.max(1, d.roster.active)} tone="warn" />
                                <BarRow label="Blacklisted" value={d.roster.blacklisted} max={Math.max(1, d.roster.active)} tone="bad" />
                            </div>
                        </Panel>
                        <Panel title="Access requests" className="lg:col-span-2">
                            <Stat small value={d.gaps.pendingAccessRequests}
                                tone={d.gaps.pendingAccessRequests > 0 ? "warn" : "good"}
                                note={d.gaps.pendingAccessRequests > 0
                                    ? "Nobody can sign in until an admin clears it."
                                    : "Nothing waiting."} />
                        </Panel>
                    </div>

                    <RowLabel title="Risk and record keeping" hint="gaps that only get more expensive" />
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                        <Panel title="Paid without a receipt">
                            <RatioPanel value={d.gaps.paidWithoutReceipt} total={d.gaps.paidTotal}
                                tone={d.gaps.paidWithoutReceipt > 0 ? "bad" : "good"}
                                note={d.gaps.paidWithoutReceipt > 0 ? "No evidence attached to these payments." : "Every payment has evidence."} />
                        </Panel>
                        <Panel title="No deadline set">
                            <RatioPanel value={d.gaps.noDeadline} total={d.totals.assets}
                                tone={d.gaps.noDeadline > 0 ? "warn" : "good"}
                                note={d.gaps.noDeadline > 0 ? "Nothing counts as late while this holds." : "Everything has a date."} />
                        </Panel>
                        <Panel title="No fee set">
                            <RatioPanel value={d.gaps.noFee} total={d.totals.assets}
                                tone={d.gaps.noFee > 0 ? "warn" : "good"}
                                note={d.gaps.noFee > 0 ? "Budget forecasting is blind for these." : "Every asset is costed."} />
                        </Panel>
                        <Panel title="Held by locked-out artists">
                            <Stat value={d.gaps.heldByLockedOut} tone={d.gaps.heldByLockedOut > 0 ? "bad" : "good"}
                                note={d.gaps.heldByLockedOut > 0
                                    ? `${d.gaps.lockedOutNames.join(" and ")} hold live work but cannot sign in.`
                                    : "Everyone holding work can sign in."} />
                        </Panel>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
                        <Panel title="Live on Roblox, never marketed">
                            <Stat value={d.gaps.unmarketed} tone={d.gaps.unmarketed > 0 ? "warn" : "good"}
                                note="Uploaded assets with no posts logged against them." />
                        </Panel>
                        <Panel title="Marketing posts logged">
                            {d.gaps.marketingLogged === 0
                                ? <EmptyPanel title="Nothing logged yet" detail="Fills in from the marketing page." />
                                : <Stat value={d.gaps.marketingLogged} tone="accent" note="posts recorded across all platforms" />}
                        </Panel>
                        <Panel title="Overdue">
                            <Stat value={d.gaps.overdue} tone={d.gaps.overdue > 0 ? "bad" : "good"}
                                note={`${d.gaps.unassigned} unassigned. Read alongside "no deadline set" before trusting this.`} />
                        </Panel>
                    </div>

                    <RowLabel title="Flow over time" hint="app activity only, and not yet the whole story" />
                    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                        <Panel title="Recorded transitions per month" className="lg:col-span-6">
                            <div className="flex items-end gap-1.5" style={{ minHeight: "7rem" }}>
                                {d.flow.byMonth.map((m) => (
                                    <div key={m.month} className="flex flex-1 flex-col justify-end gap-1">
                                        <span className="text-center font-mono text-[11px] font-semibold tabular-nums">{m.transitions}</span>
                                        <span className="rounded-t-sm bg-primary/75" style={{ height: `${Math.max(3, Math.round((m.transitions / maxMonth) * 80))}px` }} />
                                        <span className="text-center text-[9px] text-muted-foreground">{monthLabel(m.month)}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11.5px] text-amber-600 dark:text-amber-400">
                                Missing months recorded no events; it does not mean nothing happened.
                            </p>
                        </Panel>
                        <Panel title="Recorded completions" className="lg:col-span-3">
                            <Stat value={d.flow.recordedCompletions} tone="warn"
                                note={`Against ${d.totals.paidCount} assets actually paid. The rest were imported already finished.`} />
                        </Panel>
                        <Panel title="Cycle time" hint="assigned to paid" className="lg:col-span-3">
                            {d.flow.medianCycleDays === null
                                ? <EmptyPanel title="Not measurable yet" detail="Needs assets that pass through both stages in the app." />
                                : <Stat value={`${Math.round(d.flow.medianCycleDays)}d`} tone="neutral"
                                    note="Median across assets with both stages recorded." />}
                        </Panel>
                    </div>

                </div>
            </main>
        </div>
    );
}

function RowLabel({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="flex items-baseline gap-3 pt-1">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">{title}</h2>
            <span className="h-px flex-1 bg-border" />
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{hint}</span>
        </div>
    );
}
