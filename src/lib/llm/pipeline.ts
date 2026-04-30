import { OpenAiResponsesProvider } from "@/lib/llm/openai-provider";
import type { LlmPipelineSettings } from "@/lib/llm/provider";
import { defaultLlmPipelineSettings } from "@/lib/llm/provider";
import type { ExtractionVerificationReport, RevisionItem } from "@/lib/types";

export async function runLlmExtractionPipeline(input: {
  notesText: string;
  guidanceText: string;
  sourceFile: string;
  settings?: Partial<LlmPipelineSettings>;
}): Promise<{ items: RevisionItem[]; verification: ExtractionVerificationReport }> {
  const settings = { ...defaultLlmPipelineSettings, ...input.settings };
  const primary = new OpenAiResponsesProvider({ model: settings.primaryModel });

  let primaryInputNotes = input.notesText;

  if (settings.mode === "cheap_scan_then_verify") {
    const cheap = new OpenAiResponsesProvider({ model: settings.cheapModel });
    const candidateItems = await cheap.extractRevisionItems({
      notesText: input.notesText,
      guidanceText: input.guidanceText,
      sourceFile: input.sourceFile,
    });

    const candidateSummary = candidateItems
      .slice(0, 200)
      .map((item) => `- ${item.type}: ${item.title} (${item.sourceLocation ?? "source unknown"})`)
      .join("\n");

    primaryInputNotes = `${input.notesText}\n\n[Cheap scan candidate blocks]\n${candidateSummary}`;
  }

  const items = await primary.extractRevisionItems({
    notesText: primaryInputNotes,
    guidanceText: input.guidanceText,
    sourceFile: input.sourceFile,
  });

  const verification = await primary.verifyExtractionCompleteness({
    notesText: input.notesText,
    extractedItems: items,
  });

  return { items, verification };
}
