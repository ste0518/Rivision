"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
import { clearDebugData, loadStorageSettings, persistRevisionCandidates, saveStorageSettings } from "@/lib/storage";
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
  const [replacePack, setReplacePack] = useState(() =>
    typeof window !== "undefined" ? loadStorageSettings().uploadReplacePack : true,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ files: File[]; kind: "notes" | "guidance" } | null>(null);

  const allFiles = useMemo(() => [...store.notesFiles, ...store.guidanceFiles] as StudyFile[], [store.guidanceFiles, store.notesFiles]);

  const canGenerate = useMemo(() => {
    if (allFiles.length === 0) return false;
    const hasLecture = allFiles.some((f) => f.role === "lecture_notes");
    const hasAssessment = allFiles.some((f) => isAssessmentRole(f.role));
    return hasLecture || hasAssessment;
  }, [allFiles]);

  function persistReplaceSetting(next: boolean) {
    setReplacePack(next);
    saveStorageSettings({ ...loadStorageSettings(), uploadReplacePack: next });
  }

  async function parseIncoming(files: File[]): Promise<StudyFile[] | GuidanceFile[]> {
    return Promise.all(
      files.map(async (file) => {
        const parsedDocument = await parseStudyFile(file);
        const role = inferStudyFileRole(file.name);
        return {
          id: createId("upload"),
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
  }

  async function commitUpload(files: File[], kind: "notes" | "guidance") {
    const parsed = await parseIncoming(files);
    if (kind === "notes") {
      if (replacePack) store.replaceNotesAndClearGenerated(parsed as StudyFile[], true);
      else store.addNotesFiles(parsed as StudyFile[]);
    } else if (replacePack) {
      store.replaceGuidanceAndClearGenerated(parsed.map((file) => ({ ...file, kind: "guidance" })) as GuidanceFile[]);
    } else {
      store.addGuidanceFiles(parsed.map((file) => ({ ...file, kind: "guidance" })) as GuidanceFile[]);
    }
  }

  async function handleFiles(files: FileList | null, kind: "notes" | "guidance") {
    if (!files?.length) return;
    const list = Array.from(files);
    const shouldConfirmReplace = replacePack && Boolean(store.studentRevisionPack);
    if (shouldConfirmReplace) {
      setPendingUpload({ files: list, kind });
      setConfirmOpen(true);
      return;
    }
    setLoading(true);
    try {
      await commitUpload(list, kind);
    } finally {
      setLoading(false);
    }
  }

  async function runGeneratePack() {
    if (!canGenerate) return;
    setGenerating(true);
    setMessage("");
    try {
      store.ensureActivePackId();
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
          ? "Some review cards were generated by fallback extraction."
          : undefined;
      const studentPackWithNote = {
        ...studentPack,
        examOverview: { ...studentPack.examOverview, ...(recallWarning ? { reviewCardsWarning: recallWarning } : {}) },
      };

      const starterPractice = generateQuickPracticeQuestions(studentPackWithNote, 18);
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

  const primaryNotesName =
    store.notesFiles.find((f) => f.role === "lecture_notes")?.name ?? store.notesFiles[0]?.name ?? "";

  const hasRealStudyPack = Boolean(store.studentRevisionPack);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload course materials"
        description="Classify files so Rivision can weight lectures vs assessment evidence. By default a new upload replaces the current pack — switch to “Add to current pack” only when you mean to merge sources."
      />

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Upload behaviour</CardTitle>
              <CardDescription>Controls whether new files replace your saved study pack and progress.</CardDescription>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replacePack}
                onChange={(event) => persistReplaceSetting(event.target.checked)}
                className="rounded border-slate-300"
              />
              {hasRealStudyPack ? "Replace current study pack (recommended)" : "Create new study pack from uploads (recommended)"}
            </label>
          </div>
          {!replacePack ? (
            <p className="text-sm text-amber-900">
              Advanced: new files will be appended. Generate again to merge them into one pack; older cards may mix sources.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2 text-red-800 border-red-200 hover:bg-red-50" onClick={() => store.clearCurrentPack()}>
              <Trash2 className="h-4 w-4" />
              Clear current pack
            </Button>
          </div>
          {primaryNotesName ? (
            <p className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">Current file:</span> {primaryNotesName}
            </p>
          ) : null}
        </CardHeader>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <h2 className="text-lg font-semibold text-slate-950">Replace current study pack?</h2>
          <p className="text-sm text-slate-600">
            This will clear the current pack, review cards, practice questions, and progress for the previous upload before adding the new file(s).
          </p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => { setConfirmOpen(false); setPendingUpload(null); }}>
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={() => {
                const job = pendingUpload;
                setConfirmOpen(false);
                setPendingUpload(null);
                if (!job) return;
                void (async () => {
                  setLoading(true);
                  try {
                    await commitUpload(job.files, job.kind);
                  } finally {
                    setLoading(false);
                  }
                })();
              }}
            >
              Replace and continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-2">
        <UploadBox
          title="Lecture notes & sources"
          description="Notes, chapters, formula sheets"
          buttonLabel={
            replacePack ?
              hasRealStudyPack ?
                "Upload file and replace current study pack"
              : "Upload file and create study pack"
            : "Add lecture files"
          }
          onChange={(files) => void handleFiles(files, "notes")}
          disabled={loading}
        />
        <UploadBox
          title="Assessment & evidence"
          description="Exam guidance, past papers, problem sheets, solutions"
          buttonLabel={replacePack ? "Upload and replace assessment slot" : "Add assessment files"}
          onChange={(files) => void handleFiles(files, "guidance")}
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
  buttonLabel,
  onChange,
  disabled,
}: {
  title: string;
  description: string;
  buttonLabel: string;
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
          <span className="font-medium">{buttonLabel}</span>
          <span className="mt-1 text-sm text-slate-500">PDF, Word, text, or Markdown</span>
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
