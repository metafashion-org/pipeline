"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { apiCall } from "@/lib/api-client";
import { toast } from "sonner";
import { ClipboardCheck, Loader2 } from "lucide-react";

// Mirrors CURATION_REVIEW_MODES in lib/settings/app-settings.ts, which a client component can't
// import: that module reaches the database.
type CurationReviewMode = "off" | "admins" | "everyone";

const OPTIONS: { mode: CurationReviewMode; label: string; description: string }[] = [
  {
    mode: "off",
    label: "Off",
    description: "Curators' ideas go straight to Unassigned, as they always have.",
  },
  {
    mode: "admins",
    label: "Admins only",
    description:
      "Only admins get the review form and the Curated column, to try it out. Ideas an admin sends go to Curated. Nobody else sees a change.",
  },
  {
    mode: "everyone",
    label: "Everyone",
    description:
      "Every curator's idea goes to Curated first. The team approves it into Unassigned or sends it back with a note.",
  },
];

/**
 * The on/off switch for the curation review trial. Three positions, so an admin can try it alone
 * before turning it on for the team, and turn it off again without a deploy.
 */
export function CurationReviewSwitch({ initialMode }: { initialMode: CurationReviewMode }) {
  const [mode, setMode] = useState<CurationReviewMode>(initialMode);
  const [saving, setSaving] = useState<CurationReviewMode | null>(null);

  async function choose(next: CurationReviewMode) {
    if (next === mode || saving) return;
    setSaving(next);
    try {
      const { ok, data } = await apiCall<{ mode: CurationReviewMode; movedToUnassigned: string[] }>(
        "/api/admin/settings/curation-review",
        { method: "PUT", body: { mode: next } }
      );
      if (!ok) {
        toast.error(data.error || "Couldn't change the setting");
        return;
      }
      setMode(data.mode);
      const moved = data.movedToUnassigned.length;
      toast.success(
        data.mode === "off" && moved > 0
          ? `Curation review is off. Moved ${moved} card${moved === 1 ? "" : "s"} from Curated to Unassigned.`
          : `Curation review: ${OPTIONS.find((o) => o.mode === data.mode)?.label}`
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4" /> Curation review (trial)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          When it&apos;s on, a curated idea waits in a Curated column before it reaches Unassigned, and the Curation form
          drops fee and deadline, adds picture upload, the category list and a Pinterest board field. Switching back to
          Off moves any card waiting in Curated to Unassigned.
        </p>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Curation review">
          {OPTIONS.map((option) => {
            const selected = option.mode === mode;
            return (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving !== null}
                onClick={() => choose(option.mode)}
                className={`rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span
                    className={`h-3 w-3 rounded-full border ${selected ? "border-primary bg-primary" : "border-muted-foreground"}`}
                    aria-hidden="true"
                  />
                  {option.label}
                  {saving === option.mode && <Loader2 className="h-3 w-3 animate-spin" />}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
