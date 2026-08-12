import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { db } from "@/lib/db/client";
import { assets } from "@/lib/db/schema/assets";
import { statuses } from "@/lib/db/schema/statuses";
import { auditLog } from "@/lib/db/schema/audit_log";
import { personnel } from "@/lib/db/schema/personnel";
import { eq, asc, desc, sql } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ModeToggle } from "@/components/ui/mode-toggle";
import { LogoutButton } from "@/components/LogoutButton";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Deterministic per-status color accent, cycled by sortOrder — no `color` column
// exists on `statuses`, so this stays correct if statuses are added/reordered
// later rather than needing a hardcoded per-status map.
const STATUS_ACCENTS = [
    "border-t-slate-400",
    "border-t-blue-400",
    "border-t-indigo-400",
    "border-t-purple-400",
    "border-t-amber-400",
    "border-t-emerald-400",
];

export default async function AdminDashboardPage() {
    const session = await getServerSession(authOptions);

    if (!session || session.user?.role !== "admin") {
        redirect("/unauthorized");
    }

    const [allStatuses, statusCounts, recentActivity] = await Promise.all([
        db.select().from(statuses).orderBy(asc(statuses.sortOrder)),
        db
            .select({ status: assets.currentStatus, count: sql<number>`count(*)::int` })
            .from(assets)
            .groupBy(assets.currentStatus),
        db
            .select({
                id: auditLog.id,
                action: auditLog.action,
                entityType: auditLog.entityType,
                createdAt: auditLog.createdAt,
                actorName: personnel.name,
            })
            .from(auditLog)
            .leftJoin(personnel, eq(auditLog.actorId, personnel.id))
            .orderBy(desc(auditLog.createdAt))
            .limit(5),
    ]);

    const countByStatus = new Map(statusCounts.map((row) => [row.status, row.count]));

    return (
        <div className="flex flex-col h-screen bg-background text-foreground">
            <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                    <h1 className="text-lg font-semibold truncate">Admin Dashboard</h1>
                    <span className="hidden sm:inline-flex text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-medium truncate">
                        {session.user.email}
                    </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ModeToggle />
                    <LogoutButton />
                </div>
            </header>

            <main className="flex-1 overflow-auto p-4 sm:p-6 flex flex-col gap-8">
                <section>
                    <h2 className="text-lg font-semibold mb-3">Status Overview</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {allStatuses.map((s, i) => (
                            <Card
                                key={s.key}
                                className={`border-t-4 ${STATUS_ACCENTS[i % STATUS_ACCENTS.length]} shadow-sm hover:shadow-md hover:border-border/80 transition-all`}
                            >
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-2xl font-bold">{countByStatus.get(s.key) ?? 0}</p>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-3">Quick Links</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                        <Button variant="outline" className="h-16 justify-start rounded-lg shadow-sm hover:shadow-md hover:border-border/80 transition-all" asChild>
                            <a href="/admin/board">Kanban Board</a>
                        </Button>
                        <Button variant="outline" className="h-16 justify-start rounded-lg shadow-sm hover:shadow-md hover:border-border/80 transition-all" asChild>
                            <a href="/admin/archive">Archive</a>
                        </Button>
                        <Button variant="outline" className="h-16 justify-start rounded-lg shadow-sm hover:shadow-md hover:border-border/80 transition-all" asChild>
                            <a href="/admin/settings">Settings</a>
                        </Button>
                        <Button variant="outline" className="h-16 justify-start rounded-lg shadow-sm hover:shadow-md hover:border-border/80 transition-all" asChild>
                            <a href="/admin/curation-fields">Brief Fields</a>
                        </Button>
                        <Button variant="outline" className="h-16 justify-start rounded-lg shadow-sm hover:shadow-md hover:border-border/80 transition-all" asChild>
                            <a href="/admin/marketing">Marketing</a>
                        </Button>
                    </div>
                </section>

                <section>
                    <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Action</TableHead>
                                <TableHead>Entity</TableHead>
                                <TableHead>Actor</TableHead>
                                <TableHead>When</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {recentActivity.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                                        No activity yet.
                                    </TableCell>
                                </TableRow>
                            )}
                            {recentActivity.map((entry) => (
                                <TableRow key={entry.id}>
                                    <TableCell>{entry.action}</TableCell>
                                    <TableCell>{entry.entityType}</TableCell>
                                    <TableCell>{entry.actorName || "System"}</TableCell>
                                    <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </section>
            </main>
        </div>
    );
}
