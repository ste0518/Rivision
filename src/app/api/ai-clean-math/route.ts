import katex from "katex";
import OpenAI from "openai";
import { NextResponse } from "next/server";

const prompt = `Convert this extracted lecture-note text into clean Markdown with LaTeX math.
Preserve the exact mathematical meaning.
Do not add new content.
Repair obvious PDF extraction artefacts.
Return only the corrected Markdown.`;

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "AI math cleanup requires API key." }, { status: 400 });
    }

    const body = (await request.json()) as { text?: string };
    const text = typeof body.text === "string" ? body.text : "";
    if (!text.trim()) return NextResponse.json({ error: "No text supplied." }, { status: 400 });

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: process.env.OPENAI_MATH_CLEANUP_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ],
    });

    const markdown = response.output_text.trim();
    const issues = validateKatex(markdown);
    return NextResponse.json({ markdown, latexQuality: issues.length ? "low" : "high", issues });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI math cleanup failure.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function validateKatex(markdown: string) {
  const issues: string[] = [];
  const inlineMatches = [...markdown.matchAll(/\$([^$\n]+)\$/g)].map((match) => match[1]);
  const blockMatches = [...markdown.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((match) => match[1]);
  for (const expression of [...inlineMatches, ...blockMatches]) {
    try {
      katex.renderToString(expression, { throwOnError: true });
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "KaTeX render error.");
    }
  }
  return Array.from(new Set(issues));
}
