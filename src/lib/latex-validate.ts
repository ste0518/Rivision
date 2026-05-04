export type LatexValidationResult = {
  status: "ok" | "needs_check" | "broken";
  issues: string[];
};

function countChar(s: string, ch: string) {
  let n = 0;
  for (let i = 0; i < s.length; i += 1) if (s[i] === ch) n += 1;
  return n;
}

/** Lightweight local checks — no full TeX parser. */
export function validateLatexSnippet(raw: string): LatexValidationResult {
  const text = (raw ?? "").trim();
  if (!text) return { status: "broken", issues: ["Empty formula"] };

  const issues: string[] = [];

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

  /** PDF / vector math extraction artefacts — not strict TeX errors but unreliable for “math ok”. */
  if (/[\u25A1\u25A0\uFFFD\u25FB\u25FC]/.test(text)) issues.push("Missing glyph placeholders (□) — notation may be incomplete.");
  if (/\.{6,}/.test(text)) issues.push("Long dotted leaders — likely PDF matrix/layout junk.");
  if (/\[missing glyphs\]/i.test(text)) issues.push("Marked missing glyphs from PDF extraction.");
  if (/∫\s*['′′′]+\s*/.test(text) || /∫\s*'\s*'\s*/.test(text)) issues.push("Malformed integral / prime marks — verify against source.");
  if (/(?:\?\([^)]*\)){2,}/.test(text) || /\bp\?\(/.test(text)) issues.push("Suspicious ?(…) tokens — possible OCR or star-notation noise.");

  if (issues.length === 0) return { status: "ok", issues: [] };
  const severe = issues.some(
    (i) =>
      i.includes("Unbalanced") ||
      i.includes("Empty") ||
      i.includes("Missing glyph") ||
      i.includes("missing glyphs"),
  );
  return { status: severe ? "broken" : "needs_check", issues };
}

export function mathStatusFromValidation(result: LatexValidationResult): "ok" | "needs_check" | "broken" {
  if (result.status === "ok") return "ok";
  if (result.status === "broken") return "broken";
  return "needs_check";
}
