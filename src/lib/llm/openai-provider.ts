import OpenAI from "openai";
import { extractionSystemPrompt, verificationSystemPrompt } from "@/lib/llm/prompts";
import type { LLMProvider } from "@/lib/llm/provider";
import { revisionItemsResponseSchema, verificationReportSchema } from "@/lib/llm/schemas";
import type { ExtractionVerificationReport, RevisionItem } from "@/lib/types";

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
    notesText: string;
    guidanceText: string;
    sourceFile: string;
  }): Promise<RevisionItem[]> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        { role: "system", content: extractionSystemPrompt },
        {
          role: "user",
          content: `Source file: ${input.sourceFile}\n\nGuidance:\n${input.guidanceText || "(none)"}\n\nNotes:\n${input.notesText}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "revision_item_array",
          schema: revisionItemsResponseSchema,
          strict: true,
        },
      },
    });

    const payload = safeParseJson<{ items: RevisionItem[] }>(response.output_text);
    return payload?.items ?? [];
  }

  async verifyExtractionCompleteness(input: {
    notesText: string;
    extractedItems: RevisionItem[];
  }): Promise<ExtractionVerificationReport> {
    const response = await this.client.responses.create({
      model: this.model,
      input: [
        { role: "system", content: verificationSystemPrompt },
        {
          role: "user",
          content: `Original notes:\n${input.notesText}\n\nExtracted JSON:\n${JSON.stringify(input.extractedItems)}`,
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
        overallCompleteness: "low",
        notes: "Verification output could not be parsed.",
      }
    );
  }
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
