"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

const CURRENCIES = ["INR", "USD", "EUR"] as const;

export function PendingPaymentControls({
  sku,
  currency,
  paymentReceiptUrl,
}: {
  sku: string;
  currency: string | null;
  paymentReceiptUrl: string | null;
}) {
  const [selectedCurrency, setSelectedCurrency] = useState(currency || "INR");
  const [receiptUrl, setReceiptUrl] = useState(paymentReceiptUrl || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(paymentReceiptUrl));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/assets/${sku}/payment-details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: selectedCurrency, paymentReceiptUrl: receiptUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save payment details");
        return;
      }
      setSaved(Boolean(receiptUrl));
      toast.success("Payment details saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={selectedCurrency} onValueChange={setSelectedCurrency}>
        <SelectTrigger className="h-8 w-[86px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CURRENCIES.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={receiptUrl}
        onChange={(e) => setReceiptUrl(e.target.value)}
        placeholder="Receipt link"
        className="h-8 w-[160px] text-xs"
      />
      <Button size="sm" variant={saved ? "outline" : "default"} disabled={saving || !receiptUrl} onClick={save}>
        {saved ? "Update" : "Attach"}
      </Button>
      {saved && receiptUrl && (
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" asChild title="Open receipt">
          <a href={receiptUrl} target="_blank" rel="noopener noreferrer" aria-label="Open receipt">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
}
