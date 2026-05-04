import katex from "katex";

export type LatexValidationResult = {
  status: "ok" | "needs_check" | "broken";
  issues: string[];
};

function countChar(s: string, ch: string) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) if (s[i] === ch) n += 1;
  return n;
}

function extractDelimitedMath(text: string): { expressions: string[]; outside: string } {
  const expressions: string[] = [];
  let outside = text;

  const consume = (re: RegExp, groupIndex = 1) => {
    outside = outside.replace(re, (...args: unknown[]) => {
      const math = String(args[groupIndex] ?? "");
      expressions.push(math.trim());
      return " ";
    });
  };

  consume(/\\\[([\s\S]*?)\\\]/g);
  consume(/\\\(([\s\S]*?)\\\)/g);
  consume(/\$\$([\s\S]*?)\$\$/g);
  consume(/(^|[^$\\])\$([^$\n]+?)\$/g, 2);

  return { expressions, outside };
}

function validateKatexExpressions(expressions: string[]): string[] {
  const issues: string[] = [];
  for (const expression of expressions) {
    if (!expression.trim()) continue;
    try {
      katex.renderToString(expression, {
        throwOnError: true,
        strict: "ignore",
        trust: false,
      });
    } catch (error) {
      issues.push(`KaTeX render error: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return issues;
}

/** Local checks plus a real KaTeX render pass for delimited expressions. */
export function validateLatexSnippet(raw: string): LatexValidationResult {
  const text = (raw ?? "").trim();
  if (!text) return { status: "broken", issues: ["Empty formula"] };

  const issues: string[] = [];
  const { expressions, outside } = extractDelimitedMath(text);

  const openParen = (text.match(/\\\(/g) ?? []).length;
  const closeParen = (text.match(/\\\)/g) ?? []).length;
  if (openParen !== closeParen) issues.push(`Unbalanced \\\( ... \\\) (${openParen} open, ${closeParen} close)`);

  const openBrack = (text.match(/\\\[/g) ?? []).length;
  const closeBrack = (text.match(/\\\]/g) ?? []).length;
  if (openBrack !== closeBrack) issues.push(`Unbalanced \\[ ... \\] (${openBrack} open, ${closeBrack} close)`);

  const dollars = countChar(text, "$");
  if (dollars % 2 !== 0) issues.push("Unbalanced $ ... $");

  if (/\$\s*\$/.test(text) || /\\\(\s*\\\)/.test(text) || /\\\[\s*\\\]/.test(text)) issues.push("Formula appears empty");

  if (/\\begin\{[^}]+\}/.test(text) && !/\\end\{/.test(text)) issues.push("\\begin without matching \\end");
  if (/\{\s*\}\s*\{/.test(text)) issues.push("Possible empty brace groups");

  if (/_{4,}|\^{4,}/.test(text)) issues.push("Deep or repeated sub/superscripts — verify");
  if (/\\[A-Za-z]+/.test(outside)) issues.push("Bare TeX command outside math delimiters — it may render as raw text.");

  /** PDF / vector math extraction artefacts — not strict TeX errors but unreliable for “math ok”. */
  if (/[\u25A1\u25A0\uFFFD\u25FB\u25FC]/.test(text)) issues.push("Missing glyph placeholders (□) — notation may be incomplete.");
  if (/\.{6,}/.test(text)) issues.push("Long dotted leaders — likely PDF matrix/layout junk.");
  if (/\[missing glyphs\]/i.test(text)) issues.push("Marked missing glyphs from PDF extraction.");
  if (/∫\s*['′′′]+\s*/.test(text) || /∫\s*'\s*'\s*/.test(text)) issues.push("Malformed integral / prime marks — verify against source.");
  if (/(?:\?\([^)]*\)){2,}/.test(text) || /\bp\?\(/.test(text)) issues.push("Suspicious ?(…) tokens — possible OCR or star-notation noise.");
  issues.push(...validateKatexExpressions(expressions));

  if (issues.length === 0) return { status: "ok", issues: [] };
  const severe = issues.some(
    (i) =>
      i.includes("Unbalanced") ||
      i.includes("Empty") ||
      i.includes("Missing glyph") ||
      i.includes("missing glyphs") ||
      i.includes("KaTeX render error"),
  );
  return { status: severe ? "broken" : "needs_check", issues };
}

export function mathStatusFromValidation(result: LatexValidationResult): "ok" | "needs_check" | "broken" {
  if (result.status === "ok") return "ok";
  if (result.status === "broken") return "broken";
  return "needs_check";
}
