"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { inferStudyFileRole, studyFileRoleLabel } from "@/lib/course-files";
import { toRoleParsedDocument } from "@/lib/parsed-document-from-file";
import { parseStudyFile } from "@/lib/parsers";
import {
  buildRevisionItemsFromStudentPack,
  countTypedPackItems,
  fileToPackSource,
  generateQuickPracticeQuestions,
  generateStudentRevisionPack,
} from "@/lib/revision-pack-generator";
import { extractRevisionItems } from "@/lib/extraction";
import { clearDebugData, loadStorageSettings, persistRevisionCandidates } from "@/lib/storage";
import { createId } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";
import { studyFileRoles, type GuidanceFile, type StudyFile, type StudyFileRole } from "@/lib/types";

function fileKindLabel(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word") || mime.includes("docx")) return "Word";
  if (mime.includes("text") || mime.includes("markdown")) return "Text / Markdown";
  return mime || "File";
}

function isAssessmentRole(role: StudyFileRole) {
  return role === "past_paper" || role === "problem_sheet" || role === "solution_sheet" || role === "mark_scheme" || role === "exam_guidance";
}

export default function UploadPage() {
  const router = useRouter();
  const store = useStudyStore();
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState("");

  const allFiles = useMemo(() => [...store.notesFiles, ...store.guidanceFiles] as StudyFile[], [store.guidanceFiles, store.notesFiles]);

  const canGenerate = useMemo(() => {
    if (allFiles.length === 0) return false;
    const hasLecture = allFiles.some((f) => f.role === "lecture_notes");
    const hasAssessment = allFiles.some((f) => isAssessmentRole(f.role));
    return hasLecture || hasAssessment;
  }, [allFiles]);

  async function handleFiles(files: FileList | null, kind: "notes" | "guidance") {
    if (!files?.length) return;
    setLoading(true);
    const parsed = await Promise.all(
      Array.from(files).map(async (file) => {
        const parsedDocument = await parseStudyFile(file);
        const role = inferStudyFileRole(file.name);
        return {
          id: createId(kind),
          name: file.name,
          role,
          mimeType: file.type || "unknown",
          size: file.size,
          uploadedAt: new Date().toISOString(),
          content: parsedDocument.fullText,
          blob: file,
          parsedDocument: { ...parsedDocument, role },
        };
      }),
    );
    if (kind === "notes") store.addNotesFiles(parsed as StudyFile[]);
    else store.addGuidanceFiles(parsed.map((file) => ({ ...file, kind: "guidance" })) as GuidanceFile[]);
    setLoading(false);
  }

  async function runGeneratePack() {
    if (!canGenerate) return;
    setGenerating(true);
    setMessage("");
    try {
      const uploadedFiles = [...store.notesFiles, ...store.guidanceFiles];
      const allParsedDocuments = uploadedFiles.map(toRoleParsedDocument);
      const notesDocuments = allParsedDocuments.filter((d) => d.role === "lecture_notes" || d.role === "formula_sheet" || d.role === "other");
      const guidanceDocuments = allParsedDocuments.filter((d) => d.role === "exam_guidance");
      const pastPaperDocuments = allParsedDocuments.filter((d) => d.role === "past_paper");
      const problemSheetDocuments = allParsedDocuments.filter((d) => d.role === "problem_sheet");
      const solutionDocuments = allParsedDocuments.filter((d) => d.role === "solution_sheet" || d.role === "mark_scheme");
      const sourceFile = uploadedFiles.map((f) => f.name).join(", ") || "Course files";

      const result = await extractRevisionItems({
        notesDocuments,
        guidanceDocuments,
        pastPaperDocuments,
        problemSheetDocuments,
        solutionDocuments,
        sourceFile,
      });

      const storageSettings = loadStorageSettings();
      try {
        if (storageSettings.persistDebugData) await persistRevisionCandidates(allParsedDocuments);
        else await clearDebugData();
      } catch {
        /* non-fatal */
      }

      const packSources = uploadedFiles.map(fileToPackSource);
      const studentPack = generateStudentRevisionPack({
        files: packSources,
        settings: {
          revisionStyle: storageSettings.revisionStyle,
          aiStrictness: storageSettings.aiStrictness,
        },
      });
      const typedCount = countTypedPackItems(studentPack);
      const recallFromPack = typedCount > 0 ? buildRevisionItemsFromStudentPack(studentPack) : [];
      const recallWarning =
        typedCount === 0 && result.items.length > 0
          ? "Review cards were generated by legacy fallback; regenerate after extraction improves."
          : undefined;
      const studentPackWithNote = {
        ...studentPack,
        examOverview: { ...studentPack.examOverview, ...(recallWarning ? { reviewCardsWarning: recallWarning } : {}) },
      };

      const starterPractice = generateQuickPracticeQuestions(studentPackWithNote, 5);
      const revisionItemsForStore = recallFromPack.length > 0 ? recallFromPack : result.items;

      store.setRevisionItems(revisionItemsForStore, result.rejectedItems, {
        embeddedItems: result.embeddedItems,
        courseMap: result.courseMap,
        courseStructureMap: result.courseStructureMap,
        courseKnowledgeMap: result.courseKnowledgeMap,
        assessmentMap: result.assessmentMap,
        examPriorityMap: result.examPriorityMap,
        revisionPack: result.revisionPack,
        curationReport: result.curationReport,
        studentRevisionPack: studentPackWithNote,
      });
      store.setPracticeQuestions(starterPractice);

      setMessage("Revision pack generated locally. Opening study pack…");
      router.push("/pack");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not generate pack.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload course materials"
        description="Classify files so Rivision can weight lectures vs assessment evidence. Then generate your revision pack — everything runs on your device."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <UploadBox title="Lecture notes & sources" description="Notes, chapters, formula sheets" onChange={(files) => handleFiles(files, "notes")} disabled={loading} />
        <UploadBox
          title="Assessment & evidence"
          description="Exam guidance, past papers, problem sheets, solutions"
          onChange={(files) => handleFiles(files, "guidance")}
          disabled={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your files</CardTitle>
          <CardDescription>For each file: role, type, and status. Adjust the role if the guess is wrong.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <UnifiedFileList files={store.notesFiles} title="Lecture / source files" onDelete={store.removeNotesFile} onRoleChange={store.updateFileRole} hasPack={Boolean(store.studentRevisionPack)} />
          <UnifiedFileList files={store.guidanceFiles} title="Assessment files" onDelete={store.removeGuidanceFile} onRoleChange={store.updateFileRole} hasPack={Boolean(store.studentRevisionPack)} />

          <div className="flex flex-col gap-3 border-t pt-6">
            <Button size="lg" disabled={loading || generating || !canGenerate} onClick={() => void runGeneratePack()}>
              {generating ? "Generating…" : "Generate revision pack"}
            </Button>
            {!canGenerate && allFiles.length > 0 ? (
              <p className="text-sm text-amber-800">Upload at least one lecture note or one assessment file to generate a useful pack.</p>
            ) : null}
            {!canGenerate && allFiles.length === 0 ? <p className="text-sm text-slate-500">Add files above to get started.</p> : null}
            {message ? <p className="text-sm text-slate-600">{message}</p> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UploadBox({
  title,
  description,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  onChange: (files: FileList | null) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-white p-10 text-center hover:bg-slate-50">
          <UploadCloud className="mb-3 text-blue-700" />
          <span className="font-medium">Choose files</span>
          <span className="text-sm text-slate-500">PDF, Word, text, or Markdown</span>
          <input type="file" multiple className="sr-only" accept=".pdf,.md,.txt,.docx,text/*" disabled={disabled} onChange={(e) => onChange(e.target.files)} />
        </label>
      </CardContent>
    </Card>
  );
}

function UnifiedFileList({
  title,
  files,
  onDelete,
  onRoleChange,
  hasPack,
}: {
  title: string;
  files: StudyFile[];
  onDelete: (id: string) => void;
  onRoleChange: (id: string, role: StudyFileRole) => void;
  hasPack: boolean;
}) {
  return (
    <div>
      <h3 className="mb-2 font-medium text-slate-900">{title}</h3>
      <div className="space-y-3">
        {files.length === 0 ? (
          <p className="text-sm text-slate-500">No files yet.</p>
        ) : (
          files.map((file) => {
            const parsedOk = Boolean(file.content?.trim() || file.parsedDocument?.fullText?.trim());
            const status = !parsedOk ? "Uploaded" : hasPack ? "Included in pack" : "Parsed";
            return (
              <div key={file.id} className="rounded-lg border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-2">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                      <p className="font-medium text-slate-950">{file.name}</p>
                      <p className="text-xs text-slate-500">
                        {fileKindLabel(file.mimeType)} · {Math.max(1, Math.round(file.size / 1024))} KB
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => onDelete(file.id)}>
                    Remove
                  </Button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium text-slate-600">
                    Role
                    <Select className="mt-1" value={file.role} onChange={(event) => onRoleChange(file.id, event.target.value as StudyFileRole)}>
                      {studyFileRoles.map((role) => (
                        <option key={role} value={role}>
                          {studyFileRoleLabel(role)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <div className="text-xs">
                    <p className="font-medium text-slate-600">Status</p>
                    <p className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-slate-800">{status}</p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
