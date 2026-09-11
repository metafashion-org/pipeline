"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
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
import { Trash2, Link2, RefreshCw, Mail, MessageSquare, AlertTriangle } from "lucide-react";
import { apiCall } from "@/lib/api-client";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";
import type { OnboardingRequestRow } from "@/lib/personnel/onboarding-sync";

const ROLE_OPTIONS = ["admin", "operator", "curator", "artist", "publisher", "uploader", "marketing", "payment_admin"];

interface PersonnelRow {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Active" | "Blacklisted" | "Inactive";
  dateOnboarded: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  Active: "default",
  Inactive: "secondary",
  Blacklisted: "destructive",
};

const cardClass = "shadow-sm hover:shadow-md transition-shadow";

export function PersonnelManager({
  currentPersonnelId,
  initialPersonnel,
  initialRequests,
  initialSyncWarning,
}: {
  currentPersonnelId?: string;
  initialPersonnel: PersonnelRow[];
  initialRequests: OnboardingRequestRow[];
  initialSyncWarning: string | null;
}) {
  const [people, setPeople] = useState(initialPersonnel);
  const [pending, setPending] = useState(initialRequests);
  const [syncWarning, setSyncWarning] = useState(initialSyncWarning);
  const [syncing, setSyncing] = useState(false);
  // A Discord request has no email — Discord never gives a bot one — so approving it asks for the address the person will sign in with. An email request already has theirs.
  const [approveFor, setApproveFor] = useState<OnboardingRequestRow | null>(null);
  const [approveEmail, setApproveEmail] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", roles: [] as string[] });
  const [editRolesFor, setEditRolesFor] = useState<string | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const editRolesSet = useMemo(() => new Set(editRoles), [editRoles]);

  function toggleAddRole(role: string) {
    setAddForm((prev) => ({
      ...prev,
      roles: prev.roles.includes(role) ? prev.roles.filter((r) => r !== role) : [...prev.roles, role],
    }));
  }

  async function addPersonnel() {
    if (!addForm.name || !addForm.email || addForm.roles.length === 0) {
      toast.error("Name, email, and at least one role are required");
      return;
    }
    const { ok, data } = await apiCall<{ personnel: PersonnelRow }>("/api/admin/personnel", { method: "POST", body: addForm });
    if (!ok) {
      toast.error(data.error || "Failed to add personnel");
      return;
    }
    setPeople((prev) => [
      { id: data.personnel.id, name: data.personnel.name, email: data.personnel.email, roles: data.personnel.roles, status: data.personnel.status, dateOnboarded: data.personnel.dateOnboarded },
      ...prev,
    ]);
    setAddForm({ name: "", email: "", roles: [] });
    setAddOpen(false);
    toast.success(`${data.personnel.name} added`);
  }

  function openEditRoles(p: PersonnelRow) {
    setEditRoles(p.roles);
    setEditRolesFor(p.id);
  }

  function toggleEditRole(role: string) {
    setEditRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function saveRoles(id: string) {
    if (editRoles.length === 0) {
      toast.error("At least one role is required");
      return;
    }
    const { ok, data } = await apiCall<{ personnel: PersonnelRow }>(`/api/admin/personnel/${id}`, { method: "PATCH", body: { roles: editRoles } });
    if (!ok) {
      toast.error(data.error || "Failed to update roles");
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, roles: data.personnel.roles } : p)));
    setEditRolesFor(null);
    toast.success("Roles updated");
  }

  async function deletePersonnel(id: string) {
    const { ok, data } = await apiCall(`/api/admin/personnel/${id}`, { method: "DELETE" });
    if (!ok) {
      toast.error(data.error || "Failed to delete personnel");
      return;
    }
    setPeople((prev) => prev.filter((p) => p.id !== id));
    toast.success("Personnel deleted");
  }

  async function changeStatus(id: string, status: string) {
    const { ok, data } = await apiCall<{ result?: { discordSyncWarning?: string } }>(`/api/admin/personnel/${id}/status`, { method: "POST", body: { status } });
    if (!ok) {
      toast.error(data.error || "Failed to update status");
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, status: status as PersonnelRow["status"] } : p)));
    toast.success(`Access ${status === "Active" ? "restored" : "revoked"}`);
    if (data.result?.discordSyncWarning) toast.warning(data.result.discordSyncWarning);
  }

  async function syncRequests() {
    setSyncing(true);
    try {
      const { ok, data } = await apiCall<{ result: { warning?: string; emailFound: number; discordFound: number }; requests: OnboardingRequestRow[] }>(
        "/api/admin/personnel/onboarding-requests/sync",
        { method: "POST" }
      );
      if (!ok) {
        toast.error(data.error || "Failed to sync onboarding requests");
        return;
      }
      setPending(data.requests);
      setSyncWarning(data.result.warning ?? null);
      if (data.result.warning) toast.warning(data.result.warning);
      else toast.success(`Synced ${data.result.emailFound} email and ${data.result.discordFound} Discord request${data.result.discordFound === 1 ? "" : "s"}`);
    } finally {
      setSyncing(false);
    }
  }

  // Approving is the only thing that grants access. Syncing brings requests in; it never acts on them.
  async function approve(request: OnboardingRequestRow, email?: string) {
    const { ok, data } = await apiCall<{ result: { email: string; followUp?: string } }>(
      `/api/admin/personnel/onboarding-requests/${request.id}/approve`,
      { method: "POST", body: email ? { email } : {} }
    );
    if (!ok) {
      toast.error(data.error || "Failed to approve request");
      return;
    }
    setPending((prev) => prev.filter((r) => r.id !== request.id));
    setApproveFor(null);
    setApproveEmail("");
    toast.success(`Access granted to ${data.result.email}`);
    if (data.result.followUp) toast.info(data.result.followUp);
    // Refresh personnel list so the newly-onboarded artist shows up immediately.
    const refreshed = await apiCall<{ personnel: PersonnelRow[] }>("/api/admin/personnel");
    if (refreshed.ok) setPeople(refreshed.data.personnel);
  }

  function startApprove(request: OnboardingRequestRow) {
    if (request.email) {
      approve(request);
      return;
    }
    setApproveEmail("");
    setApproveFor(request);
  }

  async function reject(requestId: string) {
    const { ok, data } = await apiCall(`/api/admin/personnel/onboarding-requests/${requestId}/reject`, { method: "POST" });
    if (!ok) {
      toast.error(data.error || "Failed to decline request");
      return;
    }
    setPending((prev) => prev.filter((r) => r.id !== requestId));
    toast.success("Request declined");
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className={cardClass}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>Onboarding Requests</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Everyone waiting to be let in, however they asked — the public access form, or turning up in the
              Discord server with no role. Nothing here is acted on until you approve it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={syncRequests} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
            {/* /apply has no session and isn't in any internal nav by design
                (it's for people who don't have an account yet) — this is the
                one place an admin would naturally look for how to actually
                send someone the link, so it lives here rather than nowhere. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(`${window.location.origin}/apply`);
                toast.success("Application link copied");
              }}
            >
              <Link2 className="h-3.5 w-3.5" /> Copy application link
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {syncWarning && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{syncWarning}</span>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Portfolio</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    No pending requests.
                  </TableCell>
                </TableRow>
              ) : (
                pending.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        {r.source === "discord" ? <MessageSquare className="h-3 w-3" /> : <Mail className="h-3 w-3" />}
                        {r.source === "discord" ? "Discord" : "Email"}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.name || "-"}</TableCell>
                    <TableCell className="text-sm">
                      {r.email || (r.discordUsername ? `@${r.discordUsername}` : "-")}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(r.details.portfolioUrl as string) || "N/A"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(r.requestedAt ?? r.firstSeenAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 justify-end">
                        <Button size="sm" onClick={() => startApprove(r)}>Approve</Button>
                        <Button size="sm" variant="outline" onClick={() => reject(r.id)}>Decline</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Only reached for a request with no email of its own, which in practice means every Discord one. */}
      <Dialog open={approveFor !== null} onOpenChange={(open) => !open && setApproveFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {approveFor?.name || approveFor?.discordUsername || "request"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Discord doesn&apos;t tell us anyone&apos;s email address, so this request needs the address they&apos;ll
              sign in with. Their Discord role and channel are created separately, from the Discord Team Manager.
            </p>
            <div>
              <Label htmlFor="approve-email">Email</Label>
              <Input
                id="approve-email"
                type="email"
                value={approveEmail}
                onChange={(e) => setApproveEmail(e.target.value)}
                placeholder="artist@example.com"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => approveFor && approve(approveFor, approveEmail.trim())}
              disabled={!approveEmail.trim()}
            >
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Personnel</CardTitle>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Add personnel</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add personnel</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div>
                    <Label htmlFor="add-name">Name</Label>
                    <Input id="add-name" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="add-email">Email</Label>
                    <Input id="add-email" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Roles</Label>
                    <div className="flex gap-1.5 flex-wrap mt-1">
                      {ROLE_OPTIONS.map((role) => (
                        <Badge
                          key={role}
                          variant={addForm.roles.includes(role) ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => toggleAddRole(role)}
                        >
                          {role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={addPersonnel}>Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Onboarded</TableHead>
                <TableHead>Access</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                    No personnel yet.
                  </TableCell>
                </TableRow>
              ) : (
                people.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.email}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="flex gap-1 flex-wrap text-left cursor-pointer hover:opacity-80"
                        onClick={() => openEditRoles(p)}
                      >
                        {p.roles.map((r) => (
                          <Badge key={r} variant="secondary">{r}</Badge>
                        ))}
                      </button>
                      <Dialog
                        open={editRolesFor === p.id}
                        onOpenChange={(v) => !v && setEditRolesFor(null)}
                      >
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Edit roles for {p.name}</DialogTitle>
                          </DialogHeader>
                          <div className="flex gap-1.5 flex-wrap">
                            {ROLE_OPTIONS.map((role) => (
                              <Badge
                                key={role}
                                variant={editRolesSet.has(role) ? "default" : "outline"}
                                className="cursor-pointer"
                                onClick={() => toggleEditRole(role)}
                              >
                                {role}
                              </Badge>
                            ))}
                          </div>
                          <DialogFooter>
                            <Button onClick={() => saveRoles(p.id)}>Save</Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status] || "secondary"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(p.dateOnboarded, "N/A")}
                    </TableCell>
                    <TableCell>
                      <Select value={p.status} onValueChange={(v) => changeStatus(p.id, v)}>
                        <SelectTrigger className="w-[140px] h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Active">Active</SelectItem>
                          <SelectItem value="Inactive" disabled={p.id === currentPersonnelId}>
                            Inactive
                          </SelectItem>
                          <SelectItem value="Blacklisted" disabled={p.id === currentPersonnelId}>
                            Blacklisted
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            disabled={p.id === currentPersonnelId}
                            aria-label={`Delete ${p.name}`}
                            title={p.id === currentPersonnelId ? "You can't delete your own account" : `Delete ${p.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This can&apos;t be undone. If they have pipeline history (assigned assets, uploads, marketing activity), the delete will be refused - set them to Inactive instead.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deletePersonnel(p.id)}>Delete</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
