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

    const openaiApiKey = body.settings?.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "Missing OpenAI API key. Add a key in Settings, or configure OPENAI_API_KEY on Vercel." },
        { status: 400 },
      );
    }

    const result = await runLlmExtractionPipeline({
      notesDocuments: Array.isArray(body.notesDocuments) ? body.notesDocuments : [],
      guidanceDocuments: Array.isArray(body.guidanceDocuments) ? body.guidanceDocuments : [],
      pastPaperDocuments: Array.isArray(body.pastPaperDocuments) ? body.pastPaperDocuments : [],
      problemSheetDocuments: Array.isArray(body.problemSheetDocuments) ? body.problemSheetDocuments : [],
      solutionDocuments: Array.isArray(body.solutionDocuments) ? body.solutionDocuments : [],
      settings: { ...body.settings, openaiApiKey },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = friendlyOpenAiError(error);
    return NextResponse.json({ error: message }, { status: openAiStatus(error) });
  }
}

function openAiStatus(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 500;
  return Number.isFinite(status) && status >= 400 ? status : 500;
}

function friendlyOpenAiError(error: unknown) {
  const status = openAiStatus(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "Unknown extraction failure";
  const lower = `${code} ${message}`.toLowerCase();

  if (status === 401 || lower.includes("invalid api key")) return "The OpenAI API key was rejected. Check that it starts with sk- and was copied completely.";
  if (status === 403) return "This OpenAI key does not have permission for the selected model/project. Try GPT-5 mini in Settings, or check project permissions.";
  if (status === 404 || lower.includes("model") || lower.includes("does not exist")) return "The selected model is not available to this API key. In Settings, switch Primary model to GPT-5 mini and test again.";
  if (status === 429 || lower.includes("quota") || lower.includes("billing")) return "OpenAI rejected the request because of quota, billing, or rate limits. Check billing/usage on the OpenAI platform.";
  return message;
}
