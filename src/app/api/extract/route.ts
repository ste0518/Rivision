import { NextResponse } from "next/server";
import { runLlmExtractionPipeline } from "@/lib/llm/pipeline";
import type { LlmPipelineSettings } from "@/lib/llm/provider";
import type { ParsedDocument } from "@/lib/types";
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      notesDocuments: ParsedDocument[];
      guidanceDocuments: ParsedDocument[];
      pastPaperDocuments?: ParsedDocument[];
      problemSheetDocuments?: ParsedDocument[];
      solutionDocuments?: ParsedDocument[];
      settings?: Partial<LlmPipelineSettings>;
    };

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY. Switch to local_rules_only or manual_json_import mode in Settings, or configure OPENAI_API_KEY for OpenAI mode." },
        { status: 400 },
      );
    }

    const result = await runLlmExtractionPipeline({
      notesDocuments: Array.isArray(body.notesDocuments) ? body.notesDocuments : [],
      guidanceDocuments: Array.isArray(body.guidanceDocuments) ? body.guidanceDocuments : [],
      pastPaperDocuments: Array.isArray(body.pastPaperDocuments) ? body.pastPaperDocuments : [],
      problemSheetDocuments: Array.isArray(body.problemSheetDocuments) ? body.problemSheetDocuments : [],
      solutionDocuments: Array.isArray(body.solutionDocuments) ? body.solutionDocuments : [],
      settings: body.settings,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown extraction failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
