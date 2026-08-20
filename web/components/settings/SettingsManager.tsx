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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CurationFieldSelector } from "./CurationFieldSelector";

interface StatusRow {
  key: string;
  label: string;
  sortOrder: number;
  description: string | null;
  nextActionHint: string | null;
}

interface TransitionRuleRow {
  fromStatus: string;
  toStatus: string;
  role: string | null;
  isAutomatic: boolean;
  triggerNote: string | null;
}

interface CurationFieldRow {
  fieldKey: string;
  displayName: string;
  includeInArtistEmail: boolean;
  sortOrder: number;
}

export function SettingsManager({
  initialStatuses,
  initialRules,
  initialCurationFields,
}: {
  initialStatuses: StatusRow[];
  initialRules: TransitionRuleRow[];
  initialCurationFields: CurationFieldRow[];
}) {
  const [statuses, setStatuses] = useState(initialStatuses);
  const [rules, setRules] = useState(initialRules);
  const [statusForm, setStatusForm] = useState({ key: "", label: "", sortOrder: statuses.length + 1, description: "", nextActionHint: "" });
  const [ruleForm, setRuleForm] = useState({ fromStatus: "", toStatus: "", role: "", isAutomatic: false, triggerNote: "" });
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);

  async function saveStatus() {
    const res = await fetch("/api/admin/statuses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(statusForm),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to save status");
      return;
    }
    setStatuses((prev) => {
      const others = prev.filter((s) => s.key !== data.status.key);
      return [...others, data.status].sort((a, b) => a.sortOrder - b.sortOrder);
    });
    setStatusDialogOpen(false);
    toast.success(`Status '${data.status.label}' saved`);
  }

  async function saveRule() {
    const res = await fetch("/api/admin/transition-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ruleForm, role: ruleForm.role || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Failed to save transition rule");
      return;
    }
    setRules((prev) => {
      const others = prev.filter((r) => !(r.fromStatus === data.rule.fromStatus && r.toStatus === data.rule.toStatus));
      return [...others, data.rule];
    });
    setRuleDialogOpen(false);
    toast.success(`Transition rule '${data.rule.fromStatus} → ${data.rule.toStatus}' saved`);
  }

  const cardClass = "shadow-sm hover:shadow-md transition-shadow";

  return (
    <div className="flex flex-col gap-6">
      <Card className={cardClass}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Statuses</CardTitle>
            <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Add status</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add / edit status</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div>
                    <Label htmlFor="status-key">Key</Label>
                    <Input id="status-key" value={statusForm.key} onChange={(e) => setStatusForm({ ...statusForm, key: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="status-label">Label</Label>
                    <Input id="status-label" value={statusForm.label} onChange={(e) => setStatusForm({ ...statusForm, label: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="status-sort">Sort order</Label>
                    <Input
                      id="status-sort"
                      type="number"
                      value={statusForm.sortOrder}
                      onChange={(e) => setStatusForm({ ...statusForm, sortOrder: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="status-hint">Next action hint</Label>
                    <Input id="status-hint" value={statusForm.nextActionHint} onChange={(e) => setStatusForm({ ...statusForm, nextActionHint: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={saveStatus}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Next action hint</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">No statuses configured.</TableCell>
                </TableRow>
              ) : (
                statuses.map((s) => (
                  <TableRow key={s.key}>
                    <TableCell>{s.sortOrder}</TableCell>
                    <TableCell className="font-mono text-sm">{s.key}</TableCell>
                    <TableCell>{s.label}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{s.nextActionHint}</TableCell>
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
            <CardTitle>Transition Rules</CardTitle>
            <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">Add rule</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add / edit transition rule</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-3">
                  <div>
                    <Label htmlFor="rule-from">From status key</Label>
                    <Input id="rule-from" value={ruleForm.fromStatus} onChange={(e) => setRuleForm({ ...ruleForm, fromStatus: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="rule-to">To status key</Label>
                    <Input id="rule-to" value={ruleForm.toStatus} onChange={(e) => setRuleForm({ ...ruleForm, toStatus: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="rule-role">Allowed role (blank = automatic)</Label>
                    <Input id="rule-role" value={ruleForm.role} onChange={(e) => setRuleForm({ ...ruleForm, role: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="rule-note">Trigger note</Label>
                    <Input id="rule-note" value={ruleForm.triggerNote} onChange={(e) => setRuleForm({ ...ruleForm, triggerNote: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={saveRule}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Trigger note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center h-24">No transition rules configured.</TableCell>
                </TableRow>
              ) : (
                rules.map((r) => (
                  <TableRow key={`${r.fromStatus}-${r.toStatus}`}>
                    <TableCell className="font-mono text-sm">{r.fromStatus}</TableCell>
                    <TableCell className="font-mono text-sm">{r.toStatus}</TableCell>
                    <TableCell>
                      {r.role ? (
                        <Badge variant="secondary">{r.role}</Badge>
                      ) : (
                        <Badge variant="outline">automatic</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.triggerNote}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className={cardClass}>
        <CardHeader>
          <CardTitle>Brief Fields</CardTitle>
        </CardHeader>
        <CardContent>
          <CurationFieldSelector initialFields={initialCurationFields} />
        </CardContent>
      </Card>
    </div>
  );
}
