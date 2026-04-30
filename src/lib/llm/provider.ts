import type { ExtractionPipelineMode, ExtractionVerificationReport, ParsedDocument, RevisionItem } from "@/lib/types";

export interface LLMProvider {
  extractRevisionItems(input: {
    notesDocuments: ParsedDocument[];
    guidanceDocuments: ParsedDocument[];
    pipelineMode: ExtractionPipelineMode;
  }): Promise<RevisionItem[]>;

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
};

export const defaultLlmPipelineSettings: LlmPipelineSettings = {
  mode: "local_rules_only",
  cheapModel: "gpt-4.1-mini",
  primaryModel: "gpt-5.5",
};
