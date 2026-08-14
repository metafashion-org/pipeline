import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Asset } from "@/lib/types";

interface EditTaskDialogProps {
    task: Asset;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (updates: Partial<Asset>) => Promise<void>;
}

export function EditTaskDialog({ task, open, onOpenChange, onSave }: EditTaskDialogProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    // We maintain a local copy of the editable fields
    const [formData, setFormData] = useState<Partial<Asset>>({
        itemName: task.itemName || "",
        itemCategory: task.itemCategory || "",
        artist: task.artist || "",
        emailAddress: task.emailAddress || "",
        budget: task.budget || "",
        itemProportion: task.itemProportion || "",
        mannequinRig: task.mannequinRig || "",
        technicalSpecs: task.technicalSpecs || "",
        recolours: task.recolours || "",
        thoughtBehind: task.thoughtBehind || "",
        primarySources: task.primarySources || "",
        sourceLinks: task.sourceLinks || "",
        refImages: task.refImages || "",
    });

    const handleChange = (field: keyof Asset, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsSubmitting(true);
        try {
            await onSave(formData);
            onOpenChange(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0" onPointerDown={e => e.stopPropagation()}>
                <DialogHeader className="px-6 py-4 border-b">
                    <DialogTitle className="text-xl">Edit &quot;{task.itemName}&quot;</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="itemName">Item Name (Curation Title)</Label>
                            <Input id="itemName" value={formData.itemName} onChange={e => handleChange("itemName", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="itemCategory">Category</Label>
                            <Input id="itemCategory" value={formData.itemCategory} onChange={e => handleChange("itemCategory", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="artist">Artist Name</Label>
                            <Input id="artist" value={formData.artist} onChange={e => handleChange("artist", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="emailAddress">Artist Email</Label>
                            <Input id="emailAddress" value={formData.emailAddress} onChange={e => handleChange("emailAddress", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="budget">Budget/Fee</Label>
                            <Input id="budget" value={formData.budget} onChange={e => handleChange("budget", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="itemProportion">Item Proportion / Scale (Reference Mesh)</Label>
                            <Input id="itemProportion" value={formData.itemProportion} onChange={e => handleChange("itemProportion", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="mannequinRig">Mannequin / Rig</Label>
                            <Input id="mannequinRig" value={formData.mannequinRig} onChange={e => handleChange("mannequinRig", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="recolours">Recolours</Label>
                            <Input id="recolours" value={formData.recolours} onChange={e => handleChange("recolours", e.target.value)} />
                        </div>
                    </div>

                    <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                            <Label htmlFor="technicalSpecs">Technical Specs</Label>
                            <Textarea id="technicalSpecs" className="min-h-[80px]" value={formData.technicalSpecs} onChange={e => handleChange("technicalSpecs", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="thoughtBehind">Thought Behind This Curation</Label>
                            <Textarea id="thoughtBehind" className="min-h-[80px]" value={formData.thoughtBehind} onChange={e => handleChange("thoughtBehind", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="primarySources">Primary Source(s) of this Curation</Label>
                            <Textarea id="primarySources" className="min-h-[60px]" value={formData.primarySources} onChange={e => handleChange("primarySources", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="sourceLinks">Source Links</Label>
                            <Textarea id="sourceLinks" className="min-h-[60px]" value={formData.sourceLinks} onChange={e => handleChange("sourceLinks", e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="refImages">Reference Images (Comma separated URLs)</Label>
                            <Textarea id="refImages" className="min-h-[60px]" value={formData.refImages} onChange={e => handleChange("refImages", e.target.value)} />
                        </div>
                    </div>
                </form>

                <DialogFooter className="px-6 py-4 border-t bg-muted/50">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={isSubmitting} onClick={handleSubmit}>
                        {isSubmitting ? "Saving..." : "Save Changes"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
