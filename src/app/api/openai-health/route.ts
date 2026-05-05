import OpenAI from "openai";
import { NextResponse } from "next/server";
import { defaultLlmPipelineSettings } from "@/lib/llm/provider";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { openaiApiKey?: string; model?: string };
    const apiKey = body.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    const model = body.model?.trim() || defaultLlmPipelineSettings.primaryModel;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "No API key found. Add a temporary key here, or configure OPENAI_API_KEY in Vercel." }, { status: 400 });
    }

    const client = new OpenAI({ apiKey });
    await client.models.retrieve(model);
    return NextResponse.json({ ok: true, model });
  } catch (error) {
    return NextResponse.json({ ok: false, error: friendlyOpenAiError(error) }, { status: openAiStatus(error) });
  }
}

function openAiStatus(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : 500;
  return Number.isFinite(status) && status >= 400 ? status : 500;
}

function friendlyOpenAiError(error: unknown) {
  const status = openAiStatus(error);
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: string }).code ?? "") : "";
  const message = error instanceof Error ? error.message : "OpenAI API test failed.";
  const lower = `${code} ${message}`.toLowerCase();

  if (status === 401 || lower.includes("invalid api key")) return "The API key was rejected. Check that it starts with sk- and was copied completely.";
  if (status === 403) return "This key does not have permission for the selected project/model. Try GPT-5 mini, or check the key's project permissions.";
  if (status === 404 || lower.includes("model") || lower.includes("does not exist")) return "The selected model is not available to this API key. Try GPT-5 mini first, then move up to GPT-5.5 if your account has access.";
  if (status === 429 || lower.includes("quota") || lower.includes("billing")) return "OpenAI rejected the request because of quota, billing, or rate limits. Check billing/usage on the OpenAI platform.";
  return message;
}
