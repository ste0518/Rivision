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

  if (issues.length === 0) return { status: "ok", issues: [] };
  const severe = issues.some((i) => i.includes("Unbalanced") || i.includes("Empty"));
  return { status: severe ? "broken" : "needs_check", issues };
}

export function mathStatusFromValidation(result: LatexValidationResult): "ok" | "needs_check" | "broken" {
  if (result.status === "ok") return "ok";
  if (result.status === "broken") return "broken";
  return "needs_check";
}
