import OpenAI from "openai";
import { createRevisionItemFromCandidate, curateRevisionDeck } from "@/lib/curation";
import { extractionSystemPrompt, verificationSystemPrompt } from "@/lib/llm/prompts";
import type { LLMProvider } from "@/lib/llm/provider";
import { curatedDeckResponseSchema, verificationReportSchema } from "@/lib/llm/schemas";
import { attachProofsToPreviousTheorem, segmentRevisionCandidates } from "@/lib/segmentation";
import type { CandidateRevisionBlock, CuratedDeckResult, ExtractionPipelineMode, ExtractionVerificationReport, ParsedDocument, RejectedRevisionItem, RevisionItem } from "@/lib/types";

type OpenAiProviderOptions = {
  model: string;
};

export class OpenAiResponsesProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(options: OpenAiProviderOptions) {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = options.model;
  }

  async extractRevisionItems(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<RevisionItem[]> {
    const curated = await this.curateRevisionDeck(input);
    return curated.keptItems;
  }

  async curateRevisionDeck(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<CuratedDeckResult> {
    const candidates = attachProofsToPreviousTheorem(segmentRevisionCandidates(input.notesDocuments));
    const notesText = renderCandidateDocumentSet(input.notesDocuments, input.guidanceDocuments);
    const guidanceText = renderDocumentSet("GUIDANCE", input.guidanceDocuments);

    const response = await this.client.responses.create({
      model: this.model,
      input: [
        { role: "system", content: extractionSystemPrompt },
        {
          role: "user",
          content: `Pipeline mode: ${input.pipelineMode}\n\nGuidance:\n${guidanceText || "(none)"}\n\nSegmented candidate blocks:\n${notesText}`,
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
    if (payload) return { ...payload, rejectedItems: hydrateRejectedItems(payload.rejectedItems, candidates, guidanceText) };
    return curateRevisionDeck({
      candidates,
      guidanceDocuments: input.guidanceDocuments,
      parsedNotes: input.notesDocuments,
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

function renderCandidateDocumentSet(notesDocuments: ParsedDocument[], guidanceDocuments: ParsedDocument[]) {
  const candidates = attachProofsToPreviousTheorem(segmentRevisionCandidates(notesDocuments));
  return JSON.stringify({ candidates, guidanceDocuments }, null, 2);
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

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function renderDocumentSet(kind: "NOTES" | "GUIDANCE", docs: ParsedDocument[]) {
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
  const implicitRegex = /(we say that|is called|is defined as|process is stationary if|covariance function is valid if|estimator is given by|the blup is|the semivariogram is|it follows that|the following result|therefore, we have|this gives)/i;
  return lines.filter((line) => explicitRegex.test(line) || implicitRegex.test(line));
}
