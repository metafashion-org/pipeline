"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Combobox,
    ComboboxInput,
    ComboboxContent,
    ComboboxList,
    ComboboxItem,
    ComboboxEmpty,
} from "@/components/ui/combobox";

interface AssignTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (artistEmail: string) => void;
    onCancel: () => void;
    artistEmails: string[];
}

export function AssignTaskDialog({
    open,
    onOpenChange,
    onSubmit,
    onCancel,
    artistEmails,
}: AssignTaskDialogProps) {
    const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

    const handleOpenChange = (next: boolean) => {
        if (!next) {
            setSelectedEmail(null);
        }
        onOpenChange(next);
    };

    const handleAssign = () => {
        if (selectedEmail) {
            onSubmit(selectedEmail);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Assign Task</DialogTitle>
                    <DialogDescription>
                        Search and select an artist to assign this task to.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="artist" className="text-right">
                            Artist
                        </Label>
                        <div className="col-span-3">
                            <Combobox
                                value={selectedEmail}
                                onValueChange={setSelectedEmail}
                            >
                                <ComboboxInput placeholder="Select an artist..." />
                                <ComboboxContent>
                                    <ComboboxList>
                                        <ComboboxEmpty>No artists found.</ComboboxEmpty>
                                        {artistEmails.map((email) => (
                                            <ComboboxItem key={email} value={email}>
                                                {email}
                                            </ComboboxItem>
                                        ))}
                                    </ComboboxList>
                                </ComboboxContent>
                            </Combobox>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button data-testid="assign-submit" onClick={handleAssign} disabled={!selectedEmail}>
                        Assign
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
