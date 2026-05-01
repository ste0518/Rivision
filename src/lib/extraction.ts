import { runCoursePackBuilder } from "@/lib/course-builder";
import { buildRevisionPack, emptyExamPriorityMap } from "@/lib/course-priority";
import { defaultLlmPipelineSettings, type LlmPipelineSettings } from "@/lib/llm/provider";
import { extractionSystemPrompt } from "@/lib/llm/prompts";
import { normalizeCuratedRevisionResult } from "@/lib/normalization";
import type {
  CourseKnowledgeMap,
  CourseMap,
  CourseStructureMap,
  CurationReport,
  CuratedDeckResult,
  EmbeddedRevisionItem,
  ExamPriorityMap,
  ExtractionPipelineMode,
  ExtractionVerificationReport,
  AssessmentMap,
  ParsedDocument,
  RejectedRevisionItem,
  RevisionPack,
  RevisionItem,
} from "@/lib/types";
import { buildSuspiciousItems, validateAndRepairRevisionItems, withValidation } from "@/lib/validation";

export type ExtractRevisionItemsInput = {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  pastPaperDocuments?: ParsedDocument[];
  problemSheetDocuments?: ParsedDocument[];
  solutionDocuments?: ParsedDocument[];
  sourceFile?: string;
};

export type ExtractRevisionItemsResult = {
  items: RevisionItem[];
  needsReviewItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  verification: ExtractionVerificationReport;
  courseMap?: CourseMap;
  courseStructureMap: CourseStructureMap;
  courseKnowledgeMap: CourseKnowledgeMap;
  assessmentMap?: AssessmentMap;
  examPriorityMap: ExamPriorityMap;
  revisionPack: RevisionPack;
  curationReport: CurationReport;
  error?: string;
};

export function getLlmExtractionPrompt() {
  return extractionSystemPrompt;
}

export async function extractRevisionItems({
  notesDocuments,
  guidanceDocuments,
  pastPaperDocuments = [],
  problemSheetDocuments = [],
  solutionDocuments = [],
  sourceFile = "Uploaded notes",
}: ExtractRevisionItemsInput): Promise<ExtractRevisionItemsResult> {
  notesDocuments = normalizeParsedDocuments(notesDocuments);
  guidanceDocuments = normalizeParsedDocuments(guidanceDocuments);
  pastPaperDocuments = normalizeParsedDocuments(pastPaperDocuments);
  problemSheetDocuments = normalizeParsedDocuments(problemSheetDocuments);
  solutionDocuments = normalizeParsedDocuments(solutionDocuments);
  const notesText = notesDocuments.map((doc) => doc.fullText).join("\n\n");
  const guidanceText = [...guidanceDocuments, ...pastPaperDocuments, ...problemSheetDocuments, ...solutionDocuments].map((doc) => doc.fullText).join("\n\n");
  const hasRealInput = Boolean(notesText.trim() || guidanceText.trim());
  const settings = loadLlmPipelineSettings();
  const safeMode = settings.mode as ExtractionPipelineMode;
  let fallbackWarning: string | undefined;

  if (settings.mode === "ai_key_revision_analysis" || settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
    const llmResult = await extractViaApi({ notesDocuments, guidanceDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments, sourceFile, settings });
    if (llmResult.items.length > 0 || llmResult.needsReviewItems.length > 0 || llmResult.rejectedItems.length > 0 || llmResult.verification) {
      const processed = postProcessRevisionItems(llmResult.items, llmResult.needsReviewItems, llmResult.rejectedItems);
      return {
        items: [...processed.items, ...processed.needsReviewItems],
        needsReviewItems: processed.needsReviewItems,
        rejectedItems: processed.rejectedItems,
        embeddedItems: llmResult.embeddedItems ?? [],
        courseMap: llmResult.courseMap,
        courseStructureMap: llmResult.courseStructureMap ?? emptyCourseStructureMap(),
        courseKnowledgeMap: llmResult.courseKnowledgeMap ?? emptyCourseKnowledgeMap(),
        assessmentMap: llmResult.assessmentMap,
        examPriorityMap: llmResult.examPriorityMap ?? emptyExamPriorityMap(),
        revisionPack: llmResult.revisionPack ?? buildRevisionPack({ keptItems: processed.items, needsReviewItems: processed.needsReviewItems, rejectedItems: processed.rejectedItems, examPriorityMap: llmResult.examPriorityMap ?? emptyExamPriorityMap() }),
        curationReport: llmResult.curationReport ?? emptyCurationReport(0, processed.items.length, processed.needsReviewItems.length, processed.rejectedItems.length, llmResult.embeddedItems?.length ?? 0),
        verification: mergeSuspiciousItems(llmResult.verification ?? emptyVerificationReport("Verification unavailable."), [...processed.items, ...processed.needsReviewItems]),
        error: llmResult.error,
      };
    }
    fallbackWarning = llmResult.error
      ? `Local heuristic mode is approximate. For AI reasoning over notes + past papers, configure OPENAI_API_KEY. (${llmResult.error})`
      : undefined;
  }

  const curated = await deterministicCurate(notesDocuments, guidanceDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments, notesText, safeMode);
  if (curated.keptItems.length > 0 || curated.needsReviewItems.length > 0 || curated.rejectedItems.length > 0 || curated.embeddedItems.length > 0) {
    const processed = postProcessRevisionItems(curated.keptItems, curated.needsReviewItems, curated.rejectedItems);
    const items = [...processed.items, ...processed.needsReviewItems];
    return {
      items,
      needsReviewItems: processed.needsReviewItems,
      rejectedItems: processed.rejectedItems,
      embeddedItems: curated.embeddedItems,
      courseMap: curated.courseMap,
      courseStructureMap: curated.courseStructureMap,
      courseKnowledgeMap: curated.courseKnowledgeMap,
      assessmentMap: curated.assessmentMap,
      examPriorityMap: curated.examPriorityMap,
      revisionPack: curated.revisionPack,
      curationReport: {
        ...curated.curationReport,
        notes: fallbackWarning ? [fallbackWarning, ...curated.curationReport.notes] : curated.curationReport.notes,
      },
      verification: mergeSuspiciousItems(emptyVerificationReport("Local deterministic extraction mode does not run LLM verification."), items),
      error: fallbackWarning,
    };
  }

  if (hasRealInput) {
    return {
      items: [],
      needsReviewItems: [],
      rejectedItems: [],
      embeddedItems: [],
      courseStructureMap: emptyCourseStructureMap(),
      courseKnowledgeMap: emptyCourseKnowledgeMap(),
      examPriorityMap: emptyExamPriorityMap(),
      revisionPack: buildRevisionPack({ keptItems: [], needsReviewItems: [], rejectedItems: [], examPriorityMap: emptyExamPriorityMap() }),
      curationReport: emptyCurationReport(0, 0, 0, 0, 0),
      verification: emptyVerificationReport("No extractable items detected from parsed content."),
      error: fallbackWarning,
    };
  }

  return {
    items: [],
    needsReviewItems: [],
    rejectedItems: [],
    embeddedItems: [],
    courseStructureMap: emptyCourseStructureMap(),
    courseKnowledgeMap: emptyCourseKnowledgeMap(),
    examPriorityMap: emptyExamPriorityMap(),
    revisionPack: buildRevisionPack({ keptItems: [], needsReviewItems: [], rejectedItems: [], examPriorityMap: emptyExamPriorityMap() }),
    curationReport: emptyCurationReport(0, 0, 0, 0, 0),
    verification: emptyVerificationReport("Demo mode: upload notes and guidance to build a revision deck."),
  };
}

export function generateManualExtractionPrompt(input: { notesText: string; guidanceText: string; sourceFile: string }) {
  return `${extractionSystemPrompt}

Return STRICT JSON ONLY as a CuratedRevisionResult object with keptItems, needsReviewItems, rejectedItems, embeddedItems, courseStructureMap, courseKnowledgeMap, and curationReport.

Every kept RevisionItem must include id, type, title, conceptName, displayTitle, cardFront, taskPrompt, cardPurpose, statement, sourceFile, tags, importance, questionPrompt, answer, createdAt, and updatedAt.

Rejected items must include originalCandidateId, title, type, rejectionCategory, rejectionReason, confidence, and sourceLocation when available.

Source file: ${input.sourceFile}

Guidance text:
${input.guidanceText || "(none)"}

Lecture notes:
${input.notesText}`;
}

async function extractViaApi(input: {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  pastPaperDocuments: ParsedDocument[];
  problemSheetDocuments: ParsedDocument[];
  solutionDocuments: ParsedDocument[];
  sourceFile: string;
  settings: LlmPipelineSettings;
}): Promise<Partial<ExtractRevisionItemsResult> & { items: RevisionItem[]; needsReviewItems: RevisionItem[]; rejectedItems: RejectedRevisionItem[]; embeddedItems: EmbeddedRevisionItem[] }> {
  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await parseJsonResponse(response);
    const normalized = normalizeCuratedRevisionResult(payload);
    const verification = normalizeVerificationReport((payload as Partial<ExtractRevisionItemsResult>).verification);
    const error = errorMessage((payload as Partial<ExtractRevisionItemsResult>).error);
    if (!response.ok) {
      return {
        items: normalized.keptItems,
        needsReviewItems: normalized.needsReviewItems,
        rejectedItems: normalized.rejectedItems,
        embeddedItems: normalized.embeddedItems,
        verification,
        courseStructureMap: normalized.courseStructureMap,
        courseKnowledgeMap: normalized.courseKnowledgeMap,
        curationReport: normalized.curationReport,
        error: error ?? "LLM curation failed.",
      };
    }
    return {
      items: normalized.keptItems,
      needsReviewItems: normalized.needsReviewItems,
      rejectedItems: normalized.rejectedItems,
      embeddedItems: normalized.embeddedItems,
      verification,
      courseStructureMap: normalized.courseStructureMap,
      courseKnowledgeMap: normalized.courseKnowledgeMap,
      curationReport: normalized.curationReport,
    };
  } catch (error) {
    return { items: [], needsReviewItems: [], rejectedItems: [], embeddedItems: [], error: errorMessage(error) ?? "Network error while contacting extraction API." };
  }
}

const llmSettingsStorageKey = "rivision.llm.settings.v1";

export function loadLlmPipelineSettings(): LlmPipelineSettings {
  if (typeof window === "undefined") return defaultLlmPipelineSettings;
  const raw = window.localStorage.getItem(llmSettingsStorageKey);
  if (!raw) return defaultLlmPipelineSettings;
  try {
    return { ...defaultLlmPipelineSettings, ...(JSON.parse(raw) as Partial<LlmPipelineSettings>) };
  } catch {
    return defaultLlmPipelineSettings;
  }
}

export function saveLlmPipelineSettings(settings: LlmPipelineSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(llmSettingsStorageKey, JSON.stringify(settings));
}

async function deterministicCurate(
  notesDocuments: ParsedDocument[],
  guidanceDocuments: ParsedDocument[],
  pastPaperDocuments: ParsedDocument[],
  problemSheetDocuments: ParsedDocument[],
  solutionDocuments: ParsedDocument[],
  notesText: string,
  mode: ExtractionPipelineMode,
): Promise<CuratedDeckResult> {
  if (mode !== "local_rules_only" && mode !== "ai_key_revision_analysis" && mode !== "openai_api" && mode !== "cheap_scan_then_verify") return emptyCuratedDeck();
  if (!notesText.trim() || notesText.includes("[PDF placeholder]") || notesText.includes("[DOCX placeholder]")) return emptyCuratedDeck();
  return runCoursePackBuilder({ notesDocuments, guidanceDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments });
}

function postProcessRevisionItems(items: RevisionItem[], needsReviewItems: RevisionItem[], rejectedItems: RejectedRevisionItem[]) {
  const validation = validateAndRepairRevisionItems(items);
  const needsReviewValidation = validateAndRepairRevisionItems(needsReviewItems.map((item) => ({ ...item, curationDecision: "needs_review", curationStatus: "needs_review" })));
  return {
    items: [...validation.validItems, ...validation.invalidItems].map(withValidation),
    needsReviewItems: [...needsReviewValidation.validItems, ...needsReviewValidation.invalidItems].map(withValidation),
    rejectedItems: rejectedItems.map((item) => ({
      ...item,
      originalItem: item.originalItem ? withValidation(item.originalItem) : undefined,
    })),
  };
}

function mergeSuspiciousItems(report: ExtractionVerificationReport, items: RevisionItem[]): ExtractionVerificationReport {
  const existing = new Set(report.suspiciousItems.map((item) => `${item.itemId}|${item.issue}`));
  const suspiciousItems = [...report.suspiciousItems];
  for (const item of buildSuspiciousItems(items)) {
    const key = `${item.itemId}|${item.issue}`;
    if (existing.has(key)) continue;
    existing.add(key);
    suspiciousItems.push(item);
  }
  return { ...report, suspiciousItems };
}

function emptyVerificationReport(notes: string): ExtractionVerificationReport {
  return {
    missingCandidates: [],
    suspiciousItems: [],
    guidanceAmbiguities: [],
    overallCompleteness: "low",
    notes,
  };
}

function emptyCuratedDeck(): CuratedDeckResult {
  const examPriorityMap = emptyExamPriorityMap();
  return {
    keptItems: [],
    needsReviewItems: [],
    rejectedItems: [],
    embeddedItems: [],
    courseStructureMap: emptyCourseStructureMap(),
    courseKnowledgeMap: emptyCourseKnowledgeMap(),
    examPriorityMap,
    revisionPack: buildRevisionPack({ keptItems: [], needsReviewItems: [], rejectedItems: [], examPriorityMap }),
    curationReport: emptyCurationReport(0, 0, 0, 0, 0),
  };
}

function emptyCourseStructureMap(): CourseStructureMap {
  return {
    sections: [],
    topics: [],
    detectedItems: [],
  };
}

function emptyCourseKnowledgeMap(): CourseKnowledgeMap {
  return {
    coreTopics: [],
    requiredSections: [],
    formulaPolicy: {
      standaloneFormulaRule: "Only named, central, examinable formulas become standalone cards.",
      keepStandaloneWhen: [],
      embedOrRejectWhen: [],
      guidanceEvidence: [],
    },
    proofPolicy: {
      proofCardRule: "Create proof-recall cards only when guidance asks for proof or derivation.",
      proofRequiredWhen: [],
      proofOptionalWhen: [],
      guidanceEvidence: [],
    },
  };
}

function emptyCurationReport(totalCandidates: number, keptCount: number, needsReviewCount: number, rejectedCount: number, embeddedCount: number): CurationReport {
  return {
    totalCandidates,
    keptCount,
    needsReviewCount,
    rejectedCount,
    embeddedCount,
    formulaCandidates: 0,
    formulaKeptCount: 0,
    formulaRejectedCount: 0,
    mainTopics: [],
    weakParsingWarnings: [],
    notes: [],
  };
}

function normalizeParsedDocuments(documents: unknown): ParsedDocument[] {
  if (!Array.isArray(documents)) return [];
  return documents.flatMap((document) => {
    if (!document || typeof document !== "object") return [];
    const value = document as Partial<ParsedDocument>;
    const fullText = typeof value.fullText === "string" ? value.fullText : "";
    return [{
      sourceFile: typeof value.sourceFile === "string" && value.sourceFile.trim() ? value.sourceFile : "Unknown source",
      fileType: value.fileType ?? "unknown",
      role: value.role,
      fullText,
      pages: Array.isArray(value.pages) ? value.pages : [],
      sections: Array.isArray(value.sections) ? value.sections : [],
      diagnostics: {
        success: value.diagnostics?.success ?? Boolean(fullText.trim()),
        charCount: value.diagnostics?.charCount ?? fullText.length,
        pageCount: value.diagnostics?.pageCount ?? (Array.isArray(value.pages) ? value.pages.length : undefined),
        warnings: Array.isArray(value.diagnostics?.warnings) ? value.diagnostics.warnings : [],
        errors: Array.isArray(value.diagnostics?.errors) ? value.diagnostics.errors : [],
        likelyScannedPdf: value.diagnostics?.likelyScannedPdf,
        extractionQuality: value.diagnostics?.extractionQuality ?? (fullText.trim() ? "medium" : "failed"),
      },
    }];
  });
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { error: response.ok ? "Extraction API returned non-JSON data." : `Extraction API failed with status ${response.status}.` };
  }
}

function normalizeVerificationReport(report: unknown): ExtractionVerificationReport | undefined {
  if (!report || typeof report !== "object") return undefined;
  const value = report as Partial<ExtractionVerificationReport>;
  return {
    missingCandidates: Array.isArray(value.missingCandidates) ? value.missingCandidates : [],
    suspiciousItems: Array.isArray(value.suspiciousItems) ? value.suspiciousItems : [],
    guidanceAmbiguities: Array.isArray(value.guidanceAmbiguities) ? value.guidanceAmbiguities : [],
    overallCompleteness: value.overallCompleteness === "high" || value.overallCompleteness === "medium" || value.overallCompleteness === "low" ? value.overallCompleteness : "low",
    notes: typeof value.notes === "string" ? value.notes : "Verification unavailable.",
  };
}

function errorMessage(error: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown extraction error.";
  }
}
/*
import { createMockRevisionItems } from "@/lib/mock-data";
import { defaultLlmPipelineSettings, type LlmPipelineSettings } from "@/lib/llm/provider";
import { attachProofsToPreviousTheorem, segmentRevisionCandidates, stripLeadingLabel } from "@/lib/segmentation";
import { buildQuestionPrompt, convertCommonMathToLatex, extractConceptName, extractNumber, splitProofFromStatement, theoremLike } from "@/lib/revision-item-utils";
import { filterRevisionItemsByRelevance, loadRelevanceSettings } from "@/lib/relevance";
import type { ExtractionPipelineMode, ExtractionVerificationReport, ParsedDocument, RejectedRevisionItem, RevisionItem, RevisionItemType } from "@/lib/types";
import { createId } from "@/lib/utils";
import { buildSuspiciousItems, validateAndRepairRevisionItems, withValidation } from "@/lib/validation";

export type ExtractRevisionItemsInput = {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  sourceFile?: string;
};

const llmExtractionPrompt = `Extraction is deterministic-first. Uploaded notes are segmented into atomic candidates before any LLM cleanup runs. The LLM receives RevisionCandidate[] plus guidance, cleans notation, classifies importance, and generates prompts, but must not merge candidates or extract from whole pages/sections as the primary source.

You are not just extracting text. You are building exam revision cards. Each card must be useful as a standalone flashcard.

Do not create normal cards from bibliography entries, reading lists, author references, generic textbook references, ordinary explanatory paragraphs, equations that are merely intermediate proof lines, equations already contained inside theorem statements, formulas without a clear named concept, or duplicated content.

For formulas, only create a formula card if the formula is central, named, examinable, and useful as a standalone recall item. Otherwise keep the formula inside the definition/theorem/proof where it belongs.

For remarks, only keep them if they are conceptually important or explicitly examinable. Otherwise mark them low relevance.

Return kept items and rejected/low relevance items with reasons where the schema supports it.`;

export function getLlmExtractionPrompt() {
  return llmExtractionPrompt;
}

export async function extractRevisionItems({
  notesDocuments,
  guidanceDocuments,
  sourceFile = "Uploaded notes",
}: ExtractRevisionItemsInput): Promise<{ items: RevisionItem[]; rejectedItems: RejectedRevisionItem[]; verification: ExtractionVerificationReport; error?: string }> {
  const notesText = notesDocuments.map((doc) => doc.fullText).join("\n\n");
  const guidanceText = guidanceDocuments.map((doc) => doc.fullText).join("\n\n");
  const hasRealInput = Boolean(notesText.trim() || guidanceText.trim());

  const settings = loadLlmPipelineSettings();
  const safeMode = settings.mode as ExtractionPipelineMode;
  if (settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
    const llmResult = await extractViaApi({ notesDocuments, guidanceDocuments, sourceFile, settings });
    if (llmResult.items.length > 0 || llmResult.verification) {
      const { items, rejectedItems } = postProcessRevisionItems(llmResult.items, guidanceDocuments);
      return {
        items,
        rejectedItems,
        verification: mergeSuspiciousItems(llmResult.verification ?? emptyVerificationReport("Verification unavailable."), items),
        error: llmResult.error,
      };
    }
  }

  const extracted = deterministicExtract(notesDocuments, notesText, guidanceText, sourceFile, safeMode);
  if (extracted.length > 0) {
    const { items, rejectedItems } = postProcessRevisionItems(extracted, guidanceDocuments);
    return {
      items,
      rejectedItems,
      verification: mergeSuspiciousItems(emptyVerificationReport("Local deterministic extraction mode does not run LLM verification."), items),
    };
  }

  // Avoid showing mock cards when the user already provided real files.
  if (hasRealInput) {
    return {
      items: [],
      rejectedItems: [],
      verification: emptyVerificationReport("No extractable items detected from parsed content."),
    };
  }

  // Keep a mock fallback only for empty input demo mode.
  return {
    items: createMockRevisionItems().map(withValidation),
    rejectedItems: [],
    verification: emptyVerificationReport("Demo mode: mock data"),
  };
}

export function generateManualExtractionPrompt(input: { notesText: string; guidanceText: string; sourceFile: string }) {
  return `You are an exam revision extraction engine.

Use only the supplied lecture notes and guidance text. Do not invent missing theorem numbers, section numbers, or statements.

Return STRICT JSON ONLY as an array of RevisionItem objects matching this schema:
- id: string
- type: "definition" | "theorem" | "lemma" | "proposition" | "corollary" | "formula" | "proof" | "algorithm" | "example" | "remark" | "other"
- title: string
- conceptName?: string
- displayTitle?: string
- cardFront: string
- taskPrompt?: string
- statement: string
- statementLatex?: string
- originalRawText?: string
- proof?: string
- proofLatex?: string
- proofRequired?: boolean
- sourceFile: string
- sourceLocation?: string
- pageNumber?: number
- section?: string
- theoremNumber?: string
- tags: string[]
- importance: "must_know" | "partial" | "not_required" | "unknown"
- classificationConfidence?: "high" | "medium" | "low"
- guidanceReason?: string
- guidanceEvidence?: string[]
- uncertaintyNote?: string
- extractionWarning?: string
- questionPrompt: string
- answer: string
- answerLatex?: string
- createdAt: ISO string
- updatedAt: ISO string

Extraction requirements:
1) Extract precise, atomic items. One card must correspond to one definition, theorem, lemma, proposition, corollary, formula, proof, remark, example, assumption, or property.
2) Do not merge multiple labelled items. If the notes contain "Definition ... Remark ... Theorem ... Proof ... Definition ...", create separate items, with theorem proof stored in proof.
3) For labelled definitions, preserve only the definition statement. Exclude following remarks, proofs, examples, later definitions, and section text. Type must be "definition".
4) For labelled theorems, preserve the theorem statement in statement and preserve any immediately following proof separately in proof. Type must be "theorem".
5) Use type "formula" only for mainly formula/equation items that are not explicitly labelled as a definition/theorem/lemma/proposition/corollary.
6) Convert mathematical notation into LaTeX in statementLatex, proofLatex, and answerLatex where possible, without inventing content.
7) Also extract implicit theorem-like statements such as:
   "We say that...", "X is called...", "It follows that...", "A process is stationary if...", "The BLUP is given by..."
8) Preserve section info, source location, theorem numbering, and mathematical notation.
9) Classify importance from guidance:
   - must_know / partial / not_required / unknown
10) If unsure or text is incomplete, keep the item but set importance = "unknown" and add uncertaintyNote.
11) Generate clean exam-style prompts from title/type/number/topic only, never from long extracted text.
12) Output valid JSON only; no markdown fence, no commentary.

Flashcard front fields:
- conceptName?: short clean concept name, e.g. "Random field", "Random vector", "Weak stationarity", "Semivariogram"
- displayTitle?: full labelled title, e.g. "Definition 2.3. Random vector"
- cardFront: main flashcard front text, usually just conceptName, never "State Definition..."
- taskPrompt?: small helper instruction, e.g. "Recall the exact definition."
- questionPrompt remains only for compatibility.

Source file: ${input.sourceFile}

Guidance text:
${input.guidanceText || "(none)"}

Lecture notes:
${input.notesText}`;
}

async function extractViaApi(input: {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  sourceFile: string;
  settings: LlmPipelineSettings;
}): Promise<{ items: RevisionItem[]; verification?: ExtractionVerificationReport; error?: string }> {
  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = (await response.json()) as { items?: RevisionItem[]; verification?: ExtractionVerificationReport; error?: string };
    if (!response.ok) return { items: payload.items ?? [], verification: payload.verification, error: payload.error ?? "LLM extraction failed." };
    return { items: payload.items ?? [], verification: payload.verification };
  } catch {
    return { items: [], error: "Network error while contacting extraction API." };
  }
}

const llmSettingsStorageKey = "rivision.llm.settings.v1";

export function loadLlmPipelineSettings(): LlmPipelineSettings {
  if (typeof window === "undefined") return defaultLlmPipelineSettings;
  const raw = window.localStorage.getItem(llmSettingsStorageKey);
  if (!raw) return defaultLlmPipelineSettings;
  try {
    return { ...defaultLlmPipelineSettings, ...(JSON.parse(raw) as Partial<LlmPipelineSettings>) };
  } catch {
    return defaultLlmPipelineSettings;
  }
}

export function saveLlmPipelineSettings(settings: LlmPipelineSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(llmSettingsStorageKey, JSON.stringify(settings));
}

function deterministicExtract(
  notesDocuments: ParsedDocument[],
  notesText: string,
  guidanceText: string,
  sourceFile: string,
  mode: ExtractionPipelineMode,
): RevisionItem[] {
  if (mode !== "local_rules_only") return [];
  if (!notesText.trim() || notesText.includes("[PDF placeholder]") || notesText.includes("[DOCX placeholder]")) {
    return [];
  }

  const candidates = attachProofsToPreviousTheorem(segmentRevisionCandidates(notesDocuments));
  const items: RevisionItem[] = [];
  const timestamp = new Date().toISOString();

  for (const candidate of candidates) {
    if (candidate.type === "proof") continue;
    const statementWithPossibleTitle = clean(candidate.statement ?? stripLeadingLabel(candidate.rawText));
    const titleSplit = splitTitleFromStatement(statementWithPossibleTitle);
    const proofSplit = splitProofFromStatement(titleSplit.statement);
    const statement = clean(proofSplit.statement);
    let proof = candidate.proof ?? proofSplit.proof;
    proof = proof ? clean(proof) : undefined;
    if (!statement || statement.length < 15) continue;

    const theoremNumber = candidate.number ?? extractNumber(candidate.title ?? "");
    const conceptName = extractConceptName(candidate, {
      type: candidate.type,
      title: candidate.title ?? "",
      theoremNumber,
      statement,
      titleTopic: titleSplit.title,
    });
    const title = titleFromLabel(candidate.type, theoremNumber, titleSplit.title ?? conceptName, statement);
    const displayTitle = title;
    const cardFront = conceptName || title;
    const { importance, reason } = classifyImportance(candidate.type, title, statement, guidanceText);
    const uncertaintyNote = statement.length < 40 ? "Statement may be incomplete after text parsing." : undefined;
    const proofRequired = theoremLike(candidate.type) ? classifyProofRequired(guidanceText, title, statement) : undefined;
    const answer = buildAnswer(candidate.type, statement);

    items.push({
      id: createId("card"),
      type: candidate.type,
      title,
      conceptName,
      displayTitle,
      cardFront,
      taskPrompt: defaultTaskPrompt(candidate.type, proofRequired),
      statement,
      statementLatex: convertCommonMathToLatex(statement),
      originalRawText: candidate.rawText,
      proof,
      proofLatex: proof ? convertCommonMathToLatex(proof) : undefined,
      proofRequired,
      sourceFile: candidate.sourceFile || sourceFile,
      sourceLocation: candidate.sourceLocation,
      pageNumber: candidate.pageNumber,
      section: candidate.section,
      theoremNumber,
      tags: inferTags(candidate.type, `${title} ${statement}`),
      importance: uncertaintyNote ? "unknown" : importance,
      classificationConfidence: uncertaintyNote ? "low" : "medium",
      guidanceReason: reason,
      uncertaintyNote,
      extractionWarning: candidate.extractionWarning,
      questionPrompt: buildQuestionPrompt({ type: candidate.type, title, theoremNumber, statement, proofRequired }),
      answer,
      answerLatex: convertCommonMathToLatex(answer),
      standaloneValue: candidate.type === "formula" ? "low" : candidate.type === "remark" ? "medium" : "high",
      relevanceReason: candidate.type === "formula" ? "Formula requires relevance filtering before review." : "Labelled candidate extracted as a standalone card.",
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewCount: 0,
    });
  }

  return dedupeItems(items);
}

function postProcessRevisionItems(items: RevisionItem[], guidanceDocuments: ParsedDocument[]) {
  const validation = validateAndRepairRevisionItems(items);
  const relevance = filterRevisionItemsByRelevance(validation.validItems.map(withValidation), guidanceDocuments, loadRelevanceSettings());
  return {
    items: [...relevance.keptItems, ...validation.invalidItems].map(withValidation),
    rejectedItems: relevance.rejectedItems,
  };
}

function splitTitleFromStatement(statement: string) {
  const firstSentence = statement.match(/^([^.!?]{2,80})[.!?]\s+([\s\S]+)$/);
  if (!firstSentence) return { title: undefined, statement };
  const title = firstSentence[1].trim();
  const looksLikeStatement = /\b(is|are|has|if|then|defined|called|given|equals|denotes|consists)\b/i.test(title);
  const looksLikeBrokenMath = /[,(]$|[,()]|(?:^|\s)[A-Z][a-z]?\d\b|(?:^|\s)X_?\d\b/.test(title);
  const startsLikeStatement = /^(?:A|An|The|Let|Suppose|Assume)\b/i.test(title);
  if (title.split(/\s+/).length <= 8 && !looksLikeStatement && !looksLikeBrokenMath && !startsLikeStatement) {
    return { title, statement: firstSentence[2].trim() };
  }
  return { title: undefined, statement };
}

function dedupeItems(items: RevisionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}|${clean(item.title).toLowerCase()}|${clean(item.statement).toLowerCase().slice(0, 300)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function titleFromLabel(type: RevisionItemType, number: string | undefined, explicitTitle: string | undefined, statement: string) {
  if (number && explicitTitle) return `${capitalise(type)} ${number}. ${capitalise(explicitTitle)}`;
  if (number) return `${capitalise(type)} ${number}`;
  const firstWords = statement.split(" ").slice(0, 6).join(" ");
  return `${capitalise(type)}: ${firstWords}${statement.split(" ").length > 6 ? "..." : ""}`;
}

function defaultTaskPrompt(type: RevisionItemType, proofRequired: boolean | undefined) {
  if (type === "definition") return "Recall the exact definition.";
  if (type === "formula") return "Write down the formula and explain each term.";
  if (type === "proof" || proofRequired) return "Reproduce the proof.";
  if (theoremLike(type)) return "State the theorem and its conditions.";
  return "Recall the key statement.";
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function classifyImportance(type: RevisionItemType, title: string, statement: string, guidanceText: string): { importance: RevisionItem["importance"]; reason?: string } {
  const guidance = guidanceText.toLowerCase();
  const haystack = `${title} ${statement}`.toLowerCase();
  if (!guidance.trim()) return { importance: "unknown", reason: "No guidance file content was available." };

  if (guidance.includes("proof") && guidance.includes("not required") && type === "proof") {
    return { importance: "not_required", reason: "Guidance says proofs are not required." };
  }

  if (guidance.includes("only know the statement") && type === "proof") {
    return { importance: "not_required", reason: "Guidance says only the statement is required." };
  }

  if (guidance.includes("only know the statement") && ["theorem", "proposition", "lemma"].includes(type)) {
    return { importance: "must_know", reason: "Guidance says the statement is required." };
  }

  const numberMatch = title.match(/(\d+(?:\.\d+)+)/);
  if (numberMatch && guidance.includes(numberMatch[1])) {
    return { importance: "must_know", reason: `Guidance references ${numberMatch[1]}.` };
  }

  if (["must", "examinable", "memorise", "memorize"].some((word) => guidance.includes(word))) {
    const keywordHit = haystack.split(/\W+/).some((word) => word.length > 4 && guidance.includes(word));
    return {
      importance: keywordHit || type === "definition" ? "must_know" : "partial",
      reason: "Matched must-know style guidance.",
    };
  }

  if (guidance.includes("partial") || guidance.includes("statement")) {
    return { importance: "partial", reason: "Guidance suggests partial knowledge." };
  }

  if (guidance.includes("not required")) {
    return { importance: "not_required", reason: "Guidance says this material is not required." };
  }

  return { importance: "unknown", reason: "Could not confidently match this item to the guidance." };
}

function classifyProofRequired(guidanceText: string, title: string, statement: string) {
  const guidance = guidanceText.toLowerCase();
  const haystack = `${title} ${statement}`.toLowerCase();
  if (!guidance.trim()) return undefined;
  if (/proofs?\s+(?:are\s+)?not required|proof\s+not required|without proof|only (?:know )?the statement/.test(guidance)) return false;
  if (/\b(prove|proof required|derive|show that)\b/.test(guidance)) {
    const number = extractNumber(title);
    if (!number || guidance.includes(number) || haystack.split(/\W+/).some((word) => word.length > 4 && guidance.includes(word))) return true;
  }
  return undefined;
}

function mergeSuspiciousItems(report: ExtractionVerificationReport, items: RevisionItem[]): ExtractionVerificationReport {
  const existing = new Set(report.suspiciousItems.map((item) => `${item.itemId}|${item.issue}`));
  const suspiciousItems = [...report.suspiciousItems];
  for (const item of buildSuspiciousItems(items)) {
    const key = `${item.itemId}|${item.issue}`;
    if (existing.has(key)) continue;
    existing.add(key);
    suspiciousItems.push(item);
  }
  return { ...report, suspiciousItems };
}

function emptyVerificationReport(notes: string): ExtractionVerificationReport {
  return {
    missingCandidates: [],
    suspiciousItems: [],
    guidanceAmbiguities: [],
    overallCompleteness: "low",
    notes,
  };
}

function inferTags(type: RevisionItemType, text: string) {
  const tags = new Set<string>([type]);
  for (const keyword of ["stationarity", "covariance", "variogram", "kriging", "proof", "formula", "theorem", "algorithm", "example"]) {
    if (text.toLowerCase().includes(keyword)) tags.add(keyword);
  }
  return Array.from(tags);
}

function buildAnswer(type: RevisionItemType, statement: string) {
  if (type === "formula") return `${statement}\n\nExplain the notation and conditions under which the formula applies.`;
  return statement;
}
*/
