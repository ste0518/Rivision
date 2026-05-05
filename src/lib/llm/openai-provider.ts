import OpenAI from "openai";
import { createRevisionItemFromCandidate, curateRevisionDeck } from "@/lib/curation";
import { buildExamPriorityMap } from "@/lib/course-priority";
import { extractionSystemPrompt, verificationSystemPrompt } from "@/lib/llm/prompts";
import type { LLMProvider } from "@/lib/llm/provider";
import { curatedDeckResponseSchema, verificationReportSchema } from "@/lib/llm/schemas";
import { attachProofsToPreviousTheorem, segmentRevisionCandidates } from "@/lib/segmentation";
import { excerptGroundedInSource } from "@/lib/source-grounding";
import type { CandidateRevisionBlock, CuratedDeckResult, ExtractionPipelineMode, ExtractionVerificationReport, ParsedDocument, RejectedRevisionItem, RevisionItem } from "@/lib/types";

const maxLlmCandidates = Number(process.env.RIVISION_MAX_LLM_CANDIDATES ?? 90);
const maxCandidateChars = Number(process.env.RIVISION_MAX_LLM_CANDIDATE_CHARS ?? 1200);
const maxProofChars = Number(process.env.RIVISION_MAX_LLM_PROOF_CHARS ?? 900);
const maxAssessmentChars = Number(process.env.RIVISION_MAX_LLM_ASSESSMENT_CHARS ?? 16000);
const maxPromptOutputTokens = Number(process.env.RIVISION_MAX_LLM_OUTPUT_TOKENS ?? 10000);

type OpenAiProviderOptions = {
  model: string;
  apiKey?: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
};

export class OpenAiResponsesProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private reasoningEffort?: OpenAiProviderOptions["reasoningEffort"];

  constructor(options: OpenAiProviderOptions) {
    const apiKey = options.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error("Missing OpenAI API key.");
    this.client = new OpenAI({ apiKey });
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
  }

  async extractRevisionItems(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pastPaperDocuments?: ParsedDocument[];
    problemSheetDocuments?: ParsedDocument[];
    solutionDocuments?: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<RevisionItem[]> {
    const curated = await this.curateRevisionDeck(input);
    return curated.keptItems;
  }

  async curateRevisionDeck(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pastPaperDocuments?: ParsedDocument[];
    problemSheetDocuments?: ParsedDocument[];
    solutionDocuments?: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<CuratedDeckResult> {
    const candidates = attachProofsToPreviousTheorem(segmentRevisionCandidates(input.notesDocuments));
    const pastPaperDocuments = input.pastPaperDocuments ?? [];
    const problemSheetDocuments = input.problemSheetDocuments ?? [];
    const solutionDocuments = input.solutionDocuments ?? [];
    const selectedCandidates = selectLlmCandidates(candidates);
    const notesText = renderCandidateDocumentSet(selectedCandidates, input.guidanceDocuments);
    const notesFullText = renderDocumentSet("NOTES", input.notesDocuments);
    const guidanceText = renderCompactDocumentSet("GUIDANCE", input.guidanceDocuments, maxAssessmentChars);
    const assessmentText = [
      renderCompactDocumentSet("GUIDANCE", input.guidanceDocuments, maxAssessmentChars),
      renderCompactDocumentSet("PAST_PAPER", pastPaperDocuments, maxAssessmentChars),
      renderCompactDocumentSet("PROBLEM_SHEET", problemSheetDocuments, maxAssessmentChars),
      renderCompactDocumentSet("SOLUTION_OR_MARK_SCHEME", solutionDocuments, maxAssessmentChars),
    ].filter(Boolean).join("\n\n");

    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: maxPromptOutputTokens,
      ...reasoningRequestOptions(this.model, this.reasoningEffort),
      input: [
        { role: "system", content: extractionSystemPrompt },
        {
          role: "user",
          content: `Pipeline mode: ${input.pipelineMode}\n\nCandidate selection: ${selectedCandidates.length} highest-signal blocks from ${candidates.length} detected blocks. Prefer exact source excerpts and avoid inventing omitted context.\n\nGuidance and assessment evidence:\n${assessmentText || guidanceText || "(none)"}\n\nSegmented candidate blocks:\n${notesText}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "curated_revision_deck",
          schema: curatedDeckResponseSchema,
          strict: false,
        },
      },
    });

    const payload = safeParseJson<CuratedDeckResult>(response.output_text);
    if (payload) {
      const grounded = applySourceExcerptGate(payload, `${notesFullText}\n\n${assessmentText || guidanceText}`);
      return { ...grounded, rejectedItems: hydrateRejectedItems(grounded.rejectedItems, candidates, assessmentText || guidanceText) };
    }
    const examPriorityMap = await buildExamPriorityMap({
      notesDocuments: input.notesDocuments,
      guidanceDocuments: input.guidanceDocuments,
      pastPaperDocuments,
      problemSheetDocuments,
      solutionDocuments,
    });
    return curateRevisionDeck({
      candidates,
      guidanceDocuments: input.guidanceDocuments,
      parsedNotes: input.notesDocuments,
      pastPaperDocuments,
      problemSheetDocuments,
      solutionDocuments,
      examPriorityMap,
    });
  }

  async verifyExtractionCompleteness(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    extractedItems: RevisionItem[];
  }): Promise<ExtractionVerificationReport> {
    const notesText = renderDocumentSet("NOTES", input.notesDocuments);
    const guidanceText = renderDocumentSet("GUIDANCE", input.guidanceDocuments);

    const response = await this.client.responses.create({
      model: this.model,
      store: false,
      max_output_tokens: Math.min(maxPromptOutputTokens, 6000),
      ...reasoningRequestOptions(this.model, this.reasoningEffort),
      input: [
        { role: "system", content: verificationSystemPrompt },
        {
          role: "user",
          content: `Original notes:\n${notesText}\n\nGuidance:\n${guidanceText}\n\nExtracted JSON:\n${JSON.stringify(input.extractedItems)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "extraction_verification_report",
          schema: verificationReportSchema,
          strict: true,
        },
      },
    });

    const parsed = safeParseJson<ExtractionVerificationReport>(response.output_text);
    return (
      parsed ?? {
        missingCandidates: [],
        suspiciousItems: [],
        guidanceAmbiguities: [],
        overallCompleteness: "low",
        notes: "Verification output could not be parsed.",
      }
    );
  }
}

function reasoningRequestOptions(model: string, effort: OpenAiProviderOptions["reasoningEffort"]) {
  if (!effort || !supportsReasoningEffort(model)) return {};
  return { reasoning: { effort } };
}

function supportsReasoningEffort(model: string) {
  return /^gpt-5(\.|-|$)/.test(model) || /^o\d/.test(model);
}

function renderCandidateDocumentSet(candidates: CandidateRevisionBlock[], guidanceDocuments: ParsedDocument[]) {
  return JSON.stringify({
    candidates: candidates.map(compactCandidateForLlm),
    guidanceDocuments: guidanceDocuments.map((doc) => compactDocumentForLlm("GUIDANCE", doc, maxAssessmentChars)),
  }, null, 2);
}

function selectLlmCandidates(candidates: CandidateRevisionBlock[]) {
  const selected = [...candidates]
    .sort((a, b) => candidatePriority(b) - candidatePriority(a))
    .slice(0, Math.max(30, maxLlmCandidates));
  return selected.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0));
}

function candidatePriority(candidate: CandidateRevisionBlock) {
  const typeBoost: Partial<Record<CandidateRevisionBlock["type"], number>> = {
    theorem: 18,
    lemma: 17,
    proposition: 17,
    corollary: 15,
    definition: 16,
    formula: 14,
    algorithm: 14,
    proof: 10,
    example: 6,
    remark: 4,
  };
  const title = `${candidate.title ?? ""} ${candidate.rawText.slice(0, 160)}`.toLowerCase();
  const keywordBoost =
    /(important|exam|shown|therefore|estimator|algorithm|method|definition|theorem|proposition|formula|variance|likelihood|sampling|markov|monte carlo)/.test(title)
      ? 8
      : 0;
  const lengthBoost = candidate.rawText.length > 80 && candidate.rawText.length < 2500 ? 4 : 0;
  return (typeBoost[candidate.type] ?? 2) + keywordBoost + lengthBoost;
}

function compactCandidateForLlm(candidate: CandidateRevisionBlock) {
  return {
    id: candidate.id,
    label: candidate.label,
    type: candidate.type,
    candidateKind: candidate.candidateKind,
    conceptName: candidate.conceptName,
    number: candidate.number,
    title: candidate.title,
    statement: truncateForLlm(candidate.statement ?? candidate.rawText, maxCandidateChars),
    proof: candidate.proof ? truncateForLlm(candidate.proof, maxProofChars) : undefined,
    rawText: truncateForLlm(candidate.rawText, maxCandidateChars),
    sourceFile: candidate.sourceFile,
    pageNumber: candidate.pageNumber,
    sourceLocation: candidate.sourceLocation,
    section: candidate.section,
  };
}

function compactDocumentForLlm(kind: string, doc: ParsedDocument, maxChars: number) {
  return {
    kind,
    sourceFile: doc.sourceFile,
    pageCount: doc.pages?.length,
    excerpt: truncateForLlm(renderDocumentTextForLlm(doc), maxChars),
  };
}

function renderCompactDocumentSet(kind: "GUIDANCE" | "PAST_PAPER" | "PROBLEM_SHEET" | "SOLUTION_OR_MARK_SCHEME", docs: ParsedDocument[], maxChars: number) {
  return docs.map((doc) => {
    const compact = compactDocumentForLlm(kind, doc, maxChars);
    return `[${kind} SOURCE: ${compact.sourceFile}]\n${compact.excerpt}`;
  }).join("\n\n");
}

function renderDocumentTextForLlm(doc: ParsedDocument) {
  if (doc.pages?.length) {
    return doc.pages.map((page) => `[Page ${page.pageNumber}]\n${page.text}`).join("\n\n");
  }
  return doc.fullText;
}

function truncateForLlm(value: string | undefined, maxChars: number) {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)} ... [truncated]`;
}

function hydrateRejectedItems(rejectedItems: RejectedRevisionItem[], candidates: CandidateRevisionBlock[], guidanceText: string) {
  const byCandidateId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return rejectedItems.map((item) => {
    if (item.originalItem || !item.originalCandidateId) return item;
    const candidate = byCandidateId.get(item.originalCandidateId);
    if (!candidate) return item;
    return {
      ...item,
      originalItem: createRevisionItemFromCandidate(candidate, guidanceText),
      sourceLocation: item.sourceLocation ?? candidate.sourceLocation,
    };
  });
}

function applySourceExcerptGate(curated: CuratedDeckResult, sourceText: string): CuratedDeckResult {
  const keptItems: RevisionItem[] = [];
  const needsReviewItems: RevisionItem[] = [...curated.needsReviewItems];

  for (const item of curated.keptItems) {
    const excerpt = item.sourceExcerpt?.trim() || item.originalRawText?.slice(0, 500).trim() || "";
    const grounded = excerpt.length >= 12 && excerptGroundedInSource(excerpt, sourceText);
    if (grounded) {
      keptItems.push(item);
      continue;
    }
    needsReviewItems.push({
      ...item,
      curationDecision: "needs_review",
      curationStatus: "needs_review",
      classificationConfidence: "low",
      extractionWarning: item.extractionWarning ?? "Source excerpt is missing or not grounded in the current upload.",
      warnings: [...(item.warnings ?? []), "Source excerpt is missing or not grounded in the current upload."],
    });
  }

  return {
    ...curated,
    keptItems,
    needsReviewItems,
    curationReport: {
      ...curated.curationReport,
      notes: [
        ...(curated.curationReport?.notes ?? []),
        keptItems.length === curated.keptItems.length ? "All kept LLM items passed source-excerpt grounding." : "Some LLM kept items were moved to needs review because source excerpts were missing or ungrounded.",
      ],
    },
  };
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function renderDocumentSet(kind: "NOTES" | "GUIDANCE" | "PAST_PAPER" | "PROBLEM_SHEET" | "SOLUTION_OR_MARK_SCHEME", docs: ParsedDocument[]) {
  return docs
    .map((doc) => {
      const candidates = detectCandidateLines(doc.fullText);
      const candidateBlock = candidates.length > 0
        ? `\n\n[Detected ${kind} candidates]\n${candidates.slice(0, 200).map((line) => `- ${line}`).join("\n")}`
        : "";
      if (doc.pages?.length) {
        return `[${kind} SOURCE: ${doc.sourceFile}]\n${doc.pages
          .map((page) => `[Page ${page.pageNumber}]\n${page.text}`)
          .join("\n\n")}${candidateBlock}`;
      }
      return `[${kind} SOURCE: ${doc.sourceFile}]\n${doc.fullText}${candidateBlock}`;
    })
    .join("\n\n");
}

function detectCandidateLines(fullText: string) {
  const lines = fullText.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const explicitRegex = /^(definition|theorem|lemma|proposition|corollary|formula|proof|algorithm|example|remark|assumption|result|property)\b/i;
  const implicitRegex =
    /(we say that|is called|is defined as|is given by|satisfies|we have|therefore,?|hence,?|it follows that|the following result|this gives|show that|derive|let\s+.+\s+be\s+(?:a|an)\s+)/i;
  return lines.filter((line) => explicitRegex.test(line) || implicitRegex.test(line));
}
