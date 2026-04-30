import type { ExtractionVerificationReport, RevisionItem } from "@/lib/types";

export interface LLMProvider {
  extractRevisionItems(input: {
    notesText: string;
    guidanceText: string;
    sourceFile: string;
  }): Promise<RevisionItem[]>;

  verifyExtractionCompleteness(input: {
    notesText: string;
    extractedItems: RevisionItem[];
  }): Promise<ExtractionVerificationReport>;
}

export type ExtractionMode = "local_rules_only" | "manual_json_import" | "openai_api" | "cheap_scan_then_verify";

export type LlmPipelineSettings = {
  mode: ExtractionMode;
  cheapModel: string;
  primaryModel: string;
};

export const defaultLlmPipelineSettings: LlmPipelineSettings = {
  mode: "local_rules_only",
  cheapModel: "gpt-4.1-mini",
  primaryModel: "gpt-5.5",
};
