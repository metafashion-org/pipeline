"use client";

import { useEffect, useState } from "react";
import { apiCall } from "@/lib/api-client";
import { formatDate } from "@/lib/format-date";
import { toast } from "sonner";
import {
  Users,
  UserPlus,
  Shield,
  Archive as ArchiveIcon,
  Clock,
  RotateCcw,
  Trash2,
  UserX,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface OverviewMember {
  id: string;
  username: string;
  rawUsername: string;
  displayName: string;
  roles: string[];
  buckets: string[];
  channels: string[];
  status: "active" | "pending";
}

export interface OverviewChannel {
  id: string;
  name: string;
  type: number;
  category: string | null;
  categoryId: string | null;
  isArchived: boolean;
  bucketVisibility: Record<"admin" | "manager" | "curator" | "artist", boolean>;
}

export interface Overview {
  members: OverviewMember[];
  channels: OverviewChannel[];
  archived: OverviewChannel[];
  categories: { id: string; name: string }[];
}

export interface Department {
  name: string;
  emoji: string;
  sharedChannelName: string | null;
  sharedLabel: string | null;
  sharedDefault: boolean;
}

export interface TempAccessGrant {
  id: string;
  channelId: string;
  channelName: string;
  granteeType: "user" | "role";
  granteeId: string;
  granteeName: string;
  grantedAt: string;
  expiresAt: string;
  grantedBy: string | null;
}

const BUCKET_LABEL: Record<string, string> = { admin: "Admin", manager: "Manager", curator: "Curator", artist: "Artist" };
// Was a local copy that formatted in whatever locale/zone the renderer happened to be in.
const fmtDate = (iso: string) => formatDate(iso);

// Kept as a thin throwing wrapper because this file's ~20 call sites are all written around
// try/catch. The fetch, the defensive body read and the status check now live in
// lib/api-client.ts, which is the same logic six other components were each carrying by hand.
async function postJson<T = unknown>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const { ok, status, data } = await apiCall<Record<string, unknown>>(url, { method, body });
  if (!ok) throw new Error(data.error || `Request failed (${status})`);
  return data as T;
}

function errMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function DiscordTeamManager({
  initialOverview,
  departments,
  initialTempGrants,
  isManagerTier,
  isAdminTier,
}: {
  initialOverview: Overview;
  departments: Department[];
  initialTempGrants: TempAccessGrant[];
  isManagerTier: boolean;
  isAdminTier: boolean;
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [tempGrants, setTempGrants] = useState(initialTempGrants);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  // Set by the Overview tab's "Onboard" quick action on a pending member
  // (see OverviewTab below) — carries their name/username over to the
  // Onboard tab so the admin doesn't have to go look it up and retype it.
  const [onboardPrefill, setOnboardPrefill] = useState<{ name: string; username: string } | null>(null);

  function jumpToOnboard(member: OverviewMember) {
    setOnboardPrefill({ name: member.displayName, username: member.rawUsername });
    setActiveTab("onboard");
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const [ov, ta] = await Promise.all([
        postJson<Overview>("/api/admin/discord/overview", undefined, "GET"),
        isManagerTier ? postJson<{ grants: TempAccessGrant[] }>("/api/admin/discord/temp-access", undefined, "GET") : Promise.resolve({ grants: tempGrants }),
      ]);
      setOverview(ov);
      setTempGrants(ta.grants);
      toast.success("Refreshed from Discord");
    } catch (e) {
      toast.error(errMessage(e, "Failed to refresh"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <TabsList>
          <TabsTrigger value="overview">
            <Users className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          {isManagerTier && (
            <TabsTrigger value="onboard">
              <UserPlus className="h-3.5 w-3.5" /> Onboard
            </TabsTrigger>
          )}
          <TabsTrigger value="permissions">
            <Shield className="h-3.5 w-3.5" /> Permissions
          </TabsTrigger>
          {isManagerTier && (
            <TabsTrigger value="temp-access">
              <Clock className="h-3.5 w-3.5" /> Temp Access
            </TabsTrigger>
          )}
          {isManagerTier && (
            <TabsTrigger value="archive">
              <ArchiveIcon className="h-3.5 w-3.5" /> Archive
            </TabsTrigger>
          )}
        </TabsList>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <TabsContent value="overview">
        <OverviewTab overview={overview} isAdminTier={isAdminTier} isManagerTier={isManagerTier} onChanged={refresh} onOnboard={jumpToOnboard} />
      </TabsContent>

      {isManagerTier && (
        <TabsContent value="onboard">
          <OnboardTab departments={departments} onOnboarded={refresh} prefill={onboardPrefill} />
        </TabsContent>
      )}

      <TabsContent value="permissions">
        <PermissionsTab overview={overview} isAdminTier={isAdminTier} isManagerTier={isManagerTier} onChanged={refresh} />
      </TabsContent>

      {isManagerTier && (
        <TabsContent value="temp-access">
          <TempAccessTab overview={overview} grants={tempGrants} onChanged={refresh} />
        </TabsContent>
      )}

      {isManagerTier && (
        <TabsContent value="archive">
          <ArchiveTab overview={overview} isAdminTier={isAdminTier} onChanged={refresh} />
        </TabsContent>
      )}
    </Tabs>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────

function OverviewTab({
  overview,
  isAdminTier,
  isManagerTier,
  onChanged,
  onOnboard,
}: {
  overview: Overview;
  isAdminTier: boolean;
  isManagerTier: boolean;
  onChanged: () => void;
  onOnboard: (member: OverviewMember) => void;
}) {
  const [kicking, setKicking] = useState<string | null>(null);

  async function kick(userId: string, displayName: string) {
    setKicking(userId);
    try {
      await postJson("/api/admin/discord/kick", { userId });
      toast.success(`${displayName} removed from the server`);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to kick member"));
    } finally {
      setKicking(null);
    }
  }

  // Pending (not-yet-onboarded) members first — someone who just joined
  // and needs onboarding is exactly who this list needs to surface, not
  // bury below everyone already set up.
  const sortedMembers = [...overview.members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Server members" value={overview.members.length} />
        <StatCard label="Channels" value={overview.channels.length} />
        <StatCard label="Archived" value={overview.archived.length} />
        <StatCard label="Pending (no role bucket)" value={overview.members.filter((m) => m.status === "pending").length} warn />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">Members</div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Discord user</TableHead>
                <TableHead>Buckets</TableHead>
                <TableHead>Visible channels</TableHead>
                <TableHead>Status</TableHead>
                {(isAdminTier || isManagerTier) && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedMembers.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">
                    {m.displayName}
                    <div className="text-xs text-muted-foreground font-normal">@{m.rawUsername}</div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {m.buckets.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        m.buckets.map((b) => (
                          <Badge key={b} variant="secondary" className="text-[10px]">
                            {BUCKET_LABEL[b] || b}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.channels.length}</TableCell>
                  <TableCell>
                    <Badge variant={m.status === "active" ? "default" : "outline"} className="text-[10px] capitalize">
                      {m.status}
                    </Badge>
                  </TableCell>
                  {(isAdminTier || isManagerTier) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isManagerTier && m.status === "pending" && (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onOnboard(m)}>
                            <UserPlus className="h-3.5 w-3.5" /> Onboard
                          </Button>
                        )}
                        {isAdminTier && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={kicking === m.id}>
                                <UserX className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove {m.displayName} from the server?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This kicks them from the real Discord server immediately. They can rejoin with a fresh invite, but every role and channel access they had is gone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => kick(m.id, m.displayName)}>Remove</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-2xl font-display font-semibold" style={{ color: warn && value > 0 ? "var(--destructive)" : "var(--primary)" }}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

// ─── Onboard ────────────────────────────────────────────────────────────

function OnboardTab({
  departments,
  onOnboarded,
  prefill,
}: {
  departments: Department[];
  onOnboarded: () => void;
  prefill: { name: string; username: string } | null;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [department, setDepartment] = useState("");
  const [alsoAddShared, setAlsoAddShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ channel: { url: string; name: string }; role: { name: string } } | null>(null);

  // Carries a name/username over from the Overview tab's "Onboard" quick
  // action on a pending member (see jumpToOnboard in the parent). Adjusted
  // during render rather than in an effect (each click creates a fresh
  // prefill object, so reference identity alone tells us it's new) —
  // React's own recommended pattern for "reset state when a prop changes",
  // avoids the cascading-render effect the lint rule flags.
  const [appliedPrefill, setAppliedPrefill] = useState<typeof prefill>(null);
  if (prefill && prefill !== appliedPrefill) {
    setAppliedPrefill(prefill);
    setName(prefill.name);
    setUsername(prefill.username);
  }

  const dept = departments.find((d) => d.name === department) || null;

  function selectDepartment(value: string) {
    setDepartment(value);
    const d = departments.find((x) => x.name === value);
    setAlsoAddShared(d?.sharedDefault ?? false);
  }

  async function submit() {
    if (!name.trim() || !username.trim() || !department) {
      toast.error("Name, Discord username, and department are all required");
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const data = await postJson<{ channel: { url: string; name: string }; role: { name: string } }>("/api/admin/discord/onboard", {
        name: name.trim(),
        username: username.trim(),
        department,
        alsoAddShared,
      });
      setResult(data);
      toast.success(`${name} onboarded — channel and role created`);
      setName("");
      setUsername("");
      onOnboarded();
    } catch (e) {
      toast.error(errMessage(e, "Failed to onboard member"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      {result && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm space-y-1">
          <p className="font-medium">Onboarded — role &ldquo;{result.role.name}&rdquo; created, channel ready.</p>
          <a href={result.channel.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 inline-flex items-center gap-1">
            Open {result.channel.name} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="onboard-name">Full name</Label>
        <Input id="onboard-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rishiraj Sharma" />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="onboard-username">Discord name (exact)</Label>
        <Input id="onboard-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Their Discord display name or username" />
        <p className="text-xs text-muted-foreground">Their display name (e.g. &ldquo;Anuj&rdquo;) or @username both work. They must already be in the server. Exact match required — no closest-guess fallback.</p>
      </div>
      <div className="grid gap-2">
        <Label>Department</Label>
        <Select value={department} onValueChange={selectDepartment}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a department" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((d) => (
              <SelectItem key={d.name} value={d.name}>
                {d.emoji} {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {dept?.sharedLabel && (
        <div className="flex items-center justify-between rounded-md border px-3 py-2">
          <Label htmlFor="onboard-shared" className="text-sm font-normal">
            {dept.sharedLabel}
          </Label>
          <Switch id="onboard-shared" checked={alsoAddShared} onCheckedChange={setAlsoAddShared} />
        </div>
      )}
      <Button onClick={submit} disabled={submitting || !name.trim() || !username.trim() || !department}>
        {submitting ? "Onboarding..." : "Onboard member"}
      </Button>
    </div>
  );
}

// ─── Permissions ────────────────────────────────────────────────────────

const BIT_LABELS: { key: string; label: string }[] = [
  { key: "view", label: "View" },
  { key: "send", label: "Send" },
  { key: "attach", label: "Attach" },
  { key: "embed", label: "Embed" },
  { key: "history", label: "History" },
];

function PermissionsTab({
  overview,
  isAdminTier,
  isManagerTier,
  onChanged,
}: {
  overview: Overview;
  isAdminTier: boolean;
  isManagerTier: boolean;
  onChanged: () => void;
}) {
  const [detailChannel, setDetailChannel] = useState<OverviewChannel | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const activeChannels = overview.channels.filter((c) => !c.isArchived);

  async function toggleBucket(channel: OverviewChannel, bucket: "manager" | "curator", enabled: boolean) {
    const key = `${channel.id}-${bucket}`;
    setBusyKey(key);
    try {
      await postJson("/api/admin/discord/channel-permission", { channelId: channel.id, bucket, enabled });
      toast.success(`${BUCKET_LABEL[bucket]} ${enabled ? "can now see" : "no longer sees"} #${channel.name}`);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to update permission"));
    } finally {
      setBusyKey(null);
    }
  }

  async function archive(channel: OverviewChannel) {
    setBusyKey(channel.id);
    try {
      await postJson("/api/admin/discord/archive-channel", { channelId: channel.id });
      toast.success(`#${channel.name} archived`);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to archive channel"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Manager/Curator columns are a quick all-or-nothing toggle for a channel. Click a channel for exact bit-level control (view/send/attach/embed/history per role).
      </p>
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Manager</TableHead>
                <TableHead className="text-center">Curator</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeChannels.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">#{c.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.category || "Uncategorised"}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={c.bucketVisibility.manager}
                      disabled={!isAdminTier || busyKey === `${c.id}-manager`}
                      onCheckedChange={(v) => toggleBucket(c, "manager", v)}
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={c.bucketVisibility.curator}
                      disabled={!isAdminTier || busyKey === `${c.id}-curator`}
                      onCheckedChange={(v) => toggleBucket(c, "curator", v)}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline" onClick={() => setDetailChannel(c)}>
                      Details
                    </Button>
                    {isManagerTier && (
                      <Button size="sm" variant="ghost" disabled={busyKey === c.id} onClick={() => archive(c)}>
                        <ArchiveIcon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={!!detailChannel} onOpenChange={(v) => !v && setDetailChannel(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>#{detailChannel?.name} — permission detail</DialogTitle>
            <DialogDescription>What Discord actually has stored per role, bit by bit.</DialogDescription>
          </DialogHeader>
          {detailChannel && <ChannelPermissionDetail channelId={detailChannel.id} isAdminTier={isAdminTier} onChanged={onChanged} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelPermissionDetail({ channelId, isAdminTier, onChanged }: { channelId: string; isAdminTier: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<{ roleId: string; roleName: string; isEveryone: boolean; bits: Record<string, boolean> }[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // loading starts true (see useState above) and this dialog is remounted
  // fresh per open, so there's no later channelId change to reset it for -
  // no setState needed at the top of the effect itself.
  useEffect(() => {
    postJson<{ rows: { roleId: string; roleName: string; isEveryone: boolean; bits: Record<string, boolean> }[] }>(`/api/admin/discord/channel/${channelId}/permissions`, undefined, "GET")
      .then((d) => setRows(d.rows))
      .catch((e) => toast.error(errMessage(e, "Failed to load permission detail")))
      .finally(() => setLoading(false));
  }, [channelId]);

  async function toggleBit(roleId: string, bit: string, enabled: boolean) {
    const key = `${roleId}-${bit}`;
    setBusyKey(key);
    try {
      await postJson("/api/admin/discord/channel-permission-bit", { channelId, roleId, bit, enabled });
      setRows((prev) => prev?.map((r) => (r.roleId === roleId ? { ...r, bits: { ...r.bits, [bit]: enabled } } : r)) || null);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to update permission bit"));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  if (!rows || rows.length === 0) return <p className="text-sm text-muted-foreground py-4">No role overwrites on this channel.</p>;

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Role</TableHead>
            {BIT_LABELS.map((b) => (
              <TableHead key={b.key} className="text-center text-[10px]">
                {b.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.roleId}>
              <TableCell className="text-sm">{row.roleName}</TableCell>
              {BIT_LABELS.map((b) => (
                <TableCell key={b.key} className="text-center">
                  <Switch
                    size="sm"
                    checked={row.bits[b.key]}
                    disabled={!isAdminTier || row.isEveryone || busyKey === `${row.roleId}-${b.key}`}
                    onCheckedChange={(v) => toggleBit(row.roleId, b.key, v)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Temp access ────────────────────────────────────────────────────────

function TempAccessTab({ overview, grants, onChanged }: { overview: Overview; grants: TempAccessGrant[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [days, setDays] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function submit() {
    const channel = overview.channels.find((c) => c.id === channelId);
    const member = overview.members.find((m) => m.id === memberId);
    if (!channel || !member) {
      toast.error("Pick a channel and a member");
      return;
    }
    const dayCount = parseInt(days, 10);
    if (!Number.isFinite(dayCount) || dayCount < 1) {
      toast.error("Days must be a positive number");
      return;
    }
    setSubmitting(true);
    try {
      await postJson("/api/admin/discord/temp-access", {
        channelId: channel.id,
        channelName: channel.name,
        granteeType: "user",
        granteeId: member.id,
        granteeName: member.displayName,
        days: dayCount,
      });
      toast.success(`${member.displayName} granted ${dayCount}-day access to #${channel.name}`);
      setOpen(false);
      setChannelId("");
      setMemberId("");
      setDays("7");
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to grant temp access"));
    } finally {
      setSubmitting(false);
    }
  }

  async function revoke(grantId: string) {
    setRevoking(grantId);
    try {
      await postJson(`/api/admin/discord/temp-access/${grantId}/revoke`, undefined, "POST");
      toast.success("Access revoked");
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to revoke access"));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div className="space-y-4">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size="sm">Grant temp access</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Grant temporary channel access</DialogTitle>
            <DialogDescription>Full access (view, post, share media) for a set number of days, then auto-revoked hourly by the expiry job.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label>Channel</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a channel" />
                </SelectTrigger>
                <SelectContent>
                  {overview.channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      #{c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Member</Label>
              <Select value={memberId} onValueChange={setMemberId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                  {overview.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="temp-days">Days</Label>
              <Input id="temp-days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || !channelId || !memberId}>
              {submitting ? "Granting..." : "Grant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">Active grants</div>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground p-4">No active temporary access grants.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Channel</TableHead>
                  <TableHead>Grantee</TableHead>
                  <TableHead>Granted</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>#{g.channelName}</TableCell>
                    <TableCell>{g.granteeName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(g.grantedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{fmtDate(g.expiresAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{g.grantedBy || "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" disabled={revoking === g.id} onClick={() => revoke(g.id)}>
                        Revoke now
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Archive ────────────────────────────────────────────────────────────

function ArchiveTab({ overview, isAdminTier, onChanged }: { overview: Overview; isAdminTier: boolean; onChanged: () => void }) {
  const [restoreTarget, setRestoreTarget] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function restore(channel: OverviewChannel) {
    const categoryId = restoreTarget[channel.id];
    if (!categoryId) {
      toast.error("Pick a category to restore into");
      return;
    }
    setBusyKey(channel.id);
    try {
      await postJson("/api/admin/discord/restore-channel", { channelId: channel.id, categoryId });
      toast.success(`#${channel.name} restored`);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to restore channel"));
    } finally {
      setBusyKey(null);
    }
  }

  async function deletePermanently(channel: OverviewChannel) {
    setBusyKey(channel.id);
    try {
      await postJson(`/api/admin/discord/channel/${channel.id}`, undefined, "DELETE");
      toast.success(`#${channel.name} permanently deleted`);
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Failed to delete channel"));
    } finally {
      setBusyKey(null);
    }
  }

  if (overview.archived.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No archived channels.</p>;
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Restore into</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.archived.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">#{c.name}</TableCell>
                <TableCell>
                  <Select value={restoreTarget[c.id] || ""} onValueChange={(v) => setRestoreTarget((prev) => ({ ...prev, [c.id]: v }))}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {overview.categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Button size="sm" variant="outline" disabled={busyKey === c.id} onClick={() => restore(c)}>
                    <RotateCcw className="h-3.5 w-3.5" /> Restore
                  </Button>
                  {isAdminTier && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyKey === c.id}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Permanently delete #{c.name}?</AlertDialogTitle>
                          <AlertDialogDescription>This can&apos;t be undone — the channel and its full message history are gone from Discord.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deletePermanently(c)}>Delete permanently</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
