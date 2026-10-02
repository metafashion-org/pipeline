"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { KeyRound, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiCall } from "@/lib/api-client";
import { jsonFetcher } from "@/lib/fetcher";
import { formatDateTime } from "@/lib/format-date";

interface ApiKeyRow {
  id: string;
  name: string;
  personEmail: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/**
 * API keys for outside tools such as Instinct, which add Team Tasks without a Google sign-in. A new
 * key is shown once, here, for the admin to hand over; only its hash is kept.
 */
export function ApiKeysManager() {
  const { data, mutate } = useSWR<{ keys: ApiKeyRow[] }>("/api/admin/api-keys", jsonFetcher);
  const [name, setName] = useState("Instinct AI");
  const [email, setEmail] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function create() {
    setWorking(true);
    try {
      const { ok, data: res } = await apiCall<{ key: string }>("/api/admin/api-keys", { method: "POST", body: { name, email } });
      if (!ok) return toast.error(res.error || "Couldn't make the key");
      setNewKey(res.key);
      await mutate();
    } finally {
      setWorking(false);
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Revoke this key? Anything using it stops working.")) return;
    const { ok, data: res } = await apiCall(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    if (!ok) return toast.error(res.error || "Couldn't revoke the key");
    toast.success("Key revoked");
    await mutate();
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4" /> API keys
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          For tools without a Google sign-in, such as Instinct. A key can only list the team and add Team Tasks, at{" "}
          <code>/api/external/team-tasks</code>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="key-name">Name</Label>
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="key-email">Its email</Label>
            <Input id="key-email" value={email} placeholder="assistant@example.com" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button onClick={create} disabled={working || !name.trim() || !email.trim()}>
            Make a key
          </Button>
        </div>

        {newKey && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
            <p className="font-medium">Copy this key now. It won&apos;t be shown again.</p>
            <div className="flex gap-2">
              <code className="flex-1 break-all rounded bg-background p-2 text-xs">{newKey}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(newKey).then(() => toast.success("Copied"))}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">The tool sends it as the header &quot;Authorization: Bearer &lt;key&gt;&quot;.</p>
            <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>
              Done
            </Button>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.keys ?? []).map((k) => (
              <TableRow key={k.id} className={k.revokedAt ? "opacity-50" : undefined}>
                <TableCell>
                  <div>{k.name}</div>
                  <div className="text-xs text-muted-foreground">{k.personEmail}</div>
                </TableCell>
                <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                <TableCell className="text-xs">{k.revokedAt ? `Revoked ${formatDateTime(k.revokedAt)}` : formatDateTime(k.lastUsedAt, "Never")}</TableCell>
                <TableCell className="text-right">
                  {!k.revokedAt && (
                    <Button size="sm" variant="outline" onClick={() => revoke(k.id)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
