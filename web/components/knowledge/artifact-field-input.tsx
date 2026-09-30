"use client";

import { useState, type ReactNode } from "react";
import { FolderOpen, Link2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReferenceDropzone } from "@/components/kanban/reference-dropzone";
import { ReferenceUploadButton } from "@/components/kanban/reference-upload-button";
import { DriveThumbnail } from "@/components/kanban/drive-thumbnail";
import { extractDriveFileId } from "@/lib/assets/drive-links";
import type { ArtifactFile, ArtifactFormField } from "@/lib/knowledge/artifact-forms";

// app/api/admin/knowledge/uploads/route.ts: files go to Drive, a recolor kit's into its own folder.
const REGISTRY_UPLOAD_URL = "/api/admin/knowledge/uploads";
// A Select can't hold an empty value, so "none picked" has its own.
const NONE_VALUE = "__none__";
const THUMBNAIL_PX = 56;

export interface ArtifactFieldOptions {
  categories: string[];
  trends: { id: string; label: string }[];
  /** The recolor kit's name as typed so far: uploaded images go in a folder with this name. */
  kitName: string;
}

interface FieldProps<T> {
  field: ArtifactFormField;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
}

function asFiles(value: unknown): ArtifactFile[] {
  return Array.isArray(value) ? (value as ArtifactFile[]) : [];
}

// A pasted link, with an upload button beside it when the field allows a file instead.
function LinkInput({ field, value, onChange }: FieldProps<string>) {
  const input = (
    <Input
      id={`artifact-${field.key}`}
      type="url"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder ?? "https://..."}
    />
  );
  if (!field.uploadable) return input;
  return (
    <ReferenceDropzone uploadUrl={REGISTRY_UPLOAD_URL} onUploaded={(urls) => onChange(urls[0])}>
      {({ uploading, uploadFiles }) => (
        <div className="flex items-center gap-2">
          {input}
          <ReferenceUploadButton uploading={uploading} onFiles={(files) => uploadFiles(files.slice(0, 1))} />
        </div>
      )}
    </ReferenceDropzone>
  );
}

// Uploaded files or pasted links, each optionally with a note on what it is.
function FilesInput({ field, value, onChange }: FieldProps<ArtifactFile[]>) {
  const files = asFiles(value);
  const [pasted, setPasted] = useState("");

  function add(entries: ArtifactFile[]) {
    onChange([...files, ...entries]);
  }
  function update(index: number, patch: Partial<ArtifactFile>) {
    onChange(files.map((file, i) => (i === index ? { ...file, ...patch } : file)));
  }
  function remove(index: number) {
    const next = files.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : undefined);
  }
  function addPasted() {
    const url = pasted.trim();
    if (!/^https?:\/\//i.test(url)) return;
    add([{ url, name: url }]);
    setPasted("");
  }

  return (
    <ReferenceDropzone
      uploadUrl={REGISTRY_UPLOAD_URL}
      onUploaded={(_urls, responses) => add(responses.map((r) => ({ url: r.url, name: r.name ?? r.url })))}
    >
      {({ uploading, uploadFiles }) => (
        <div className="space-y-2">
          {files.map((file, index) => (
            <div key={`${file.url}-${index}`} className="flex items-start gap-2 rounded-md border p-2">
              <DriveThumbnail driveRef={{ url: file.url, fileId: extractDriveFileId(file.url) }} size={THUMBNAIL_PX} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-xs">{file.name}</p>
                {field.withNotes && (
                  <Input
                    value={file.note ?? ""}
                    onChange={(e) => update(index, { note: e.target.value })}
                    placeholder="What is this file?"
                    className="h-8 text-xs"
                    aria-label={`Note for ${file.name}`}
                  />
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(index)} aria-label={`Remove ${file.name}`}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPasted();
                }
              }}
              placeholder="Paste a link, or drop files here"
              className="h-8 text-xs"
              aria-label={`Add a link to ${field.label}`}
            />
            <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={addPasted} disabled={!pasted.trim()}>
              <Link2 className="h-3 w-3" /> Add
            </Button>
            <ReferenceUploadButton uploading={uploading} onFiles={uploadFiles} />
          </div>
        </div>
      )}
    </ReferenceDropzone>
  );
}

// A recolor kit's Drive folder: paste an existing folder's link, or drop images to have one made.
function RecolorFolderInput({ field, value, onChange, kitName }: FieldProps<string> & { kitName: string }) {
  const [uploadedCount, setUploadedCount] = useState(0);
  const canUpload = kitName.trim().length > 0;
  return (
    <ReferenceDropzone
      uploadUrl={REGISTRY_UPLOAD_URL}
      extraFields={{ kitName: kitName.trim() }}
      disabled={!canUpload}
      onUploaded={(_urls, responses) => {
        const folderUrl = responses.find((r) => r.folderUrl)?.folderUrl;
        if (folderUrl) onChange(folderUrl);
        setUploadedCount((count) => count + responses.length);
      }}
    >
      {({ uploading, uploadFiles }) => (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              id={`artifact-${field.key}`}
              type="url"
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
            />
            <ReferenceUploadButton uploading={uploading} disabled={!canUpload} onFiles={uploadFiles} />
          </div>
          <p className="text-xs text-muted-foreground">
            {canUpload
              ? uploadedCount > 0
                ? `${uploadedCount} image${uploadedCount === 1 ? "" : "s"} uploaded to the "${kitName.trim()}" folder. Drop more to add them.`
                : `Or drop images here: they go in a new Drive folder called "${kitName.trim()}".`
              : "Type the kit name first to upload images into a new folder."}
          </p>
          {value && (
            <a href={value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <FolderOpen className="h-3 w-3" /> Open the folder
            </a>
          )}
        </div>
      )}
    </ReferenceDropzone>
  );
}

// A Select over a fixed list, with "None" so an optional pick can be cleared.
function PickInput({ field, value, onChange, options }: FieldProps<string> & { options: { value: string; label: string }[] }) {
  return (
    <Select value={value || NONE_VALUE} onValueChange={(v) => onChange(v === NONE_VALUE ? undefined : v)}>
      <SelectTrigger id={`artifact-${field.key}`}>
        <SelectValue placeholder="None" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * One field of the Registry's New Artifact form, drawn by its kind (lib/knowledge/artifact-forms.ts).
 *
 * Input: the field, its current value, a change handler and the lists pick fields choose from.
 * Output: the label, the input and the field's help line.
 */
export function ArtifactFieldInput({
  field,
  value,
  onChange,
  options,
}: {
  field: ArtifactFormField;
  value: unknown;
  onChange: (value: unknown) => void;
  options: ArtifactFieldOptions;
}) {
  const text = typeof value === "string" ? value : undefined;
  let input: ReactNode;
  switch (field.kind) {
    case "text":
      input = <Input id={`artifact-${field.key}`} value={text ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} />;
      break;
    case "textarea":
      input = (
        <Textarea
          id={`artifact-${field.key}`}
          value={text ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={field.key === "description" ? 4 : 2}
        />
      );
      break;
    case "date":
      input = <Input id={`artifact-${field.key}`} type="date" value={text ?? ""} onChange={(e) => onChange(e.target.value)} className="w-[180px]" />;
      break;
    case "link":
      input = <LinkInput field={field} value={text} onChange={onChange} />;
      break;
    case "recolorFolder":
      input = <RecolorFolderInput field={field} value={text} onChange={onChange} kitName={options.kitName} />;
      break;
    case "files":
      input = <FilesInput field={field} value={asFiles(value)} onChange={onChange} />;
      break;
    case "category":
      input = <PickInput field={field} value={text} onChange={onChange} options={options.categories.map((c) => ({ value: c, label: c }))} />;
      break;
    case "trend":
      input = <PickInput field={field} value={text} onChange={onChange} options={options.trends.map((t) => ({ value: t.id, label: t.label }))} />;
      break;
    case "tags":
      input = (
        <Input
          id={`artifact-${field.key}`}
          value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
          onChange={(e) => {
            const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean);
            onChange(tags.length > 0 ? tags : undefined);
          }}
          placeholder={field.placeholder}
        />
      );
      break;
  }

  return (
    <div className="space-y-1">
      <label htmlFor={`artifact-${field.key}`} className="flex items-center gap-1 text-xs text-muted-foreground">
        {field.label}
        {field.required ? <span className="text-destructive">*</span> : <span className="text-muted-foreground/60">(optional)</span>}
      </label>
      {input}
      {field.help && field.kind !== "recolorFolder" && <p className="text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}
