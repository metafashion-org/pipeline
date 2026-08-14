"use client";

import { useState } from "react";
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
import { toast } from "sonner";

const ROLE_OPTIONS = ["admin", "operator", "curator", "artist", "publisher", "marketing", "payment_admin"];

interface PersonnelRow {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Active" | "Blacklisted" | "Inactive";
  dateOnboarded: string | null;
}

interface SubmissionRow {
  id: string;
  submitterEmail: string | null;
  values: Record<string, unknown>;
  createdAt: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  Active: "default",
  Inactive: "secondary",
  Blacklisted: "destructive",
};

const cardClass = "shadow-sm hover:shadow-md transition-all";

export function PersonnelManager({
  currentPersonnelId,
  initialPersonnel,
  initialPendingSubmissions,
}: {
  currentPersonnelId?: string;
  initialPersonnel: PersonnelRow[];
  initialPendingSubmissions: SubmissionRow[];
}) {
  const [people, setPeople] = useState(initialPersonnel);
  const [pending, setPending] = useState(initialPendingSubmissions);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", roles: [] as string[] });

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
    const res = await fetch("/api/admin/personnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(addForm),
    });
    const data = await res.json();
    if (!res.ok) {
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

  async function changeStatus(id: string, status: string) {
    const res = await fetch(`/api/admin/personnel/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to update status");
      return;
    }
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, status: status as PersonnelRow["status"] } : p)));
    toast.success(`Access ${status === "Active" ? "restored" : "revoked"}`);
  }

  async function approve(submissionId: string) {
    const res = await fetch(`/api/admin/personnel/submissions/${submissionId}/approve`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to approve request");
      return;
    }
    setPending((prev) => prev.filter((s) => s.id !== submissionId));
    toast.success(`Access granted to ${data.result.email}`);
    // Refresh personnel list so the newly-onboarded artist shows up immediately.
    const refreshed = await fetch("/api/admin/personnel").then((r) => r.json());
    setPeople(refreshed.personnel);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className={cardClass}>
        <CardHeader>
          <CardTitle>Pending Access Requests</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Portfolio</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center h-24 text-muted-foreground">
                    No pending requests.
                  </TableCell>
                </TableRow>
              ) : (
                pending.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{(s.values.fullName as string) || "-"}</TableCell>
                    <TableCell className="text-sm">{s.submitterEmail || (s.values.email as string) || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{(s.values.portfolioUrl as string) || "N/A"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Button size="sm" onClick={() => approve(s.id)}>Approve</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    No personnel yet.
                  </TableCell>
                </TableRow>
              ) : (
                people.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-sm">{p.email}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {p.roles.map((r) => (
                          <Badge key={r} variant="secondary">{r}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status] || "secondary"}>{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {p.dateOnboarded ? new Date(p.dateOnboarded).toLocaleDateString() : "N/A"}
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
