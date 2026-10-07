import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Settings' way into the Trial run: a guided walk through the asset pipeline for anyone new. */
export function TrialRunCard() {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskConical className="h-4 w-4" /> Learn the pipeline: Trial run
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Take a test asset from offer to payment on your own. A bot plays the artist and its emails and Discord messages come to you, so you see what an
          artist sees at every step. Nothing touches real artists or real money.
        </p>
        <Button asChild size="sm">
          <Link href="/admin/trial">Open the Trial run</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
