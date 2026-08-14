"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface FeedbackDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (feedback: string) => void
    onCancel: () => void
}

export function FeedbackDialog({ open, onOpenChange, onSubmit, onCancel }: FeedbackDialogProps) {
    const [feedback, setFeedback] = useState("");

    const handleSubmit = () => {
        if (!feedback.trim()) return;
        onSubmit(feedback.trim());
        setFeedback("");
    };

    const handleCancel = () => {
        setFeedback("");
        onCancel();
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen) => {
            if (!isOpen) handleCancel();
            onOpenChange(isOpen);
        }}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Send Feedback</DialogTitle>
                    <DialogDescription>
                        Provide feedback for the artist. They will be notified via email.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="feedback">Feedback</Label>
                        <Textarea
                            id="feedback"
                            value={feedback}
                            onChange={(e) => setFeedback(e.target.value)}
                            placeholder="Describe what needs to be revised…"
                            rows={4}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button data-testid="feedback-submit" onClick={handleSubmit} disabled={!feedback.trim()}>
                        Send Feedback
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
