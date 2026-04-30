import { OpenAiResponsesProvider } from "@/lib/llm/openai-provider";
import type { LlmPipelineSettings } from "@/lib/llm/provider";
import { defaultLlmPipelineSettings } from "@/lib/llm/provider";
import type { ExtractionVerificationReport, ParsedDocument, RevisionItem } from "@/lib/types";

export async function runLlmExtractionPipeline(input: {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  settings?: Partial<LlmPipelineSettings>;
}): Promise<{ items: RevisionItem[]; verification: ExtractionVerificationReport }> {
  const settings = { ...defaultLlmPipelineSettings, ...input.settings };
  const primary = new OpenAiResponsesProvider({ model: settings.primaryModel });

  if (settings.mode === "cheap_scan_then_verify") {
    const cheap = new OpenAiResponsesProvider({ model: settings.cheapModel });
    await cheap.extractRevisionItems({
      notesDocuments: input.notesDocuments,
      guidanceDocuments: input.guidanceDocuments,
      pipelineMode: settings.mode,
    });
  }

  const items = await primary.extractRevisionItems({
    notesDocuments: input.notesDocuments,
    guidanceDocuments: input.guidanceDocuments,
    pipelineMode: settings.mode,
  });

  const verification = await primary.verifyExtractionCompleteness({
    notesDocuments: input.notesDocuments,
    guidanceDocuments: input.guidanceDocuments,
    extractedItems: items,
  });

  return { items, verification };
}
