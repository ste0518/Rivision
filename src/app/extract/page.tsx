"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBoundary } from "@/components/error-boundary";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { MathMarkdown } from "@/components/MathMarkdown";
import { extractRevisionItems, generateManualExtractionPrompt, loadLlmPipelineSettings } from "@/lib/extraction";
import { getPrimaryCardPreview, hasLowLatexQuality } from "@/lib/card-render";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import { buildSegmentationDebug, segmentRevisionCandidates } from "@/lib/segmentation";
import { toRoleParsedDocument } from "@/lib/parsed-document-from-file";
import { clearDebugData, isDeveloperUiEnabled, loadStorageSettings, persistRevisionCandidates, resetStudyStateStorage, saveStorageSettings } from "@/lib/storage";
import { validateRevisionItemsPayload, withValidation } from "@/lib/validation";
import type { CuratedDeckResult, ExtractionVerificationReport, RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
import { createId } from "@/lib/utils";

export default function ExtractPage() {
  return (
    <ErrorBoundary
      title="Extraction UI error"
      description="The extraction page caught a runtime error. Parsed files remain in local data unless you reset them."
      onResetLocalData={() => {
        void resetStudyStateStorage();
        window.location.reload();
      }}
    >
      <ExtractPageContent />
    </ErrorBoundary>
  );
}

function ExtractPageContent() {
  const [dev, setDev] = useState(false);
  useEffect(() => {
    function sync() {
      setDev(isDeveloperUiEnabled());
    }
    sync();
    window.addEventListener("rivision-settings", sync);
    return () => window.removeEventListener("rivision-settings", sync);
  }, []);
  if (!dev) {
    return (
      <div className="space-y-6">
        <PageHeader title="Extraction" description="These tools are for development and debugging." />
        <Card>
          <CardContent className="space-y-3 pt-6 text-slate-600">
            <p>Enable <strong>Developer mode</strong> in Settings to see raw candidates, curation, and pipeline details.</p>
            <p className="text-sm">For normal study, use <Link className="font-medium text-blue-700 underline" href="/upload">Upload</Link> to build your pack, then open <Link className="font-medium text-blue-700 underline" href="/pack">Study pack</Link>.</p>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800" href="/settings">
                Open settings
              </Link>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/upload">
                Upload materials
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <ExtractPageInner />;
}

function ExtractPageInner() {
  const router = useRouter();
  const store = useStudyStore();
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [verification, setVerification] = useState<ExtractionVerificationReport | null>(null);
  const [manualJson, setManualJson] = useState("");
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string>("");
  const [mathStatus, setMathStatus] = useState<string>("");
  const [runtimeErrors, setRuntimeErrors] = useState<string[]>([]);
  const [debugMode, setDebugMode] = useState(false);
  const [activeTab, setActiveTab] = useState<"kept" | "needs_review" | "rejected" | "embedded" | "course_map">("kept");

  const settings = loadLlmPipelineSettings();
  const uploadedFiles = useMemo(() => [...store.notesFiles, ...store.guidanceFiles], [store.guidanceFiles, store.notesFiles]);
  const allParsedDocuments = useMemo(() => uploadedFiles.map(toRoleParsedDocument), [uploadedFiles]);
  const notesDocuments = useMemo(() => allParsedDocuments.filter((document) => document.role === "lecture_notes" || document.role === "formula_sheet" || document.role === "other"), [allParsedDocuments]);
  const guidanceDocuments = useMemo(() => allParsedDocuments.filter((document) => document.role === "exam_guidance"), [allParsedDocuments]);
  const pastPaperDocuments = useMemo(() => allParsedDocuments.filter((document) => document.role === "past_paper"), [allParsedDocuments]);
  const problemSheetDocuments = useMemo(() => allParsedDocuments.filter((document) => document.role === "problem_sheet"), [allParsedDocuments]);
  const solutionDocuments = useMemo(() => allParsedDocuments.filter((document) => document.role === "solution_sheet" || document.role === "mark_scheme"), [allParsedDocuments]);
  const notesText = useMemo(() => notesDocuments.map((file) => file.fullText).join("\n\n"), [notesDocuments]);
  const guidanceText = useMemo(() => guidanceDocuments.map((file) => file.fullText).join("\n\n"), [guidanceDocuments]);
  const sourceFile = useMemo(() => uploadedFiles.map((file) => file.name).join(", ") || "Mock notes", [uploadedFiles]);
  const allDocuments = allParsedDocuments;
  const candidates = useMemo(() => segmentRevisionCandidates(notesDocuments), [notesDocuments]);
  const segmentationDebug = useMemo(() => buildSegmentationDebug(notesDocuments), [notesDocuments]);
  const candidateSegmentationWarning = segmentationDebug.some((document) => document.warnings.length > 0);
  const needsReviewItems = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted && ((item.curationDecision ?? "keep") !== "keep" || needsRepair(item))), [store.revisionItems]);
  const normalItems = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted && (item.curationDecision ?? "keep") === "keep" && item.standaloneValue !== "low" && !needsRepair(item)), [store.revisionItems]);
  const parsedPageCount = useMemo(() => allDocuments.reduce((total, doc) => total + (doc.pages?.length ?? 0), 0), [allDocuments]);
  const likelyUnderExtraction = parsedPageCount > 50 && candidates.length < 40;
  const noAssessmentEvidence = pastPaperDocuments.length === 0 && problemSheetDocuments.length === 0 && guidanceDocuments.length === 0;
  const lowLatexCount = useMemo(() => store.revisionItems.filter((item) => hasLowLatexQuality(item)).length, [store.revisionItems]);
  const topCourseTopics = useMemo(
    () => store.curationReport?.mainTopics?.length
      ? store.curationReport.mainTopics
      : store.courseStructureMap?.topics.slice(0, 8).map((topic) => topic.name) ?? [],
    [store.courseStructureMap, store.curationReport],
  );
  const failedDocuments = useMemo(
    () => allDocuments.filter((doc) => !doc.diagnostics.success || doc.diagnostics.extractionQuality === "failed" || !doc.fullText.trim()),
    [allDocuments],
  );
  const guidanceFailed = useMemo(
    () => guidanceDocuments.some((doc) => !doc.diagnostics.success || !doc.fullText.trim()),
    [guidanceDocuments],
  );
  const curationDiagnostics = useMemo(() => buildCurationDiagnostics(store.revisionItems, store.rejectedItems, store.embeddedItems), [store.embeddedItems, store.rejectedItems, store.revisionItems]);

  async function runExtraction() {
    setExtracting(true);
    setStatus("");
    setApiError("");
    setRuntimeErrors([]);
    setVerification(null);

    try {
      if (settings.mode === "manual_json_import") {
        setStatus("Manual JSON import mode is enabled. Paste JSON below and validate/import it.");
        return;
      }

      if (failedDocuments.length > 0) {
        setStatus("Extraction blocked: one or more uploaded files failed to parse. Fix parsing issues and retry.");
        return;
      }

      const result = await extractRevisionItems({ notesDocuments, guidanceDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments, sourceFile });
      try {
        const storageSettings = loadStorageSettings();
        if (storageSettings.persistDebugData) await persistRevisionCandidates(allDocuments);
        else await clearDebugData();
      } catch (error) {
        setRuntimeErrors((current) => [...current, renderStorageError(error)]);
      }
      store.setRevisionItems(result.items, result.rejectedItems, {
        embeddedItems: result.embeddedItems,
        courseMap: result.courseMap,
        courseStructureMap: result.courseStructureMap,
        courseKnowledgeMap: result.courseKnowledgeMap,
        assessmentMap: result.assessmentMap,
        examPriorityMap: result.examPriorityMap,
        revisionPack: result.revisionPack,
        curationReport: result.curationReport,
      });
      setVerification(result.verification);
      if (result.error) setApiError(result.error);
      router.push("/pack");

      if (settings.mode === "ai_key_revision_analysis" || settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
        if (result.items.length === 0) {
          setStatus("AI key revision analysis returned no kept items. Check parsing diagnostics and rejected low-relevance items.");
        } else {
          setStatus(`AI key revision analysis complete with ${result.curationReport.keptCount} kept, ${result.curationReport.needsReviewCount} needing review, ${result.curationReport.embeddedCount} embedded, and ${result.rejectedItems.length} rejected item(s).`);
        }
      } else {
        setStatus(`Deck curation complete via local deterministic rules with ${result.curationReport.keptCount} kept, ${result.curationReport.needsReviewCount} needing review, ${result.curationReport.embeddedCount} embedded, and ${result.rejectedItems.length} rejected item(s).`);
      }
    } catch (error) {
      const message = renderErrorMessage(error);
      setRuntimeErrors((current) => [...current, message]);
      setStatus("Extraction failed, but parsed text and segmentation diagnostics are still available below.");
    } finally {
      setExtracting(false);
    }
  }

  function handleManualImport() {
    try {
      const parsed = JSON.parse(manualJson) as unknown;
      const manualDeck = isCuratedDeckResult(parsed) ? parsed : undefined;
      const result = validateRevisionItemsPayload(manualDeck ? manualDeck.keptItems : parsed);
      setManualErrors(result.errors);
      if (result.errors.length > 0) return;
      store.setRevisionItems(
        manualDeck ? [...manualDeck.keptItems, ...manualDeck.needsReviewItems].map(withValidation) : result.items.map(withValidation),
        manualDeck?.rejectedItems ?? [],
        manualDeck ? {
          embeddedItems: manualDeck.embeddedItems,
          courseMap: manualDeck.courseMap,
          courseStructureMap: manualDeck.courseStructureMap,
          courseKnowledgeMap: manualDeck.courseKnowledgeMap,
          assessmentMap: manualDeck.assessmentMap,
          examPriorityMap: manualDeck.examPriorityMap,
          revisionPack: manualDeck.revisionPack,
          curationReport: manualDeck.curationReport,
        } : undefined,
      );
      setStatus(`Imported ${result.items.length} card(s) from manual JSON.`);
      router.push("/pack");
    } catch {
      setManualErrors(["JSON parse error. Please provide valid JSON array."]);
    }
  }

  async function handlePromptCopy() {
    const prompt = generateManualExtractionPrompt({ notesText, guidanceText, sourceFile });
    await navigator.clipboard.writeText(prompt);
    setStatus("Manual extraction prompt copied. Paste it into ChatGPT/Codex with your notes.");
  }

  async function downloadActiveCards() {
    const blob = new Blob([await store.exportActiveCardsJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rivision-active-cards.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onManualFileUpload(file: File | null) {
    if (!file) return;
    file.text().then((text) => setManualJson(text));
  }

  function addMissingCandidate(candidate: NonNullable<ExtractionVerificationReport["missingCandidates"]>[number]) {
    const now = new Date().toISOString();
    const item: RevisionItem = {
      id: createId("card"),
      type: candidate.type,
      title: candidate.title,
      conceptName: candidate.title,
      displayTitle: candidate.title,
      cardFront: candidate.title,
      taskPrompt: candidate.type === "definition" ? "Recall the exact definition." : "Recall the key statement.",
      statement: candidate.reason,
      sourceFile: sourceFile || "Uploaded notes",
      sourceLocation: candidate.sourceLocation,
      pageNumber: candidate.pageNumber,
      tags: ["verification-missing"],
      importance: "unknown",
      cardPurpose: candidate.type === "definition" ? "definition_recall" : candidate.type === "formula" ? "formula_recall" : "theorem_statement",
      classificationConfidence: "low",
      guidanceReason: "Added manually from verification report.",
      uncertaintyNote: "Candidate auto-created from verification report; review needed.",
      questionPrompt: `State ${candidate.title}.`,
      answer: candidate.reason,
      priorityScore: 40,
      priorityLabel: "medium",
      evidenceSignals: [],
      whyThisCardMatters: "Added manually from verification report.",
      revisionPackCategory: "needsReview",
      createdAt: now,
      updatedAt: now,
    };
    store.upsertRevisionItem(withValidation(item));
  }

  function keepNeedsReviewItem(item: RevisionItem) {
    store.upsertRevisionItem({
      ...item,
      curationDecision: "keep",
      curationStatus: "kept",
      cardPurpose: item.cardPurpose === "needs_review" ? fallbackPurpose(item) : item.cardPurpose,
      standaloneValue: item.standaloneValue === "low" ? "medium" : item.standaloneValue,
      updatedAt: new Date().toISOString(),
    });
  }

  function fixItemMath(item: RevisionItem) {
    store.upsertRevisionItem({
      ...item,
      statementLatex: normalizeMathNotation(item.statement || ""),
      answerLatex: normalizeMathNotation(item.answer || ""),
      proofLatex: item.proof ? normalizeMathNotation(item.proof) : undefined,
      latexQuality: "medium",
      updatedAt: new Date().toISOString(),
    });
  }

  async function aiCleanItemMath(item: RevisionItem) {
    setMathStatus("");
    const response = await fetch("/api/ai-clean-math", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.statement }),
    });
    const payload = (await response.json()) as { markdown?: string; error?: string; issues?: string[]; latexQuality?: RevisionItem["latexQuality"] };
    if (!response.ok || !payload.markdown) {
      setMathStatus(payload.error || "AI math cleanup failed.");
      return;
    }
    store.upsertRevisionItem({
      ...item,
      statementLatex: payload.markdown,
      latexQuality: payload.latexQuality ?? (payload.issues?.length ? "low" : "high"),
      warnings: [...(item.warnings ?? []), ...(payload.issues ?? [])],
      updatedAt: new Date().toISOString(),
    });
    setMathStatus(payload.issues?.length ? "AI cleaned math, but KaTeX still reported issues." : "AI cleaned math.");
  }

  return (
    <div>
      <PageHeader
        title="Build a revision pack"
        description="Upload notes, analyse them, then review a clean study pack without raw extraction diagnostics."
      />

      <div className="mb-6 grid gap-3 md:grid-cols-4">
        <WorkflowStep step="1" title="Upload files" done={uploadedFiles.length > 0} />
        <WorkflowStep step="2" title="Analyse notes" done={Boolean(store.curationReport)} active={!store.curationReport} />
        <WorkflowStep step="3" title="Study Pack summary" done={normalItems.length > 0} />
        <WorkflowStep step="4" title="Start revision" done={false} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analyse notes</CardTitle>
          <CardDescription>
            {store.notesFiles.length} notes file(s), {store.guidanceFiles.length} guidance file(s)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={runExtraction} disabled={extracting}>
              {extracting ? "Analysing..." : "Analyse notes"}
            </Button>
            <Link className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/upload">Upload files</Link>
            <label className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={(event) => {
                  const next = event.target.checked;
                  setDebugMode(next);
                  saveStorageSettings({ ...loadStorageSettings(), interfaceMode: next ? "advanced" : "simple" });
                }}
              />
              Advanced debug mode
            </label>
            {debugMode ? <Button variant="outline" onClick={handlePromptCopy}>Generate manual ChatGPT prompt</Button> : null}
          </div>
          {status ? <p className="text-sm text-blue-700">{status}</p> : null}
          {apiError ? <p className="text-sm text-red-700">{apiError}</p> : null}
          {mathStatus ? <p className="text-sm text-slate-600">{mathStatus}</p> : null}
          {runtimeErrors.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-medium">Runtime error</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void downloadActiveCards()}>Export cards</Button>
                  <Button size="sm" variant="outline" onClick={() => { void store.clearDebugData(); }}>Clear cache</Button>
                  <Button size="sm" variant="outline" onClick={() => void runExtraction()} disabled={extracting}>Clear cache and retry</Button>
                  <Button size="sm" variant="destructive" onClick={() => { void resetStudyStateStorage(); window.location.reload(); }}>Reset local data</Button>
                </div>
              </div>
              {runtimeErrors.map((error, index) => <pre key={`${error}-${index}`} className="mt-2 whitespace-pre-wrap text-xs">{error}</pre>)}
            </div>
          ) : null}
          {store.storageError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-medium">Local storage is full. Large data should be stored in IndexedDB. Please clear cache or migrate storage.</p>
              <pre className="mt-2 whitespace-pre-wrap text-xs">{store.storageError}</pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void store.migrateLocalStorage()}>Migrate to IndexedDB</Button>
                <Button size="sm" variant="outline" onClick={() => void store.clearDebugData()}>Clear debug/cache</Button>
                <Button size="sm" variant="outline" onClick={() => void downloadActiveCards()}>Export cards</Button>
                <Button size="sm" variant="destructive" onClick={() => { store.resetAll(); window.location.reload(); }}>Reset all local data</Button>
              </div>
            </div>
          ) : null}
          {guidanceFailed ? (
            <p className="text-sm text-amber-700">
              Guidance could not be parsed, so importance classification may be unreliable.
            </p>
          ) : null}
          {debugMode && (settings.mode === "ai_key_revision_analysis" || settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") ? (
            <p className="text-sm text-slate-500">If OPENAI_API_KEY is missing, the app falls back to local heuristic filtering. You can change modes in <Link className="underline" href="/settings">Settings</Link>.</p>
          ) : debugMode ? (
            <p className="text-sm text-slate-500">No paid API key required in this mode.</p>
          ) : null}
          {debugMode && likelyUnderExtraction ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
              Candidate detection is likely under-extracting: parsed pages &gt; 50 but raw candidates &lt; 40.
            </p>
          ) : null}
          {debugMode && noAssessmentEvidence ? (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
              No past papers, problem sheets, or guidance uploaded. Priorities are lecture-based only.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {store.curationReport ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Analysis complete</CardTitle>
            <CardDescription>
              Revision pack ready: {normalItems.length} study card(s), {needsReviewItems.length} needing manual review
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm text-slate-600">
            <div className="grid gap-3 md:grid-cols-4">
              <SummaryMetric label="Core concepts" value={packCount(store.revisionItems, ["mustKnowDefinitions", "modelsToKnow", "conceptualDistinctions"])} />
              <SummaryMetric label="Key formulas" value={packCount(store.revisionItems, ["formulasToKnow"])} />
              <SummaryMetric label="Algorithms" value={store.revisionItems.filter((item) => !item.isDeleted && item.type === "algorithm").length} />
              <SummaryMetric label="Proofs" value={packCount(store.revisionItems, ["proofsToKnow"])} />
              <SummaryMetric label="Worked examples" value={packCount(store.revisionItems, ["workedExamplePatterns", "methodsAndTemplates"])} />
              <SummaryMetric label="Exercises" value={store.revisionItems.filter((item) => !item.isDeleted && item.cardPurpose === "calculation_template").length} />
              <SummaryMetric label="Needs review" value={needsReviewItems.length} warning />
              <SummaryMetric label="Low math quality" value={lowLatexCount} warning={lowLatexCount > 0} />
            </div>
            <div>
              <p className="font-medium text-slate-950">Detected</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["Core concepts", "Key formulas", "Algorithms", "Proofs", "Worked examples", "Exercises", "Needs review", "Low math quality items"].map((label) => <Badge key={label} variant="outline">{label}</Badge>)}
              </div>
            </div>
            <p>{store.revisionPack?.overview ?? "A revision pack has been built from your notes."}</p>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/pack">Open study pack</Link>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/review">Start reviewing</Link>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/cards?tab=needs_review">Review issues</Link>
            </div>
            {debugMode ? (
              <details className="rounded-lg border bg-slate-50 p-3">
                <summary className="cursor-pointer font-medium text-slate-900">Advanced analysis details</summary>
                <div className="mt-3 space-y-2">
                  <p><strong>Parsed pages:</strong> {parsedPageCount || "Unknown"}</p>
                  <p><strong>Candidates:</strong> {store.curationReport.totalCandidates} raw candidate(s), {store.curationReport.keptCount} kept, {store.curationReport.needsReviewCount} needs review, {store.curationReport.rejectedCount} rejected.</p>
                  <p><strong>Course type:</strong> {store.courseMap?.courseType ?? store.revisionPack?.courseType ?? store.curationReport.courseType ?? "unknown"}</p>
                  <p><strong>Top topics:</strong> {topCourseTopics.length ? topCourseTopics.join(", ") : "None detected yet."}</p>
                  <p><strong>Quality:</strong> pack completeness {store.curationReport.packCompletenessScore ?? 0}%, candidate coverage {store.curationReport.candidateCoverageScore ?? 0}%, LaTeX quality {store.curationReport.latexQualityScore ?? (lowLatexCount ? "needs review" : "unknown")}.</p>
                  {store.curationReport.weakParsingWarnings.map((warning) => <p key={warning} className="text-amber-700">{warning}</p>)}
                  {store.curationReport.notes.map((note) => <p key={note}>{note}</p>)}
                  {segmentationDebug.some((document) => document.maxCandidateLength > 3000) ? <p className="font-medium text-amber-700">Needs splitting: max candidate length exceeds 3000 characters.</p> : null}
                </div>
              </details>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {debugMode && store.curationReport ? (
        <details className="mt-6 rounded-lg border border-slate-200 bg-slate-50 open:bg-slate-50">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-slate-900">Advanced debug — pack breakdown &amp; raw extraction</summary>
          <div className="space-y-6 border-t border-slate-200 p-4">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>AI key revision analysis</CardTitle>
            <CardDescription>Structured revision pack grouped by final curation decision.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <TabButton active={activeTab === "kept"} onClick={() => setActiveTab("kept")}>Kept cards ({normalItems.length})</TabButton>
              <TabButton active={activeTab === "needs_review"} onClick={() => setActiveTab("needs_review")}>Needs review ({needsReviewItems.length})</TabButton>
              <TabButton active={activeTab === "rejected"} onClick={() => setActiveTab("rejected")}>Rejected ({store.rejectedItems.length})</TabButton>
              <TabButton active={activeTab === "embedded"} onClick={() => setActiveTab("embedded")}>Embedded content ({store.embeddedItems.length})</TabButton>
              <TabButton active={activeTab === "course_map"} onClick={() => setActiveTab("course_map")}>Course map</TabButton>
            </div>

            <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 text-sm md:grid-cols-3">
              <PackCount label="Must-know definitions" value={store.revisionPack?.mustKnowDefinitions.length ?? 0} />
              <PackCount label="Models to know" value={store.revisionPack?.modelsToKnow?.length ?? 0} />
              <PackCount label="Conditions and equivalences" value={store.revisionPack?.conditionsAndEquivalences?.length ?? 0} />
              <PackCount label="Key formulas" value={store.revisionPack?.keyFormulas?.length ?? store.revisionPack?.formulasToKnow.length ?? 0} />
              <PackCount label="Calculation templates" value={store.revisionPack?.methodsAndTemplates.length ?? 0} />
              <PackCount label="Tests and diagnostics" value={store.revisionPack?.testStatisticsAndDiagnostics?.length ?? 0} />
              <PackCount label="Worked example patterns" value={store.revisionPack?.workedExamplePatterns?.length ?? 0} />
              <PackCount label="Conceptual distinctions" value={store.revisionPack?.conceptualDistinctions.length ?? 0} />
            </div>

            {activeTab === "kept" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {normalItems.length === 0 ? <p className="text-sm text-slate-500">No kept active cards yet.</p> : null}
                {normalItems.map((item) => <KeptCard key={item.id} item={item} />)}
              </div>
            ) : null}

            {activeTab === "needs_review" ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {needsReviewItems.length === 0 ? <p className="text-sm text-slate-500">No uncertain items.</p> : null}
                {needsReviewItems.map((item) => (
                  <ExtractedCard
                    key={item.id}
                    item={item}
                    onImportanceChange={(importance) => store.upsertRevisionItem({ ...item, importance, updatedAt: new Date().toISOString() })}
                    onAccept={() => keepNeedsReviewItem(item)}
                    onReject={() => store.rejectRevisionItem(item.id, "Rejected during AI analysis review.")}
                    onFixMath={() => fixItemMath(item)}
                    onAiCleanMath={() => void aiCleanItemMath(item)}
                  />
                ))}
              </div>
            ) : null}

            {activeTab === "rejected" ? (
              <div className="space-y-3">
                {store.rejectedItems.length === 0 ? <p className="text-sm text-slate-500">No rejected content.</p> : null}
                {store.rejectedItems.map((rejected) => (
                  <div key={rejected.id} className="rounded-lg border bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{rejected.title}</p>
                        <p className="text-xs text-slate-500">{rejected.type} · {rejected.rejectionCategory} · confidence {rejected.confidence} · {rejected.sourceLocation || rejected.originalItem?.sourceLocation || "source unknown"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => store.restoreRejectedItem(rejected.id)} disabled={!rejected.originalItem}>Restore</Button>
                        <Button size="sm" variant="destructive" onClick={() => store.permanentlyDeleteRejectedItem(rejected.id)}>Permanently delete</Button>
                      </div>
                    </div>
                    <p className="mt-2 text-slate-700">{rejected.rejectionReason}</p>
                    {rejected.rawText ? <p className="mt-2 line-clamp-3 text-xs text-slate-500">{rejected.rawText}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "embedded" ? (
              <div className="space-y-3">
                {store.embeddedItems.length === 0 ? <p className="text-sm text-slate-500">No embedded content.</p> : null}
                {store.embeddedItems.map((embedded) => (
                  <div key={embedded.id} className="rounded-lg border bg-white p-3 text-sm">
                    <p className="font-medium">{embedded.sourceLocation || "Embedded support content"}</p>
                    <p className="text-xs text-slate-500">Parent card: {embedded.parentItemId || "not found"}</p>
                    <p className="mt-2 text-slate-700">{embedded.reason}</p>
                    <MathMarkdown content={previewText(embedded.content)} className="mt-2 bg-transparent p-0 text-sm text-slate-600" />
                  </div>
                ))}
              </div>
            ) : null}

            {activeTab === "course_map" ? (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 font-medium">Major topics</p>
                  <div className="flex flex-wrap gap-2">
                    {(store.courseMap?.topics ?? store.courseStructureMap?.topics ?? []).map((topic) => (
                      <Badge key={topic.name} variant={topic.importance === "core" ? "must_know" : topic.importance === "supporting" ? "partial" : "outline"}>
                        {topic.name} · {topic.type ?? topic.likelyExamUse}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="font-medium">Sections</p>
                  {(store.courseStructureMap?.sections ?? []).map((section) => (
                    <div key={`${section.sourceFile}-${section.title}-${section.pageStart ?? ""}`} className="rounded-lg border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{section.sectionNumber ? `${section.sectionNumber} ` : ""}{section.title}</p>
                        <Badge variant={section.likelyImportance === "core" ? "must_know" : section.likelyImportance === "supporting" ? "partial" : "outline"}>{section.likelyImportance}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{section.sourceFile}{section.pageStart ? ` · page ${section.pageStart}${section.pageEnd && section.pageEnd !== section.pageStart ? `-${section.pageEnd}` : ""}` : ""}</p>
                      <p className="mt-2 text-slate-600">{section.summary || "No summary available."}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Segmentation diagnostics</CardTitle>
          <CardDescription>{candidates.length} candidate(s) found before local rules or LLM extraction.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidateSegmentationWarning ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Candidate segmentation warnings found. Review these before trusting extraction.
            </p>
          ) : null}
          {candidates.length === 0 ? <p className="text-sm text-slate-500">No labelled candidates detected in notes files.</p> : null}
          <div className="space-y-4">
            {segmentationDebug.map((document) => (
              <div key={document.sourceFile} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{document.sourceFile}</p>
                  <Badge variant="outline">chars {document.fullTextCharCount}</Badge>
                  <Badge variant="outline">label regex matches {document.labelRegexMatchCount}</Badge>
                  <Badge variant="outline">candidates {document.candidateCount}</Badge>
                  <Badge variant="outline">avg len {document.averageCandidateLength}</Badge>
                  <Badge variant={document.maxCandidateLength > 1200 ? "unknown" : "outline"}>max len {document.maxCandidateLength}</Badge>
                </div>
                {document.warnings.length > 0 ? (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                    {document.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                ) : null}
                <div className="mt-3 max-h-96 space-y-2 overflow-auto">
                  {document.labels.map((label, index) => (
                    <div key={label.id} className="rounded-lg border bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">#{index + 1}</Badge>
                        <Badge variant="unknown">{label.label}</Badge>
                        {label.number ? <Badge variant="outline">{label.number}</Badge> : null}
                        <span className="text-xs text-slate-500">
                          {label.sourceFile}{label.pageNumber ? ` · page ${label.pageNumber}` : ""} · offsets {label.startOffset}-{label.endOffset} · length {label.rawTextLength}
                        </span>
                        {label.containsMultipleMajorLabels ? <Badge variant="unknown">multiple major labels</Badge> : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-slate-700">{label.rawTextPreview}{label.rawTextLength > 300 ? "..." : ""}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Curation diagnostics</CardTitle>
            <CardDescription>Current stored decisions and reasons from the latest extraction/import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="must_know">kept {curationDiagnostics.keptCount}</Badge>
              <Badge variant="unknown">needs review {curationDiagnostics.needsReviewCount}</Badge>
              <Badge variant="outline">embedded {curationDiagnostics.embeddedCount}</Badge>
              <Badge variant="not_required">rejected {curationDiagnostics.rejectedCount}</Badge>
            </div>
            {curationDiagnostics.rejectedCategories.length ? (
              <p><strong>Rejected categories:</strong> {curationDiagnostics.rejectedCategories.join(", ")}</p>
            ) : null}
            <div className="max-h-96 space-y-2 overflow-auto">
              {curationDiagnostics.decisions.map((decision) => (
                <div key={decision.id} className="rounded border bg-white p-2">
                  <p className="font-medium">{decision.title}</p>
                  <p className="text-xs text-slate-500">{decision.kind} · {decision.decision} · {decision.category ?? "no category"}</p>
                  <p className="mt-1 text-slate-700">{decision.reason}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Parsing diagnostics</CardTitle>
            <CardDescription>Preview parsed text and extraction quality before relying on cards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
          {allDocuments.length === 0 ? <p className="text-sm text-slate-500">No parsed files yet. Upload notes and guidance first.</p> : null}
          {allDocuments.map((doc) => (
            <div key={`${doc.sourceFile}-${doc.fileType}`} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{doc.sourceFile}</p>
                <Badge variant="unknown">{doc.fileType}</Badge>
                <Badge variant={doc.diagnostics.extractionQuality === "high" ? "must_know" : doc.diagnostics.extractionQuality === "failed" ? "not_required" : "partial"}>
                  {doc.diagnostics.extractionQuality}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                chars: {doc.diagnostics.charCount}
                {typeof doc.diagnostics.pageCount === "number" ? ` · pages: ${doc.diagnostics.pageCount}` : ""}
                {doc.diagnostics.likelyScannedPdf ? " · likelyScannedPdf: true" : ""}
              </p>
              {doc.pages?.length ? <p className="mt-1 text-xs text-slate-500">chars per page: {doc.pages.map((page) => `${page.pageNumber}:${page.charCount}`).join(", ")}</p> : null}
              {doc.diagnostics.warnings.length > 0 ? <p className="mt-2 text-sm text-amber-700">{doc.diagnostics.warnings.join(" | ")}</p> : null}
              {doc.diagnostics.errors.length > 0 ? <p className="mt-2 text-sm text-red-700">{doc.diagnostics.errors.join(" | ")}</p> : null}
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{doc.fullText.slice(0, 1500) || "(no parsed text)"}</pre>
            </div>
          ))}
        </CardContent>
      </Card>

      {debugMode && store.rejectedItems.length > 0 ? (
        <Card className="shadow-sm border-slate-300 bg-slate-50">
          <CardHeader>
            <CardTitle>Rejected / low relevance</CardTitle>
            <CardDescription>These items were extracted but are not included in normal review unless restored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {store.rejectedItems.map((rejected) => (
              <div key={rejected.id} className="rounded-lg border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{rejected.title}</p>
                    <p className="text-xs text-slate-500">
                      {rejected.type} · {rejected.rejectionCategory} · confidence {rejected.confidence} · {rejected.sourceLocation || rejected.originalItem?.sourceLocation || "source unknown"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => store.restoreRejectedItem(rejected.id)} disabled={!rejected.originalItem}>Restore as card</Button>
                    <Button size="sm" variant="destructive" onClick={() => store.permanentlyDeleteRejectedItem(rejected.id)}>Permanently delete</Button>
                  </div>
                </div>
                <p className="mt-2 text-slate-700">{rejected.rejectionReason}</p>
                {rejected.originalItem ? <MathMarkdown content={previewText(rejected.originalItem.statementLatex || rejected.originalItem.statement)} className="mt-2 bg-transparent p-0 text-sm text-slate-500" /> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {debugMode && normalItems.length > 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Kept revision cards (detail)</CardTitle>
            <CardDescription>Included in normal review.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {normalItems.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={item.importance}>{item.importance}</Badge>
                      {item.extractionWarning || item.warnings?.length ? <Badge variant="unknown">check extraction</Badge> : null}
                      {hasLowLatexQuality(item) ? <Badge variant="unknown">Low LaTeX quality</Badge> : null}
                    </div>
                  </div>
                  <CardDescription>{item.type} · {item.cardPurpose} · {item.section || "section unknown"} · {item.sourceLocation || "source unknown"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <MathMarkdown content={previewText(getPrimaryCardPreview(item))} className="bg-transparent p-0 text-sm text-slate-600" />
                  <p className="mt-2 text-xs text-slate-500">confidence: {item.classificationConfidence || "unknown"} · standalone {item.standaloneValue ?? "unknown"} · purpose {item.cardPurpose}</p>
                  {item.relevanceReason ? <p className="mt-2 text-xs text-slate-500">{item.relevanceReason}</p> : null}
                  {item.guidanceReason ? <p className="mt-2 text-xs text-slate-500">{item.guidanceReason}</p> : null}
                  {item.uncertaintyNote ? <p className="mt-1 text-xs text-amber-700">{item.uncertaintyNote}</p> : null}
                  {item.extractionWarning ? <p className="mt-1 text-xs text-amber-700">{item.extractionWarning}</p> : null}
                  <div className="mt-2">
                    <Select value={item.importance} onChange={(event) => store.upsertRevisionItem({ ...item, importance: event.target.value as RevisionItem["importance"], updatedAt: new Date().toISOString() })}>
                      <option value="must_know">must_know</option>
                      <option value="partial">partial</option>
                      <option value="not_required">not_required</option>
                      <option value="unknown">unknown</option>
                    </Select>
                  </div>
                  {item.warnings?.length ? <Badge className="mt-3" variant="unknown">{item.warnings.length} warning(s)</Badge> : null}
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {debugMode && verification ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Verification report</CardTitle>
            <CardDescription>overall completeness: {verification.overallCompleteness}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>{verification.notes}</p>
            <div>
              <p className="font-medium">Missing candidates</p>
              {verification.missingCandidates.length === 0 ? <p className="text-slate-500">None.</p> : verification.missingCandidates.map((candidate, index) => (
                <div key={`${candidate.title}-${index}`} className="mt-2 rounded border p-2">
                  <p>{candidate.title} ({candidate.type})</p>
                  <p className="text-slate-500">{candidate.reason}</p>
                  <Button className="mt-2" size="sm" variant="outline" onClick={() => addMissingCandidate(candidate)}>Accept missing candidate</Button>
                </div>
              ))}
            </div>
            <div>
              <p className="font-medium">Suspicious items</p>
              {verification.suspiciousItems.length === 0 ? <p className="text-slate-500">None.</p> : verification.suspiciousItems.map((item) => (
                <div key={`${item.itemId}-${item.issue}`} className="mt-2 rounded border p-2">
                  <p>{item.itemId}</p>
                  <p className="text-slate-500">{item.issue}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="font-medium">Guidance ambiguities</p>
              {verification.guidanceAmbiguities.length === 0 ? <p className="text-slate-500">None.</p> : verification.guidanceAmbiguities.map((ambiguous, index) => (
                <div key={`${ambiguous.guidanceText}-${index}`} className="mt-2 rounded border p-2">
                  <p>{ambiguous.guidanceText}</p>
                  <p className="text-slate-500">{ambiguous.interpretation}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

          </div>
        </details>
      ) : null}

      {settings.mode === "manual_json_import" ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Manual JSON import</CardTitle>
            <CardDescription>Paste JSON from ChatGPT/Codex, or upload a JSON file, then validate and import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept="application/json,.json" onChange={(event) => onManualFileUpload(event.target.files?.[0] ?? null)} />
            <Textarea value={manualJson} onChange={(event) => setManualJson(event.target.value)} className="min-h-56" placeholder="Paste RevisionItem[] JSON" />
            <Button onClick={handleManualImport} disabled={!manualJson.trim()}>Validate and import JSON</Button>
            {manualErrors.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {manualErrors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {store.revisionItems.length > 0 ? (
        <div className="mt-6">
          <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/cards">
            Review and edit cards
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} onClick={onClick}>
      {children}
    </Button>
  );
}

function WorkflowStep({ step, title, done, active }: { step: string; title: string; done?: boolean; active?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 text-sm ${active ? "border-blue-300 bg-blue-50" : done ? "border-green-200 bg-green-50" : "bg-white"}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-green-600 text-white" : active ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-600"}`}>{step}</span>
        <p className="font-medium">{title}</p>
      </div>
      <p className="text-xs text-slate-500">{done ? "Ready" : active ? "Current step" : "Next"}</p>
    </div>
  );
}

function PackCount({ label, value }: { label: string; value: number }) {
  return <div><p className="font-medium">{value}</p><p className="text-slate-500">{label}</p></div>;
}

function SummaryMetric({ label, value, warning }: { label: string; value: number; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warning ? "border-amber-200 bg-amber-50" : "bg-white"}`}>
      <p className="text-2xl font-semibold text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function packCount(items: RevisionItem[], categories: Array<NonNullable<RevisionItem["revisionPackCategory"]>>) {
  return items.filter((item) => !item.isDeleted && categories.includes(item.revisionPackCategory ?? "needsReview")).length;
}

function KeptCard({ item }: { item: RevisionItem }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{item.cardFront}</CardTitle>
          <Badge variant={item.importance}>{item.importance}</Badge>
        </div>
        <CardDescription>{item.displayTitle || item.title}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-2 flex flex-wrap gap-2">
          <Badge variant="outline">{item.cardPurpose}</Badge>
          <Badge variant="outline">standalone {item.standaloneValue ?? "unknown"}</Badge>
          <Badge variant="outline">priority {item.priorityScore}</Badge>
          {item.revisionPackCategory ? <Badge variant="outline">{item.revisionPackCategory}</Badge> : null}
          {item.latexQuality ? <Badge variant={item.latexQuality === "low" ? "unknown" : "outline"}>LaTeX {item.latexQuality}</Badge> : null}
        </div>
        <MathMarkdown content={previewText(getPrimaryCardPreview(item))} className="bg-transparent p-0 text-sm text-slate-600" />
        <p className="mt-2 text-xs text-slate-500">{item.sourceLocation || "source unknown"}</p>
        {item.whyThisCardMatters ? <p className="mt-2 text-xs text-slate-500">{item.whyThisCardMatters}</p> : null}
        {item.curationReason ? <p className="mt-2 text-xs text-slate-500">{item.curationReason}</p> : null}
      </CardContent>
    </Card>
  );
}

function ExtractedCard({
  item,
  onImportanceChange,
  onAccept,
  onReject,
  onFixMath,
  onAiCleanMath,
}: {
  item: RevisionItem;
  onImportanceChange: (importance: RevisionItem["importance"]) => void;
  onAccept?: () => void;
  onReject?: () => void;
  onFixMath?: () => void;
  onAiCleanMath?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">{item.title}</CardTitle>
          <Badge variant={item.importance}>{item.importance}</Badge>
        </div>
        <CardDescription>{item.type} · {item.sourceLocation || "source unknown"}</CardDescription>
      </CardHeader>
      <CardContent>
        <MathMarkdown content={previewText(item.statementLatex || item.statement)} className="bg-transparent p-0 text-sm text-slate-600" />
        {item.relevanceReason ? <p className="mt-2 text-xs text-slate-500">{item.relevanceReason}</p> : null}
        {item.extractionWarning ? <p className="mt-2 text-xs text-amber-700">{item.extractionWarning}</p> : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <Select value={item.importance} onChange={(event) => onImportanceChange(event.target.value as RevisionItem["importance"])}>
            <option value="must_know">must_know</option>
            <option value="partial">partial</option>
            <option value="not_required">not_required</option>
            <option value="unknown">unknown</option>
          </Select>
          {onAccept ? <Button size="sm" variant="outline" onClick={onAccept}>Keep in review</Button> : null}
          {onReject ? <Button size="sm" variant="outline" onClick={onReject}>Reject</Button> : null}
          <Link className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50" href="/cards">Edit</Link>
          {onFixMath ? <Button size="sm" variant="outline" onClick={onFixMath}>Fix math</Button> : null}
          {onAiCleanMath ? <Button size="sm" variant="outline" onClick={onAiCleanMath}>AI clean math</Button> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function needsRepair(item: RevisionItem) {
  return Boolean(
    item.extractionWarning ||
      item.warnings?.some((warning) =>
        warning.includes("Over-merged") ||
        warning.includes("Source location is missing") ||
        warning.includes("Question prompt") ||
        warning.includes("Title is unusually long") ||
        warning.includes("unrelated section") ||
        warning.includes("multiple major label"),
      ),
  );
}

function previewText(value: string) {
  return value.length > 200 ? `${value.slice(0, 200)}...` : value;
}

function fallbackPurpose(item: RevisionItem): RevisionItem["cardPurpose"] {
  if (item.type === "definition") return "definition_recall";
  if (item.type === "formula") return "formula_recall";
  if (item.type === "proof") return "proof_recall";
  if (item.type === "algorithm") return "method_steps";
  if (item.type === "theorem" || item.type === "lemma" || item.type === "proposition" || item.type === "corollary") return "theorem_statement";
  return "background_context";
}

function isCuratedDeckResult(value: unknown): value is CuratedDeckResult {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as Partial<CuratedDeckResult>).keptItems) &&
      Array.isArray((value as Partial<CuratedDeckResult>).rejectedItems),
  );
}

function buildCurationDiagnostics(
  revisionItems: RevisionItem[],
  rejectedItems: { id: string; title: string; rejectionCategory?: string; rejectionReason?: string; confidence?: string }[],
  embeddedItems: { id: string; content: string; reason?: string; sourceLocation?: string }[],
) {
  const keptCount = revisionItems.filter((item) => !item.isDeleted && (item.curationDecision ?? "keep") === "keep").length;
  const needsReviewCount = revisionItems.filter((item) => !item.isDeleted && (item.curationDecision ?? "keep") === "needs_review").length;
  const rejectedCategories = Array.from(new Set(rejectedItems.map((item) => item.rejectionCategory).filter(Boolean)));
  return {
    keptCount,
    needsReviewCount,
    rejectedCount: rejectedItems.length,
    embeddedCount: embeddedItems.length,
    rejectedCategories,
    decisions: [
      ...revisionItems.map((item) => ({
        id: item.id,
        title: item.displayTitle || item.title || item.cardFront || "Untitled card",
        kind: "card",
        decision: item.curationDecision ?? "keep",
        category: item.cardPurpose,
        reason: item.curationReason || item.relevanceReason || item.guidanceReason || "No decision reason stored.",
      })),
      ...rejectedItems.map((item) => ({
        id: item.id,
        title: item.title || "Rejected item",
        kind: "rejected",
        decision: "reject",
        category: item.rejectionCategory,
        reason: item.rejectionReason || "No rejection reason stored.",
      })),
      ...embeddedItems.map((item) => ({
        id: item.id,
        title: item.sourceLocation || "Embedded content",
        kind: "embedded",
        decision: "embed_in_parent",
        category: "embedded",
        reason: item.reason || previewText(item.content || ""),
      })),
    ],
  };
}

function renderErrorMessage(error: unknown) {
  if (error instanceof Error) return `${error.message}${error.stack ? `\n${error.stack}` : ""}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "Unknown extraction error.";
  }
}

function renderStorageError(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not write candidates to IndexedDB.";
  return `Storage warning: ${message}\nThe extraction result is still available in memory. Export JSON before resetting local data.`;
}

