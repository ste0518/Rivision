import type { CuratedDeckResult, ExtractionPipelineMode, ExtractionVerificationReport, ParsedDocument, RevisionItem } from "@/lib/types";

export interface LLMProvider {
  extractRevisionItems(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pastPaperDocuments?: ParsedDocument[];
    problemSheetDocuments?: ParsedDocument[];
    solutionDocuments?: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<RevisionItem[]>;

  curateRevisionDeck(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pastPaperDocuments?: ParsedDocument[];
    problemSheetDocuments?: ParsedDocument[];
    solutionDocuments?: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<CuratedDeckResult>;

  verifyExtractionCompleteness(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    extractedItems: RevisionItem[];
  }): Promise<ExtractionVerificationReport>;
}

export type LlmPipelineSettings = {
  mode: ExtractionPipelineMode;
  cheapModel: string;
  primaryModel: string;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  verifyExtraction?: boolean;
  /** Browser-saved user key. Sent only to server API routes for the current extraction request. */
  openaiApiKey?: string;
};

export const defaultLlmPipelineSettings: LlmPipelineSettings = {
  mode: "ai_key_revision_analysis",
  cheapModel: "gpt-5-mini",
  primaryModel: "gpt-5-mini",
  reasoningEffort: "high",
  verifyExtraction: false,
};
