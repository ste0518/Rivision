"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { AlertTriangle, CheckCircle2, ClipboardList, FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { inferStudyFileRole, studyFileRoleLabel } from "@/lib/course-files";
import { parseStudyFile } from "@/lib/parsers";
import { clearDebugData, loadStorageSettings, saveStorageSettings } from "@/lib/storage";
import { createId } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";
import type { ExamPackJobResult, ExtractionJobStatusRecord, ExtractionMode } from "@/lib/jobs/types";
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
  const [packGenerateProgress, setPackGenerateProgress] = useState(0);
  const [packGeneratePhase, setPackGeneratePhase] = useState("");
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>("standard");
  const [activeJob, setActiveJob] = useState<ExtractionJobStatusRecord | null>(null);
  const packProgressNudgeRef = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [replacePack, setReplacePack] = useState(() =>
    typeof window !== "undefined" ? loadStorageSettings().uploadReplacePack : true,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<{ files: File[]; kind: "notes" | "guidance" } | null>(null);

  const allFiles = useMemo(() => [...store.notesFiles, ...store.guidanceFiles] as StudyFile[], [store.guidanceFiles, store.notesFiles]);

  function stopPackProgressNudge() {
    if (packProgressNudgeRef.current) {
      clearInterval(packProgressNudgeRef.current);
      packProgressNudgeRef.current = null;
    }
  }

  useEffect(() => {
    return () => stopPackProgressNudge();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const syncApiKey = async () => {
      try {
        const response = await fetch("/api/settings-status");
        const body = (await response.json()) as { openaiConfigured?: boolean };
        if (!cancelled) setApiKeyReady(Boolean(body.openaiConfigured));
      } catch {
        if (!cancelled) setApiKeyReady(false);
      }
    };
    void syncApiKey();
    window.addEventListener("rivision-settings", syncApiKey);
    window.addEventListener("storage", syncApiKey);
    return () => {
      cancelled = true;
      window.removeEventListener("rivision-settings", syncApiKey);
      window.removeEventListener("storage", syncApiKey);
    };
  }, []);

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
        const parsedDocument = await parseStudyFile(file, { runOcr: false });
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
    setMessage("");
    try {
      await commitUpload(list, kind);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not read or parse the file.");
    } finally {
      setLoading(false);
    }
  }

  async function runGeneratePack() {
    if (!canGenerate) return;
    setGenerating(true);
    setMessage("");
    setActiveJob(null);
    stopPackProgressNudge();

    try {
      const serverStatus = await fetch("/api/settings-status").then((res) => res.json() as Promise<{ openaiConfigured?: boolean }>).catch(() => ({ openaiConfigured: false }));
      if (!serverStatus.openaiConfigured) {
        setMessage("Configure OPENAI_API_KEY in Vercel before generating an exam pack. API keys are no longer sent from this browser.");
        router.push("/settings");
        return;
      }

      setPackGenerateProgress(2);
      setPackGeneratePhase("Prepare · creating secure Blob upload");
      store.resetDerivedPackState();
      store.ensureActivePackId();
      await clearDebugData().catch(() => undefined);

      const jobId = createId("job");
      const filesForUpload = allFiles.map((studyFile) => ({ studyFile, inputFile: studyFileToInputFile(studyFile) }));
      if (filesForUpload.some((entry) => !entry.inputFile)) {
        throw new Error("One or more uploaded files are missing their original file data. Re-upload the file and try again.");
      }

      const blobFiles = [];
      for (let index = 0; index < filesForUpload.length; index += 1) {
        const entry = filesForUpload[index]!;
        const file = entry.inputFile!;
        const pathname = `uploads/${jobId}/${String(index + 1).padStart(2, "0")}-${safeUploadName(file.name)}`;
        setPackGeneratePhase(`Upload · ${file.name}`);
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          clientPayload: JSON.stringify({ jobId }),
          multipart: file.size > 8 * 1024 * 1024,
          contentType: file.type || entry.studyFile.mimeType || "application/octet-stream",
          onUploadProgress: (progress) => {
            const uploadBase = 4 + (index / Math.max(1, filesForUpload.length)) * 22;
            const uploadSpan = 22 / Math.max(1, filesForUpload.length);
            setPackGenerateProgress(Math.round(uploadBase + uploadSpan * (progress.percentage / 100)));
          },
        });
        blobFiles.push({
          url: blob.url,
          pathname: blob.pathname,
          filename: file.name,
          size: file.size,
          contentType: file.type || entry.studyFile.mimeType,
          role: entry.studyFile.role,
        });
      }

      setPackGenerateProgress(28);
      setPackGeneratePhase("Queue · starting background extraction");
      const createJobResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, files: blobFiles, mode: extractionMode }),
      });
      const createJobPayload = (await createJobResponse.json()) as { ok?: boolean; jobId?: string; runOnceUrl?: string; error?: string };
      if (!createJobResponse.ok || !createJobPayload.ok || !createJobPayload.jobId) {
        throw new Error(createJobPayload.error ?? "Could not create extraction job.");
      }
      if (createJobPayload.runOnceUrl) {
        void fetch(createJobPayload.runOnceUrl, { method: "POST" }).catch(() => undefined);
      }

      const completedStatus = await pollJobUntilDone(createJobPayload.jobId);
      if (completedStatus.status === "cancelled") throw new Error("Job cancelled.");
      if (completedStatus.status === "failed") {
        throw new Error(completedStatus.error?.message ?? "Extraction failed. One chunk failed; retry can resume from the last checkpoint.");
      }
      if (!completedStatus.resultUrl) throw new Error("Extraction completed but did not publish a result URL.");

      setPackGenerateProgress(94);
      setPackGeneratePhase("Load · exam pack JSON");
      const result = (await fetch(completedStatus.resultUrl, { cache: "no-store" }).then((res) => res.json())) as ExamPackJobResult;
      if (result.extraction.items.length === 0) throw new Error("API extraction returned no review-ready items. Check the uploaded files are readable and try Fast or Standard mode.");

      store.setRevisionItems(result.extraction.items, result.extraction.rejectedItems, {
        embeddedItems: result.extraction.embeddedItems,
        courseStructureMap: result.extraction.courseStructureMap,
        courseKnowledgeMap: result.extraction.courseKnowledgeMap,
        assessmentMap: result.extraction.assessmentMap,
        examPriorityMap: result.extraction.examPriorityMap,
        revisionPack: result.extraction.revisionPack,
        curationReport: result.extraction.curationReport,
        studentRevisionPack: result.pack,
      });
      store.setPracticeQuestions(result.practiceQuestions);

      setPackGenerateProgress(96);
      setPackGeneratePhase("Open · navigating to exam pack");
      setMessage("Exam pack generated with async API extraction. Opening pack…");
      setPackGenerateProgress(100);
      router.push("/pack");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not generate pack.");
    } finally {
      stopPackProgressNudge();
      setGenerating(false);
      setPackGenerateProgress(0);
      setPackGeneratePhase("");
    }
  }

  async function pollJobUntilDone(jobId: string): Promise<ExtractionJobStatusRecord> {
    const terminal = new Set(["completed", "failed", "cancelled"]);
    const startedAt = Date.now();
    while (true) {
      const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      const status = (await response.json()) as ExtractionJobStatusRecord & { error?: unknown };
      if (!response.ok || !status.ok) throw new Error("Could not read extraction job status.");
      setActiveJob(status);
      setPackGenerateProgress(Math.max(30, Math.min(99, status.progress)));
      setPackGeneratePhase(`${stageLabel(status.currentStage)} · ${status.currentChunk ? `${status.currentChunk} · ` : ""}${status.totalChunks ? `${chunksDone(status)} / ${status.totalChunks} chunks · ` : ""}${elapsedLabel(startedAt)}`);
      if (terminal.has(status.status)) return status;
      await wait(2000);
    }
  }

  async function cancelActiveJob() {
    if (!activeJob || activeJob.status === "completed" || activeJob.status === "failed" || activeJob.status === "cancelled") return;
    await fetch(`/api/jobs/${activeJob.jobId}/cancel`, { method: "POST" }).catch(() => undefined);
    setMessage("Cancellation requested. Already completed chunks remain saved.");
  }

  const primaryNotesName =
    store.notesFiles.find((f) => f.role === "lecture_notes")?.name ?? store.notesFiles[0]?.name ?? "";

  const hasRealStudyPack = Boolean(store.studentRevisionPack);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload course materials"
        description="Give Rivision lecture notes, problem sheets, past papers, or mark schemes. API extraction turns them into one exam pack with priorities, recall cards, worked-method templates, practice questions, and a cram sheet."
      />

      {!apiKeyReady ? (
        <Card className="border-amber-200 bg-amber-50/80">
          <CardContent className="flex flex-col gap-3 py-4 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <p>Add a temporary OpenAI API key, or configure OPENAI_API_KEY in Vercel, before generating. Uploading files still works, but extraction starts only after API access is ready.</p>
            <Link className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-amber-900 px-4 font-medium text-white hover:bg-amber-950" href="/settings">
              Add API key
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base">Upload behaviour</CardTitle>
              <CardDescription>
                Controls whether new files replace your saved exam pack and progress. PDFs are parsed in your browser without OCR so they appear immediately; OCR runs when you generate the exam pack (can take several minutes for large or scanned PDFs).
              </CardDescription>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm sm:self-end">
              <input
                type="checkbox"
                checked={replacePack}
                onChange={(event) => persistReplaceSetting(event.target.checked)}
                className="rounded border-slate-300"
              />
              {hasRealStudyPack ? "Replace current exam pack (recommended)" : "Create new exam pack from uploads (recommended)"}
            </label>
          </div>
          {!replacePack ? (
            <p className="text-sm text-amber-900">
              Advanced: new files will be appended. Generate again to merge them into one exam pack; older cards may mix sources.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-2 text-red-800 border-red-200 hover:bg-red-50" onClick={() => store.clearCurrentPack()}>
              <Trash2 className="h-4 w-4" />
              Clear current exam pack
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
          <h2 className="text-lg font-semibold text-slate-950">Replace current exam pack?</h2>
          <p className="text-sm text-slate-600">
            This will clear the current exam pack, review cards, practice questions, and progress for the previous upload before adding the new file(s).
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
                  setMessage("");
                  try {
                    await commitUpload(job.files, job.kind);
                  } catch (err) {
                    setMessage(err instanceof Error ? err.message : "Could not read or parse the file.");
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

      <SourceReadinessPanel files={allFiles} canGenerate={canGenerate} />

      <div className="grid gap-6 lg:grid-cols-2">
        <UploadBox
          title="Lecture notes & sources"
          description="Notes, chapters, formula sheets"
          buttonLabel={
            replacePack ?
              hasRealStudyPack ?
                "Upload file and replace current exam pack"
              : "Upload file and create exam pack"
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

      {loading ? (
        <div
          className="flex gap-3 rounded-xl border border-blue-200 bg-white/90 px-4 py-3 text-sm text-slate-700 shadow-sm"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-700" aria-hidden />
          <div>
            <p className="font-medium text-slate-900">Parsing your upload…</p>
            <p className="mt-1 text-slate-600">
              Files appear below after the text layer is read (no OCR yet). OCR runs later when you click Generate exam pack. Large PDFs should still finish this step quickly; keep this tab open and watch for errors here.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your files</CardTitle>
          <CardDescription>For each file: role, type, and status. Adjust the role if the guess is wrong.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <UnifiedFileList files={store.notesFiles} title="Lecture / source files" onDelete={store.removeNotesFile} onRoleChange={store.updateFileRole} hasPack={Boolean(store.studentRevisionPack)} />
          <UnifiedFileList files={store.guidanceFiles} title="Assessment files" onDelete={store.removeGuidanceFile} onRoleChange={store.updateFileRole} hasPack={Boolean(store.studentRevisionPack)} />

          <div className="flex flex-col gap-3 border-t pt-6">
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
              <div>
                <p className="text-sm font-medium text-slate-950">Extraction mode</p>
                <p className="mt-1 text-sm text-slate-600">
                  Large files are uploaded to Vercel Blob first, then processed as a background job in chunks.
                </p>
              </div>
              <Select value={extractionMode} onChange={(event) => setExtractionMode(event.target.value as ExtractionMode)} disabled={generating}>
                <option value="fast">Fast · quick pack</option>
                <option value="standard">Standard · recommended</option>
                <option value="deep">Deep · slower, higher cost</option>
              </Select>
            </div>
            <Button size="lg" disabled={loading || generating || !canGenerate || !apiKeyReady} onClick={() => void runGeneratePack()}>
              {generating ? "Generating…" : "Generate exam pack"}
            </Button>
            {!apiKeyReady ? (
              <p className="text-sm text-amber-900">API extraction is required. Add a temporary key in Settings, or configure OPENAI_API_KEY in Vercel.</p>
            ) : null}
            {generating ? (
              <div className="space-y-3">
                <PackGenerateProgressBar phase={packGeneratePhase} progress={packGenerateProgress} />
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-950">
                  <span>
                    {activeJob?.jobId ? `Job ${activeJob.jobId}` : "Uploading to Blob"} · You can leave this page open while extraction runs.
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void cancelActiveJob()} disabled={!activeJob || activeJob.status === "completed"}>
                    Cancel job
                  </Button>
                </div>
              </div>
            ) : null}
            {!canGenerate && allFiles.length === 0 ? (
              <p className="text-sm text-amber-900">Upload at least one file to start — lecture notes and/or assessment materials.</p>
            ) : null}
            {!canGenerate && allFiles.length > 0 ? (
              <p className="text-sm text-amber-800">Set at least one file to lecture notes, formula sheet, or an assessment role so extraction has source material.</p>
            ) : null}
            {message ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{message}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PackGenerateProgressBar({ phase, progress }: { phase: string; progress: number }) {
  const clamped = Math.min(100, Math.max(0, progress));
  const detailLine = phase ? `${Math.round(clamped)}% · ${phase}` : `${Math.round(clamped)}%`;
  return (
    <div
      className="rounded-xl border border-blue-200/80 bg-gradient-to-b from-white to-slate-50/90 px-4 py-3 shadow-sm"
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={detailLine}
      aria-label="Generating exam pack"
      aria-busy={true}
    >
      <div className="mb-2 text-sm font-medium text-slate-800">Generating exam pack</div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/90">
        <div
          className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-sky-500 to-blue-600 transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        >
          <div
            className="rivision-pack-progress-shine pointer-events-none absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-transparent via-white/30 to-transparent"
            aria-hidden
          />
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">{detailLine}</p>
    </div>
  );
}

function studyFileToInputFile(file: StudyFile): File | null {
  if (!file.blob) return null;
  if (file.blob instanceof File) return file.blob;
  return new File([file.blob], file.name, { type: file.mimeType || "application/pdf" });
}

function safeUploadName(name: string) {
  return name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160) || "source.pdf";
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    queued: "Queued",
    processing: "Processing",
    extracting_text: "Extracting text",
    chunking: "Chunking",
    extracting_candidates: "Finding candidates",
    calling_openai: "Calling OpenAI",
    merging_chunks: "Merging chunks",
    building_pack: "Building pack",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[stage] ?? stage;
}

function chunksDone(status: ExtractionJobStatusRecord) {
  if (!status.totalChunks) return 0;
  const progressInsideChunks = Math.max(0, Math.min(58, status.progress - 25));
  return Math.min(status.totalChunks, Math.max(0, Math.floor((progressInsideChunks / 58) * status.totalChunks)));
}

function elapsedLabel(startedAt: number) {
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function SourceReadinessPanel({ files, canGenerate }: { files: StudyFile[]; canGenerate: boolean }) {
  const hasLecture = files.some((f) => f.role === "lecture_notes" || f.role === "formula_sheet");
  const hasAssessment = files.some((f) => isAssessmentRole(f.role));
  const hasPastPaper = files.some((f) => f.role === "past_paper");
  const hasSolutions = files.some((f) => f.role === "solution_sheet" || f.role === "mark_scheme");
  const level =
    hasLecture && hasAssessment && hasSolutions ? "Strong exam pack"
    : hasLecture && hasAssessment ? "Good exam pack"
    : canGenerate ? "Starter exam pack"
    : "Waiting for files";
  const levelClass =
    level === "Strong exam pack" ? "border-green-200 bg-green-50 text-green-950"
    : level === "Good exam pack" ? "border-blue-200 bg-blue-50 text-blue-950"
    : level === "Starter exam pack" ? "border-amber-200 bg-amber-50 text-amber-950"
    : "border-slate-200 bg-slate-50 text-slate-700";
  const nextBest =
    !hasLecture ? "Add lecture notes to capture definitions, formulas, theorems, and course structure."
    : !hasAssessment ? "Add a problem sheet or past paper to make priorities and practice more exam-shaped."
    : !hasSolutions ? "Add solutions or a mark scheme to improve answer style, pitfalls, and marking cues."
    : hasPastPaper ? "You have the strongest mix: notes, assessment evidence, and answer guidance."
    : "A past paper would make pattern detection stronger, but this is already a useful pack.";

  const inputs = [
    { label: "Lecture notes", ok: hasLecture, detail: "Definitions, formulas, proofs, course map" },
    { label: "Problem or past paper", ok: hasAssessment, detail: "Question styles, topic frequency, exam pressure" },
    { label: "Solutions or mark scheme", ok: hasSolutions, detail: "Expected steps, traps, answer quality" },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-blue-700" />
              Exam pack readiness
            </CardTitle>
            <CardDescription className="mt-2">
              A single lecture file is enough to start. Lectures plus assessment material produce a more exam-focused pack.
            </CardDescription>
          </div>
          <span className={`inline-flex w-fit items-center rounded-md border px-3 py-1 text-sm font-medium ${levelClass}`}>{level}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {inputs.map((item) => (
            <div key={item.label} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                {item.ok ? <CheckCircle2 className="h-4 w-4 text-green-700" /> : <AlertTriangle className="h-4 w-4 text-amber-700" />}
                {item.label}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{item.detail}</p>
            </div>
          ))}
        </div>
        <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <span className="font-medium text-slate-950">Next best upload:</span> {nextBest}
        </p>
      </CardContent>
    </Card>
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
