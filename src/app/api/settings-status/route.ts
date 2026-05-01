import { NextResponse } from "next/server";

/** Reports whether server-side OpenAI is configured (does not expose secrets). */
export async function GET() {
  return NextResponse.json({ openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()) });
}
