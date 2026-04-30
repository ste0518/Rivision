"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { MathMarkdown } from "@/components/MathMarkdown";
import { extractRevisionItems, generateManualExtractionPrompt, loadLlmPipelineSettings } from "@/lib/extraction";
import { buildSegmentationDebug, segmentRevisionCandidates } from "@/lib/segmentation";
import { validateRevisionItemsPayload, withValidation } from "@/lib/validation";
import type { ExtractionVerificationReport, ParsedDocument, RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
import { createId } from "@/lib/utils";

export default function ExtractPage() {
  const store = useStudyStore();
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [verification, setVerification] = useState<ExtractionVerificationReport | null>(null);
  const [manualJson, setManualJson] = useState("");
  const [manualErrors, setManualErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string>("");

  const settings = loadLlmPipelineSettings();
  const notesDocuments = useMemo(() => store.notesFiles.map((file) => file.parsedDocument ?? toLegacyParsedDocument(file.name, file.content)), [store.notesFiles]);
  const guidanceDocuments = useMemo(() => store.guidanceFiles.map((file) => file.parsedDocument ?? toLegacyParsedDocument(file.name, file.content)), [store.guidanceFiles]);
  const notesText = useMemo(() => notesDocuments.map((file) => file.fullText).join("\n\n"), [notesDocuments]);
  const guidanceText = useMemo(() => guidanceDocuments.map((file) => file.fullText).join("\n\n"), [guidanceDocuments]);
  const sourceFile = useMemo(() => store.notesFiles.map((file) => file.name).join(", ") || "Mock notes", [store.notesFiles]);
  const allDocuments = useMemo(() => [...notesDocuments, ...guidanceDocuments], [guidanceDocuments, notesDocuments]);
  const candidates = useMemo(() => segmentRevisionCandidates(notesDocuments), [notesDocuments]);
  const segmentationDebug = useMemo(() => buildSegmentationDebug(notesDocuments), [notesDocuments]);
  const candidateSegmentationWarning = segmentationDebug.some((document) => document.warnings.length > 0);
  const repairItems = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted && needsRepair(item)), [store.revisionItems]);
  const normalItems = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted && !needsRepair(item)), [store.revisionItems]);
  const failedDocuments = useMemo(
    () => allDocuments.filter((doc) => !doc.diagnostics.success || doc.diagnostics.extractionQuality === "failed" || !doc.fullText.trim()),
    [allDocuments],
  );
  const guidanceFailed = useMemo(
    () => guidanceDocuments.some((doc) => !doc.diagnostics.success || !doc.fullText.trim()),
    [guidanceDocuments],
  );

  async function runExtraction() {
    setExtracting(true);
    setStatus("");
    setApiError("");
    setVerification(null);

    if (settings.mode === "manual_json_import") {
      setStatus("Manual JSON import mode is enabled. Paste JSON below and validate/import it.");
      setExtracting(false);
      return;
    }

    if (failedDocuments.length > 0) {
      setStatus("Extraction blocked: one or more uploaded files failed to parse. Fix parsing issues and retry.");
      setExtracting(false);
      return;
    }

    const result = await extractRevisionItems({ notesDocuments, guidanceDocuments, sourceFile });
    store.setRevisionItems(result.items, result.rejectedItems);
    setVerification(result.verification);
    if (result.error) setApiError(result.error);

    if (settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
      if (result.items.length === 0) {
        setStatus("OpenAI extraction returned no kept items. Check parsing diagnostics and rejected low-relevance items.");
      } else {
        setStatus(`Extraction complete via OpenAI pipeline with ${result.items.length} kept and ${result.rejectedItems.length} rejected item(s).`);
      }
    } else {
      setStatus(`Extraction complete via local deterministic rules with ${result.items.length} kept and ${result.rejectedItems.length} rejected item(s).`);
    }

    setExtracting(false);
  }

  function handleManualImport() {
    try {
      const parsed = JSON.parse(manualJson) as unknown;
      const result = validateRevisionItemsPayload(parsed);
      setManualErrors(result.errors);
      if (result.errors.length > 0) return;
      store.setRevisionItems(result.items.map(withValidation), []);
      setStatus(`Imported ${result.items.length} card(s) from manual JSON.`);
    } catch {
      setManualErrors(["JSON parse error. Please provide valid JSON array."]);
    }
  }

  async function handlePromptCopy() {
    const prompt = generateManualExtractionPrompt({ notesText, guidanceText, sourceFile });
    await navigator.clipboard.writeText(prompt);
    setStatus("Manual extraction prompt copied. Paste it into ChatGPT/Codex with your notes.");
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
      classificationConfidence: "low",
      guidanceReason: "Added manually from verification report.",
      uncertaintyNote: "Candidate auto-created from verification report; review needed.",
      questionPrompt: `State ${candidate.title}.`,
      answer: candidate.reason,
      createdAt: now,
      updatedAt: now,
    };
    store.upsertRevisionItem(withValidation(item));
  }

  return (
    <div>
      <PageHeader
        title="Extract revision cards"
        description="Review parsing diagnostics first, then run extraction and verification from parsed notes + guidance."
      />

      <Card>
        <CardHeader>
          <CardTitle>Extraction inputs</CardTitle>
          <CardDescription>
            {store.notesFiles.length} notes file(s), {store.guidanceFiles.length} guidance file(s) · mode: <code>{settings.mode}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={runExtraction} disabled={extracting}>
              {extracting ? "Extracting..." : "Run extraction"}
            </Button>
            <Button variant="outline" onClick={handlePromptCopy}>Generate manual ChatGPT prompt</Button>
          </div>
          {status ? <p className="text-sm text-blue-700">{status}</p> : null}
          {apiError ? <p className="text-sm text-red-700">{apiError}</p> : null}
          {guidanceFailed ? (
            <p className="text-sm text-amber-700">
              Guidance could not be parsed, so importance classification may be unreliable.
            </p>
          ) : null}
          {(settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") ? (
            <p className="text-sm text-slate-500">If OPENAI_API_KEY is missing, the app will not crash. Switch to local rules or manual JSON import in <Link className="underline" href="/settings">Settings</Link>.</p>
          ) : (
            <p className="text-sm text-slate-500">No paid API key required in this mode.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Segmentation Debug</CardTitle>
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Parsing diagnostics</CardTitle>
          <CardDescription>Preview parsed text and extraction quality before LLM extraction.</CardDescription>
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
              {doc.diagnostics.warnings.length > 0 ? <p className="mt-2 text-sm text-amber-700">{doc.diagnostics.warnings.join(" | ")}</p> : null}
              {doc.diagnostics.errors.length > 0 ? <p className="mt-2 text-sm text-red-700">{doc.diagnostics.errors.join(" | ")}</p> : null}
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{doc.fullText.slice(0, 1500) || "(no parsed text)"}</pre>
            </div>
          ))}
        </CardContent>
      </Card>

      {repairItems.length > 0 ? (
        <Card className="mt-6 border-amber-300 bg-amber-50">
          <CardHeader>
            <CardTitle>Needs repair</CardTitle>
            <CardDescription>These cards were flagged as over-merged or suspicious and are not shown as normal review cards.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {repairItems.map((item) => <ExtractedCard key={item.id} item={item} onImportanceChange={(importance) => store.upsertRevisionItem({ ...item, importance, updatedAt: new Date().toISOString() })} />)}
          </CardContent>
        </Card>
      ) : null}

      {store.rejectedItems.length > 0 ? (
        <Card className="mt-6 border-slate-300 bg-slate-50">
          <CardHeader>
            <CardTitle>Rejected / low relevance</CardTitle>
            <CardDescription>These items were extracted but are not included in normal review unless restored.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {store.rejectedItems.map((rejected) => (
              <div key={rejected.id} className="rounded-lg border bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{rejected.originalItem.title}</p>
                    <p className="text-xs text-slate-500">
                      {rejected.originalItem.type} · {rejected.rejectionCategory} · confidence {rejected.confidence} · {rejected.originalItem.sourceLocation || "source unknown"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => store.restoreRejectedItem(rejected.id)}>Restore as card</Button>
                </div>
                <p className="mt-2 text-slate-700">{rejected.rejectionReason}</p>
                <MathMarkdown content={previewText(rejected.originalItem.statementLatex || rejected.originalItem.statement)} className="mt-2 bg-transparent p-0 text-sm text-slate-500" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {normalItems.length > 0 ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Kept cards</CardTitle>
            <CardDescription>These cards are included in normal review.</CardDescription>
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
                    </div>
                  </div>
                  <CardDescription>{item.type} · {item.section || "section unknown"} · {item.sourceLocation || "source unknown"}</CardDescription>
                </CardHeader>
                <CardContent>
                  <MathMarkdown content={previewText(item.statementLatex || item.statement)} className="bg-transparent p-0 text-sm text-slate-600" />
                  <p className="mt-2 text-xs text-slate-500">confidence: {item.classificationConfidence || "unknown"} · standalone {item.standaloneValue ?? "unknown"}</p>
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

      {verification ? (
        <Card className="mt-6">
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

function ExtractedCard({ item, onImportanceChange }: { item: RevisionItem; onImportanceChange: (importance: RevisionItem["importance"]) => void }) {
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
        {item.extractionWarning ? <p className="mt-2 text-xs text-amber-700">{item.extractionWarning}</p> : null}
        <div className="mt-2">
          <Select value={item.importance} onChange={(event) => onImportanceChange(event.target.value as RevisionItem["importance"])}>
            <option value="must_know">must_know</option>
            <option value="partial">partial</option>
            <option value="not_required">not_required</option>
            <option value="unknown">unknown</option>
          </Select>
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

function toLegacyParsedDocument(sourceFile: string, fullText: string): ParsedDocument {
  return {
    sourceFile,
    fileType: "unknown",
    fullText,
    diagnostics: {
      success: Boolean(fullText.trim()),
      charCount: fullText.length,
      warnings: ["Legacy file without diagnostics. Re-upload for full parser diagnostics."],
      errors: [],
      extractionQuality: fullText.trim() ? "medium" : "failed",
    },
  };
}
