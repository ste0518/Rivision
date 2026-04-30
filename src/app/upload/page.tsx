"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { parseStudyFile } from "@/lib/parsers";
import { createId } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";
import type { GuidanceFile, StudyFile } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const store = useStudyStore();
  const [loading, setLoading] = useState(false);
  async function handleFiles(files: FileList | null, kind: "notes" | "guidance") {
    if (!files?.length) return;
    setLoading(true);
    const parsed = await Promise.all(Array.from(files).map(async (file) => {
      const parsedDocument = await parseStudyFile(file);
      return {
        id: createId(kind),
        name: file.name,
        mimeType: file.type || "unknown",
        size: file.size,
        uploadedAt: new Date().toISOString(),
        content: parsedDocument.fullText,
        parsedDocument,
      };
    }));
    if (kind === "notes") store.addNotesFiles(parsed as StudyFile[]);
    else store.addGuidanceFiles(parsed.map((file) => ({ ...file, kind: "guidance" })) as GuidanceFile[]);
    setLoading(false);
  }
  return <div><PageHeader title="Upload notes and guidance" description="Add lecture notes and exam guidance files. PDF/DOCX/TXT/Markdown are parsed into extraction-ready text with diagnostics." /><div className="grid gap-6 lg:grid-cols-2"><UploadBox title="Lecture notes" description="PDF, Markdown, TXT, or DOCX" onChange={(files) => handleFiles(files, "notes")} /><UploadBox title="Guidance files" description="Exam scope, lecturer notes, or checklist files" onChange={(files) => handleFiles(files, "guidance")} /></div><Card className="mt-6"><CardHeader><CardTitle>Uploaded files</CardTitle><CardDescription>Files are stored locally in this browser.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><FileList title="Notes" files={store.notesFiles} onDelete={store.removeNotesFile} /><FileList title="Guidance" files={store.guidanceFiles} onDelete={store.removeGuidanceFile} /><div className="md:col-span-2"><Button disabled={loading} onClick={() => router.push("/extract")}>{loading ? "Reading files..." : "Start extraction"}</Button></div></CardContent></Card></div>;
}
function UploadBox({ title, description, onChange }: { title: string; description: string; onChange: (files: FileList | null) => void }) { return <Card><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent><label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center hover:bg-slate-50"><UploadCloud className="mb-3 text-blue-700" /><span className="font-medium">Choose files</span><span className="text-sm text-slate-500">Multiple files supported</span><input type="file" multiple className="sr-only" accept=".pdf,.md,.txt,.docx,text/*" onChange={(e) => onChange(e.target.files)} /></label></CardContent></Card>; }
function FileList({ title, files, onDelete }: { title: string; files: Array<{ id: string; name: string; size: number }>; onDelete: (id: string) => void }) { return <div><h3 className="mb-2 font-medium">{title}</h3><div className="space-y-2">{files.length === 0 ? <p className="text-sm text-slate-500">No files yet.</p> : files.map((file) => <div key={file.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm"><div><span className="font-medium">{file.name}</span><span className="ml-2 text-slate-500">{Math.round(file.size / 1024)} KB</span></div><Button size="sm" variant="outline" onClick={() => onDelete(file.id)}>Delete</Button></div>)}</div></div>; }
