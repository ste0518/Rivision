/**
 * Local heuristic extraction for the student-facing Study Pack (no APIs).
 *
 * Pipeline:
 *   1. Parse section headings ("4.1 ..." style) per file.
 *   2. Extract labelled blocks (Definition/Theorem/Proposition/.../Algorithm).
 *   3. Pair Theorem/Proposition/Lemma/Corollary blocks with following "Proof." bodies.
 *   4. Build typed item collections (definitions, formulas, proofs, methods).
 *   5. Pull formulas from raw lines AND from labelled-block central equations.
 *   6. Build the cram sheet from typed items only — never directly from raw blocks.
 */

import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import { convertCommonMathToLatex } from "@/lib/revision-item-utils";
import type {
  DefinitionImportance,
  GeneratedCommonMistake,
  GeneratedCourseTopic,
  GeneratedCramSheet,
  GeneratedDefinitionItem,
  GeneratedFormulaItem,
  GeneratedMethodTemplate,
  GeneratedPastPaperPattern,
  GeneratedProofItem,
  GeneratedRevisionPack,
  StudyPackEntryKind,
  TopicImportance,
} from "@/lib/student-revision-schema";
import type { StudyFileRole } from "@/lib/types";
import { createId } from "@/lib/utils";

/** Mirrors {@link PackSourceFile} without importing revision-pack-generator (avoid circular deps). */
export type LecturePackFile = {
  id: string;
  name: string;
  role?: StudyFileRole;
  parsedText?: string;
};

export type PackGeneratorSettings = {
  revisionStyle: "concise_exam" | "detailed_guide" | "flashcard_heavy" | "problem_heavy";
  aiStrictness: "conservative" | "balanced" | "broad";
};

export type PackItemKind =
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "example"
  | "exercise"
  | "remark"
  | "algorithm"
  | "formula"
  | "proof";

export type ExtractedSection = {
  sectionNumber: string;
  title: string;
  startOffset: number;
};

export type LabelledBlock = {
  kind: PackItemKind;
  formalLabel: string;
  number: string;
  parenTitle?: string;
  displayTitle: string;
  body: string;
  rawBlock: string;
  sourceFile: string;
  sourcePage?: number;
  sourceSection?: string;
  startOffset: number;
  importance: DefinitionImportance;
};

const LABELLED_HEAD = new RegExp(
  [
    "(?:^|\\n)\\s*",
    "(Definition|Theorem|Proposition|Lemma|Corollary|Example|Exercise|Remark|Algorithm)",
    "\\s+",
    "(\\d+(?:\\.\\d+)*)",
    "\\s*",
    "(?:\\(([^)]+)\\))?",
    "\\s*",
    "(?:\\[[^\\]]+\\])?",
    "\\s*",
    "(?:[:.]\\s*)?",
  ].join(""),
  "gim",
);

const PROOF_HEAD = /(?:^|\n)\s*Proof\s*[.:]\s*/gim;

const CORE_IDEA_PLACEHOLDER = /^Core idea\s+\d+$/i;

function pageAtOffset(fullText: string, offset: number): number | undefined {
  let pageNumber: number | undefined;
  for (const match of fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

/** Extract section headings like "4.1 Discrete state space Markov chains" (any case). */
export function extractSectionHeadings(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const leading = line.length - line.trimStart().length;
    const trimmed = line.trim();
    // Accept "4.1", "4.1.2" etc. The title may be lowercase as in PDF text extraction.
    const m = trimmed.match(/^(\d+(?:\.\d+)+)\s+([A-Za-z][^]{1,200})$/);
    if (m) {
      const rest = m[2].trim();
      // Skip lines that are actually labelled blocks (Definition 4.1 ..., etc.).
      if (!/^(definition|theorem|lemma|proposition|corollary|remark|example|proof|algorithm|exercise)\b/i.test(rest)) {
        // Reject super-noisy headings that look like equations or table rows.
        if (!/[=∑∫∏≥≤<>]/.test(rest) && rest.length <= 160) {
          sections.push({
            sectionNumber: m[1],
            title: titleCase(rest.replace(/\s+/g, " ").trim()),
            startOffset: offset + leading,
          });
        }
      }
    }
    offset += line.length + 1;
  }
  return sections;
}

function titleCase(value: string): string {
  // Simple capitalisation for headings like "discrete state space markov chains".
  return value.replace(/\b([a-z])([a-z0-9-]*)/g, (_m, head: string, tail: string) => head.toUpperCase() + tail);
}

function sectionForOffset(sections: ExtractedSection[], offset: number): string | undefined {
  let best: ExtractedSection | undefined;
  for (const s of sections) {
    if (s.startOffset <= offset && (!best || s.startOffset > best.startOffset)) best = s;
  }
  if (!best) return undefined;
  return `${best.sectionNumber} ${best.title}`;
}

function kindFromWord(word: string): PackItemKind {
  const w = word.toLowerCase();
  if (w === "definition") return "definition";
  if (w === "theorem") return "theorem";
  if (w === "proposition") return "proposition";
  if (w === "lemma") return "lemma";
  if (w === "corollary") return "corollary";
  if (w === "example") return "example";
  if (w === "exercise") return "exercise";
  if (w === "remark") return "remark";
  if (w === "algorithm") return "algorithm";
  return "definition";
}

function importanceForKind(kind: PackItemKind): DefinitionImportance {
  if (kind === "definition" || kind === "theorem" || kind === "proposition" || kind === "lemma" || kind === "algorithm") return "must_know";
  if (kind === "corollary" || kind === "example") return "high";
  if (kind === "remark" || kind === "exercise") return "medium";
  return "high";
}

function titleForBlock(kind: PackItemKind, parenTitle: string | undefined, body: string): string {
  if (parenTitle?.trim()) return parenTitle.trim().replace(/\s+/g, " ");
  // Take first line up to ~140 chars for prose blocks.
  const firstLine = body.replace(/^\s+/, "").split(/\n/)[0] ?? body;
  const cleaned = firstLine.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 8 && cleaned.length < 160) return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
  return `${kind} statement`;
}

function extractLabelledBlocks(fullText: string, sourceFile: string, sections: ExtractedSection[]): LabelledBlock[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const hits: Array<{ index: number; headerLen: number; kind: string; number: string; paren?: string }> = [];
  LABELLED_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABELLED_HEAD.exec(text)) !== null) {
    hits.push({
      index: m.index,
      headerLen: m[0].length,
      kind: m[1] ?? "",
      number: m[2] ?? "",
      paren: m[3]?.trim(),
    });
  }

  const blocks: LabelledBlock[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const cur = hits[i]!;
    const next = hits[i + 1];
    const bodyStart = cur.index + cur.headerLen;
    const end = next ? next.index : text.length;
    const rawBlock = text.slice(cur.index, end).trim();
    const body = text.slice(bodyStart, end).trim();
    if (body.length < 8 && rawBlock.length < 15) continue;

    const kind = kindFromWord(cur.kind);
    const formalLabel = `${capitalize(cur.kind)} ${cur.number}`;
    const displayTitle = titleForBlock(kind, cur.paren, body);
    const offset = cur.index;
    blocks.push({
      kind,
      formalLabel,
      number: cur.number,
      parenTitle: cur.paren,
      displayTitle,
      body,
      rawBlock,
      sourceFile,
      sourcePage: pageAtOffset(text, offset),
      sourceSection: sectionForOffset(sections, offset),
      startOffset: offset,
      importance: importanceForKind(kind),
    });
  }
  return blocks;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function extractProofBlocks(fullText: string, sourceFile: string, sections: ExtractedSection[]): LabelledBlock[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const out: LabelledBlock[] = [];
  PROOF_HEAD.lastIndex = 0;
  let pm: RegExpExecArray | null;
  const proofMatches: Array<{ start: number; contentStart: number }> = [];
  while ((pm = PROOF_HEAD.exec(text)) !== null) {
    const contentStart = pm.index + pm[0].length;
    proofMatches.push({ start: pm.index, contentStart });
  }
  // Stop a proof body when the next labelled head is encountered, not just the next Proof.
  const labelledStarts: number[] = [];
  LABELLED_HEAD.lastIndex = 0;
  let lm: RegExpExecArray | null;
  while ((lm = LABELLED_HEAD.exec(text)) !== null) labelledStarts.push(lm.index);

  for (let i = 0; i < proofMatches.length; i += 1) {
    const cur = proofMatches[i]!;
    const nextProof = proofMatches[i + 1]?.start ?? text.length;
    const nextLabelled = labelledStarts.find((idx) => idx > cur.contentStart) ?? text.length;
    const after = Math.min(nextProof, nextLabelled);
    const body = text.slice(cur.contentStart, after).trim();
    if (body.length < 15) continue;
    out.push({
      kind: "proof",
      formalLabel: "Proof",
      number: "",
      displayTitle: `Proof (p. ${pageAtOffset(text, cur.start) ?? "—"})`,
      body,
      rawBlock: text.slice(cur.start, after).trim(),
      sourceFile,
      sourcePage: pageAtOffset(text, cur.start),
      sourceSection: sectionForOffset(sections, cur.start),
      startOffset: cur.start,
      importance: "high",
    });
  }
  return out;
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(
    a
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const tb = new Set(
    b
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function normalizeTitleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(theorem|definition|proposition|lemma|corollary|remark|example)\b/g, "")
    .trim();
}

export function dedupeLabelledBlocks(blocks: LabelledBlock[]): LabelledBlock[] {
  const byKey = new Map<string, LabelledBlock>();
  for (const b of blocks) {
    const key =
      b.kind === "proof"
        ? `proof|${b.sourceFile}|${b.startOffset}`
        : `${b.sourceFile}|${b.formalLabel}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || scoreBlock(b) > scoreBlock(prev)) byKey.set(key, b);
  }
  const merged = Array.from(byKey.values());
  const final: LabelledBlock[] = [];
  for (const b of merged) {
    const dupIdx = final.findIndex(
      (e) =>
        e.kind === b.kind &&
        normalizeTitleKey(e.displayTitle) === normalizeTitleKey(b.displayTitle) &&
        normalizeTitleKey(b.displayTitle).length > 6 &&
        jaccardSimilarity(e.body, b.body) > 0.72,
    );
    if (dupIdx >= 0) {
      if (scoreBlock(b) > scoreBlock(final[dupIdx]!)) final[dupIdx] = b;
      continue;
    }
    const nearIdx = final.findIndex((e) => e.kind === b.kind && jaccardSimilarity(e.body, b.body) > 0.9);
    if (nearIdx >= 0) {
      if (scoreBlock(b) > scoreBlock(final[nearIdx]!)) final[nearIdx] = b;
      continue;
    }
    final.push(b);
  }
  return final;
}

function scoreBlock(b: LabelledBlock): number {
  let s = b.body.length;
  if (b.importance === "must_know") s += 200;
  if (b.formalLabel && b.formalLabel !== "Proof") s += 100;
  if (b.parenTitle) s += 50;
  return s;
}

/** PDF / OCR cleanup for math-heavy notes; conservative — formatting only. */
export function normalizeMathText(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = t.replace(/\uFFFE|\u0000/g, "");
  t = t.replace(/\\\(\s*\\\(/g, "\\(").replace(/\\\)\s*\\\)/g, "\\)");
  t = t.replace(/\\?\(([^)]*)\\?\)\s*\)\s*n\s*([≥≥>=])\s*0/gi, (_, inner: string, rel: string) => {
    const ge = rel.includes(">") ? "\\ge 0" : rel;
    return `\\( (${inner.trim()})_{n ${ge}} \\)`;
  });
  t = t.replace(/\(\s*X\s*_?\s*n\s*\)\s*\)\s*n\s*[≥>=]\s*0/gi, "\\( (X_n)_{n \\ge 0} \\)");
  t = t.replace(/\(X\s*n\)\s*n\s*[≥>=]\s*0/gi, "\\( (X_n)_{n \\ge 0} \\)");
  t = t.replace(/\bM\s*_?\s*ij\b/gi, "\\( M_{ij} \\)");
  t = t.replace(/\bM\s*_?\s*ji\b/gi, "\\( M_{ji} \\)");
  t = t.replace(/\bp\s*_?\s*n\b(?![a-z])/gi, "\\( p_n \\)");
  t = t.replace(/\bp\s*\(\s*0\b/gi, "\\( p_0 \\)");
  t = t.replace(/\bx\s*_?\s*0\b/gi, "\\( x_0 \\)");
  t = t.replace(/\bn\s*[≥≥]\s*0\b/g, "\\( n \\ge 0 \\)");
  t = t.replace(/∑\s*_?\s*j\s*=\s*1\s*\^?\s*d/gi, "\\( \\sum_{j=1}^d \\)");
  t = t.replace(/Pd\s+j\s*=\s*1/gi, "\\( \\sum_{j=1}^d \\)");
  t = t.replace(/\bp\?\b/g, "\\( p^\\star \\)");
  t = t.replace(/\bp\*\(/g, "\\( p^\\star(");
  const ctx = `${t} markov metropolis gibbs chain transition detailed balance mcmc`;
  const profile =
    /\b(markov|mcmc|metropolis|gibbs|transition matrix|detailed balance|invariant|kernel)\b/i.test(ctx) ? "monte_carlo_sampling" : "generic";
  return convertCommonMathToLatex(t, profile, ctx);
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

const FORMULA_LIKE = /[=∑∫]|\\sum|\\int|\\propto|∝|\\\(|\$|\\frac|\\mathbb\{P\}|M\^\{|M\^|p\^\*|p_n|K\(|\bsum\b|\bmin\b|\balpha\b|q\(/i;

const FORMULA_SECONDARY = /[=]|\\sum|\\int|∑|∫|∝|\\\\propto|conditional|\\mathbb\{P\}|M_\{|M\^|p_n|p\^\*|K\(|q\(|\bP\(|\br\(x|\bMij\b/i;

function looksLikeFormula(line: string): boolean {
  if (line.length < 6 || line.length > 500) return false;
  if (!FORMULA_LIKE.test(line)) return false;
  if (!FORMULA_SECONDARY.test(line)) return false;
  // Reject continuation fragments that start with "=" (no LHS).
  if (/^[=≤≥<>+\-]/.test(line.trim())) return false;
  // Reject lines that contain runs of dots from PDF rendering (e.g. "M = ........" or "M = .. .. . .").
  if (/\.{4,}/.test(line)) return false;
  if ((line.match(/\.{2,}/g)?.length ?? 0) >= 3) return false;
  // Reject lines that are mostly punctuation/dots after the first '=' (rendered ASCII matrices).
  const afterEq = line.split("=").slice(1).join("=");
  if (afterEq && afterEq.replace(/[\s.0-9·,]/g, "").length === 0) return false;
  // Reject lines that are clearly numeric table rows (>=3 decimal numbers separated by spaces).
  const decimalRunMatches = line.match(/(?:^|\s)\d+\.\d+(?:\s+\d+\.\d+){2,}/);
  if (decimalRunMatches) return false;
  // Reject lines that are stand-alone matrix-entry rows like "Xt-1 = 1 0.6 0.2 0.2".
  if (/^[A-Za-z][\w−\-]*\s*=\s*\d+(\s+\d+(\.\d+)?){2,}$/.test(line.trim())) return false;
  // Reject step lines like "2: for n = 1,..." (these belong to algorithms, not the formula tab).
  if (/^\d+\s*:\s+/.test(line.trim())) return false;
  // Reject English prose lines that incidentally contain "=".
  const wordCount = line.split(/\s+/).length;
  const symbolDensity = (line.match(/[=∑∫∝<>≥≤_^|]/g) ?? []).length / Math.max(1, wordCount);
  if (wordCount > 10 && symbolDensity < 0.18) return false;
  // Reject lines that contain a long run of natural-English words before any math symbol.
  const proseRun = line.match(/^[A-Z]?[a-z]+(?:\s+[a-z]+){5,}/);
  if (proseRun && proseRun[0].length / line.length > 0.55) return false;
  // Reject lines that are dominated by free prose with a single trailing reference like "(4.2)".
  if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(line) && wordCount > 10) {
    const mathSpan = (line.match(/[=∑∫∝<>≥≤_^|]/g) ?? []).length;
    if (mathSpan < 2) return false;
  }
  return true;
}

/** Wrap raw LaTeX in `\(...\)` so MathMarkdown picks it up as math. */
function wrapAsMath(latex: string): string {
  const trimmed = latex.trim();
  if (!trimmed) return trimmed;
  if (/\\\(|\\\[|\$/.test(trimmed)) return trimmed;
  return `\\[ ${trimmed} \\]`;
}

/** Specific patterns we want to surface even when the parsed PDF text is messy. */
const FORMULA_PATTERNS: Array<{ name: string; matcher: RegExp; latex: string; whenToUse: string }> = [
  {
    name: "Transition matrix entries",
    matcher: /\bMij\s*=\s*P\(\s*Xn\+1\s*=\s*j[\s\S]{0,40}Xn\s*=\s*i\s*\)|\bMij\s*=\s*P\(/i,
    latex: "M_{ij} = \\Pr(X_{n+1}=j \\mid X_n=i)",
    whenToUse: "Definition of the one-step transition matrix.",
  },
  {
    name: "Row stochasticity of M",
    matcher: /\bsum.{0,8}j\s*=\s*1[^\n]{0,20}Mij\s*=\s*1|∑[^\n]{0,30}Mij\s*=\s*1/i,
    latex: "\\sum_{j=1}^d M_{ij} = 1",
    whenToUse: "Each row of a stochastic transition matrix sums to 1.",
  },
  {
    name: "n-step transition (matrix power)",
    matcher: /M\s*\(\s*n\s*\)\s*=\s*M\s*n\b|M\^\{?\(n\)\}?\s*=\s*M\^n/i,
    latex: "M^{(n)} = M^n",
    whenToUse: "n-step transition matrix as the n-th matrix power of M.",
  },
  {
    name: "Chapman–Kolmogorov",
    matcher: /M\s*\(\s*m\+n\s*\)\s*=\s*M\s*\(\s*m\s*\)\s*M\s*\(\s*n\s*\)/i,
    latex: "M^{(m+n)} = M^{(m)} M^{(n)}",
    whenToUse: "Chapman–Kolmogorov equation for transition matrices.",
  },
  {
    name: "Distribution one-step evolution",
    matcher: /\bp\s*n\s*=\s*p\s*n\s*-?\s*1\s*M\b|\bpn\s*=\s*pn-1M\b/i,
    latex: "p_n = p_{n-1} M",
    whenToUse: "One-step evolution of the marginal distribution under M.",
  },
  {
    name: "Distribution n-step evolution",
    matcher: /\bp\s*n\s*=\s*p\s*0\s*M\s*n\b|\bpn\s*=\s*p0Mn\b/i,
    latex: "p_n = p_0 M^n",
    whenToUse: "Marginal at step n via n-th matrix power.",
  },
  {
    name: "Detailed balance (discrete)",
    matcher: /p\?\(\s*i\s*\)\s*Mij\s*=\s*p\?\(\s*j\s*\)\s*Mji|p\^\*\(i\)\s*M_\{ij\}\s*=\s*p\^\*\(j\)\s*M_\{ji\}/i,
    latex: "p^\\star(i) M_{ij} = p^\\star(j) M_{ji}",
    whenToUse: "Discrete detailed-balance condition implies stationarity.",
  },
  {
    name: "K-invariance (continuous)",
    matcher: /p\?\(\s*x\s*\)\s*=\s*\\?int|p\?\(x\)\s*=[\s\S]{0,30}K\(\s*x\s*\|\s*x['′]/i,
    latex: "p^\\star(x) = \\int_X K(x \\mid x') p^\\star(x') \\, dx'",
    whenToUse: "Continuous-state K-invariance / stationarity equation.",
  },
  {
    name: "Detailed balance (continuous)",
    matcher: /K\(\s*x['′]\s*\|\s*x\s*\)\s*p\?\(\s*x\s*\)\s*=\s*K\(\s*x\s*\|\s*x['′]\s*\)\s*p\?\(\s*x['′]\s*\)/i,
    latex: "K(x' \\mid x) p^\\star(x) = K(x \\mid x') p^\\star(x')",
    whenToUse: "Continuous-state detailed-balance condition.",
  },
  {
    name: "Metropolis–Hastings acceptance ratio",
    matcher: /r\(\s*x\s*,\s*x['′]\s*\)\s*=\s*p\?\(\s*x['′]\s*\)\s*q\(\s*x\s*\|\s*x['′]\s*\)|p\?\(x['′]\)q\(x\|x['′]\)/i,
    latex: "r(x, x') = \\dfrac{p^\\star(x') \\, q(x \\mid x')}{p^\\star(x) \\, q(x' \\mid x)}",
    whenToUse: "Metropolis–Hastings ratio. Accept with probability min(1, r).",
  },
  {
    name: "MH acceptance probability",
    matcher: /\balpha\s*\(.{0,40}\)\s*=\s*min\s*\{?\s*1\s*,|min\s*\{\s*1,\s*p\?\(/i,
    latex: "\\alpha(x, x') = \\min\\!\\left\\{1, \\, r(x, x')\\right\\}",
    whenToUse: "MH acceptance probability cap at 1.",
  },
  {
    name: "MALA / Langevin proposal",
    matcher: /q\(\s*x['′]?\s*\|\s*x\s*\)\s*=\s*N\s*\([^)]*\bgamma\b|N\s*\(\s*x['′]\s*;\s*x\s*\+\s*\\?γ?gamma?\s*\\?nabla?∇?\s*log/i,
    latex: "q(x' \\mid x) = \\mathcal{N}\\!\\left(x';\\, x + \\gamma \\nabla \\log p^\\star(x),\\, 2\\gamma I\\right)",
    whenToUse: "MALA proposal centred on a gradient ascent step on log-target.",
  },
];

function extractCanonicalFormulas(text: string, sourceFile: string, sections: ExtractedSection[]): GeneratedFormulaItem[] {
  const out: GeneratedFormulaItem[] = [];
  for (const pat of FORMULA_PATTERNS) {
    pat.matcher.lastIndex = 0;
    const m = pat.matcher.exec(text);
    if (!m) continue;
    const offset = m.index;
    const v = validateLatexSnippet(`\\(${pat.latex}\\)`);
    out.push({
      id: createId("form"),
      name: pat.name,
      latex: wrapAsMath(pat.latex),
      whenToUse: pat.whenToUse,
      source: sourceFile,
      sourceFile,
      sourceSection: sectionForOffset(sections, offset),
      sourcePage: pageAtOffset(text, offset),
      sourceExcerpt: text.slice(Math.max(0, offset - 40), offset + 200).slice(0, 420),
      mathStatus: mathStatusFromValidation(v),
    });
  }
  return out;
}

function extractFormulaLines(text: string, sourceFile: string, sections: ExtractedSection[]): GeneratedFormulaItem[] {
  const lines = text.split("\n");
  let offset = 0;
  const out: GeneratedFormulaItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!looksLikeFormula(trimmed)) {
      offset += line.length + 1;
      continue;
    }
    const normalized = normalizeMathText(trimmed);
    const sig = normalized.replace(/\s+/g, " ").slice(0, 160).toLowerCase();
    if (seen.has(sig)) {
      offset += line.length + 1;
      continue;
    }
    seen.add(sig);
    const v = validateLatexSnippet(normalized);
    const nameGuess = trimmed.match(/^([^=:{]+)[:=]/);
    const name = nameGuess ? nameGuess[1]!.trim().slice(0, 72) : `Relation near “${trimmed.slice(0, 40)}…”`;
    out.push({
      id: createId("form"),
      name: name.replace(/\s+/g, " "),
      latex: wrapAsMath(normalized),
      whenToUse: "Use when revising transition kernels, balance conditions, or acceptance ratios.",
      source: sourceFile,
      sourceFile,
      sourceSection: sectionForOffset(sections, offset),
      sourcePage: pageAtOffset(text, offset),
      sourceExcerpt: trimmed.slice(0, 420),
      mathStatus: mathStatusFromValidation(v),
    });
    offset += line.length + 1;
  }
  return out;
}

function dedupeFormulas(items: GeneratedFormulaItem[]): GeneratedFormulaItem[] {
  const out: GeneratedFormulaItem[] = [];
  for (const f of items) {
    const sig = f.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase();
    if (out.some((x) => x.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase() === sig)) continue;
    if (out.some((x) => jaccardSimilarity(x.latex, f.latex) > 0.92)) continue;
    out.push(f);
  }
  return out.slice(0, 40);
}

// ---------------------------------------------------------------------------
// Definitions, proofs, methods
// ---------------------------------------------------------------------------

function blocksToDefinitions(blocks: LabelledBlock[]): GeneratedDefinitionItem[] {
  // Strict: only true definitions belong in the Definitions tab.
  return blocks
    .filter((b) => b.kind === "definition")
    .map((b) => {
      const defText = normalizeMathText(b.body.slice(0, 3500));
      const snippet = defText.slice(0, 700);
      const v = validateLatexSnippet(snippet);
      return {
        id: createId("def"),
        term: b.displayTitle,
        definition: defText,
        source: b.sourceFile,
        sourceFile: b.sourceFile,
        sourcePage: b.sourcePage,
        sourceSection: b.sourceSection,
        sourceLabel: b.formalLabel,
        sourceExcerpt: b.rawBlock.slice(0, 900),
        formalLabel: b.formalLabel,
        itemKind: b.kind as StudyPackEntryKind,
        importance: b.importance,
        mathStatus: mathStatusFromValidation(v),
      };
    });
}

function proofSkeletonFromBody(title: string, body: string): { skeleton: string; mistake: string } {
  const lower = `${title} ${body}`.toLowerCase();
  if (lower.includes("detailed balance") && (lower.includes("stationar") || lower.includes("invariant"))) {
    return {
      skeleton: "Assume detailed balance K(x'|x)p*(x)=K(x|x')p*(x') → integrate both sides over x' → use that K(·|x) integrates to 1 → conclude p*(x) = ∫ K(x|x')p*(x')dx', i.e. K-invariance.",
      mistake: "Forgetting that K(·|x) integrates to 1 (in the discrete case Σ_j Mij = 1) when collapsing the integral.",
    };
  }
  if (lower.includes("metropolis") && (lower.includes("detailed balance") || lower.includes("accept"))) {
    return {
      skeleton: "Write MH kernel K(x'|x) = α(x,x')q(x'|x) + (1-a(x))δx(x'). Multiply by p*(x). For the proposal term, expand α = min{1, p*(x')q(x|x')/[p*(x)q(x'|x)]} and use min{a,b}·a = min{ab,b·a}=min{c,d}·b form to swap (x,x') → (x',x). Dirac term is symmetric in (x,x'). Conclude p*(x)K(x'|x)=p*(x')K(x|x').",
      mistake: "Using the wrong conditional order in q(x'|x) vs q(x|x') in the ratio, or forgetting the rejection (Dirac) term contributes symmetrically.",
    };
  }
  if (lower.includes("gibbs") && (lower.includes("invariant") || lower.includes("kernel") || lower.includes("conditional"))) {
    return {
      skeleton: "Each Gibbs sweep updates one block from its full conditional p*(x_k | x_{-k}). Show that p* is invariant under one such update by integrating over the updated coordinate. Compose updates: each leaves p* invariant, so the sweep does too.",
      mistake: "Assuming the random/systematic scan order does not matter without verifying invariance per update; ignoring reducibility on disconnected supports.",
    };
  }
  if (lower.includes("chapman") || (lower.includes("m^n") || /m\s*\(\s*n\s*\)\s*=\s*m\s*n/.test(lower))) {
    return {
      skeleton: "Condition on Xn at intermediate time → apply Markov property → recognise sum/integral as matrix/kernel product → induct to obtain M^{(n)} = M^n.",
      mistake: "Conditioning incorrectly (Markov property requires conditioning on the most recent state).",
    };
  }
  return {
    skeleton: "State assumptions → expand definitions → algebraic manipulation → conclude.",
    mistake: "Skipping hypotheses (irreducibility, aperiodicity, positivity) when invoking limit theorems.",
  };
}

/** Build proof items from theorem/proposition/lemma/corollary blocks plus paired Proof bodies. */
function blocksToProofs(blocks: LabelledBlock[], proofBlocks: LabelledBlock[]): GeneratedProofItem[] {
  const STMT_KINDS: PackItemKind[] = ["theorem", "proposition", "lemma", "corollary"];
  const stmtBlocks = blocks.filter((b) => STMT_KINDS.includes(b.kind));

  const items: GeneratedProofItem[] = [];

  for (const b of stmtBlocks) {
    // Find the closest proof in the same file that comes after this block.
    const proof = proofBlocks
      .filter((p) => p.sourceFile === b.sourceFile && p.startOffset > b.startOffset)
      .sort((a, c) => a.startOffset - c.startOffset)[0];

    const heading = `${b.formalLabel}: ${b.displayTitle}`;
    const { skeleton, mistake } = proofSkeletonFromBody(b.displayTitle, `${b.body}\n${proof?.body ?? ""}`);
    // Strip any "Proof." section that may have been included in the proposition body.
    const statementOnly = b.body.split(/(?:^|\n)\s*Proof\s*[.:]/i)[0]!.trim();
    items.push({
      id: createId("prf"),
      name: heading,
      proofName: heading,
      statement: normalizeMathText(statementOnly.slice(0, 1500)),
      proofSkeleton: proof ? `Proof outline: ${normalizeMathText(proof.body.slice(0, 800))}\n\nKey idea: ${skeleton}` : skeleton,
      commonMistake: mistake,
      source: b.sourceFile,
      sourceFile: b.sourceFile,
      sourcePage: b.sourcePage,
      sourceSection: b.sourceSection,
      sourceLabel: b.formalLabel,
      sourceExcerpt: b.rawBlock.slice(0, 900),
    });
  }

  // Also surface any orphan proofs (those not paired with a statement block).
  const usedProofOffsets = new Set<number>();
  for (const b of stmtBlocks) {
    const proof = proofBlocks
      .filter((p) => p.sourceFile === b.sourceFile && p.startOffset > b.startOffset)
      .sort((a, c) => a.startOffset - c.startOffset)[0];
    if (proof) usedProofOffsets.add(proof.startOffset);
  }
  for (const p of proofBlocks) {
    if (usedProofOffsets.has(p.startOffset)) continue;
    const { skeleton, mistake } = proofSkeletonFromBody(p.displayTitle, p.body);
    const heading = p.sourceSection ? `Proof · ${p.sourceSection}` : p.sourcePage != null ? `Proof (p. ${p.sourcePage})` : "Proof from notes";
    items.push({
      id: createId("prf"),
      name: heading,
      proofName: heading,
      statement: normalizeMathText(p.body.slice(0, 1200)),
      proofSkeleton: skeleton,
      commonMistake: mistake,
      source: p.sourceFile,
      sourceFile: p.sourceFile,
      sourcePage: p.sourcePage,
      sourceSection: p.sourceSection,
      sourceLabel: p.formalLabel,
      sourceExcerpt: p.rawBlock.slice(0, 900),
    });
  }

  return items;
}

/** Clean up algorithm titles like "Algorithm 9 Pseudocode for Metropolis Hastings method". */
function cleanAlgorithmTitle(rawHeading: string): string {
  let t = rawHeading.replace(/^\s+/, "");
  t = t.split(/\n\s*\d+\s*[:.]/)[0]!;
  t = t.split(/\n/)[0]!;
  t = t.replace(/^pseudocode\s+for\s+/i, "");
  t = t.replace(/^algorithm\s+\d+\s*[:.]?\s*/i, "");
  t = t.replace(/\bmetropolis\s+hastings\b/gi, "Metropolis–Hastings");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) t = "Algorithm";
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

/** Split algorithm body into ordered numbered steps. */
function cleanAlgorithmSteps(body: string): string[] {
  const text = body.replace(/\r\n/g, "\n");
  // Find positions of step markers like "1:", "2:", at line start (with leading whitespace allowed).
  const stepRe = /(?:^|\n)\s*(\d+)\s*[:.]\s+/g;
  const matches: Array<{ index: number; match: string; step: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(text)) !== null) {
    matches.push({ index: m.index, match: m[0], step: Number(m[1]) });
  }
  if (matches.length < 2) {
    // Fallback: split on sentences.
    return body
      .split(/(?:\n|;|\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8)
      .slice(0, 12);
  }
  const steps: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i]!.index + matches[i]!.match.length;
    const end = matches[i + 1]?.index ?? text.length;
    let raw = text.slice(start, end);
    if (i === matches.length - 1) {
      // Last step has no following step marker; cap at paragraph break or first sentence
      // to avoid absorbing trailing prose that follows the algorithm body.
      const breakIdx = raw.search(/\n\s*\n/);
      if (breakIdx > 20) raw = raw.slice(0, breakIdx);
      const periodIdx = raw.search(/\.\s+[A-Z]/);
      if (periodIdx > 20) raw = raw.slice(0, periodIdx + 1);
    }
    const stepText = raw.replace(/\s+/g, " ").trim();
    if (stepText) steps.push(stepText);
  }
  return steps.slice(0, 16);
}

function algorithmBlocksToMethods(blocks: LabelledBlock[]): GeneratedMethodTemplate[] {
  const algos = blocks.filter((b) => b.kind === "algorithm");
  const methods: GeneratedMethodTemplate[] = algos.map((b) => {
    const cleanTitle = b.parenTitle?.trim() && b.parenTitle.trim().length > 3
      ? b.parenTitle.trim()
      : cleanAlgorithmTitle(b.body);
    const steps = cleanAlgorithmSteps(b.body).map((s) => normalizeMathText(s));
    return {
      id: createId("meth"),
      problemType: `${b.formalLabel}: ${cleanTitle}`,
      steps,
      triggerWords: [cleanTitle, "MCMC", "Metropolis", "Gibbs"].filter(Boolean),
      relatedPracticeType: "Exam-style algorithm recall",
    };
  });

  const textBlob = blocks.map((b) => b.body).join("\n").toLowerCase();
  const extras: Array<{ title: string; steps: string[]; triggers: string[] }> = [
    {
      title: "Simulate a discrete Markov chain",
      steps: [
        "Choose initial state X0 from p0 or fixed state.",
        "For each step, sample next state from row Xn of transition matrix M.",
        "Repeat to obtain a path; optionally discard burn-in for Monte Carlo averages.",
      ],
      triggers: ["transition matrix", "discrete", "markov chain"],
    },
    {
      title: "Compute n-step transition probabilities",
      steps: ["Identify one-step kernel M.", "Use M(n)=Mn for discrete time homogeneous chains.", "For probabilities, track pn=p0Mn."],
      triggers: ["m^n", "chapman", "transition"],
    },
    {
      title: "Verify an invariant distribution",
      steps: ["Candidate π — check πM=π row-wise.", "Or integrate π(x')K(x|x')dx'=π(x) for continuous state.", "Confirm positivity/normalisation."],
      triggers: ["invariant", "stationary"],
    },
    {
      title: "Use detailed balance",
      steps: ["Write π(i)Mij=π(j)Mji or continuous analogue.", "Conclude π is invariant.", "Note: DB ⇒ stationarity but not always necessary."],
      triggers: ["detailed balance"],
    },
    {
      title: "Derive a Gibbs sampler from full conditionals",
      steps: ["Write full conditional distributions.", "Cycle updates (systematic or random scan).", "Each update leaves π invariant — verify using conditional detail."],
      triggers: ["gibbs", "full conditional"],
    },
  ];

  for (const ex of extras) {
    if (!ex.triggers.some((t) => textBlob.includes(t))) continue;
    if (methods.some((m) => m.problemType.toLowerCase().includes(ex.title.slice(0, 12).toLowerCase()))) continue;
    methods.push({
      id: createId("meth"),
      problemType: ex.title,
      steps: ex.steps,
      triggerWords: ex.triggers,
      relatedPracticeType: "Timed derivation / algorithm outline",
    });
  }
  return methods.slice(0, 14);
}

// ---------------------------------------------------------------------------
// Course map
// ---------------------------------------------------------------------------

function courseTopicsFromSections(files: LecturePackFile[], lectureText: string): GeneratedCourseTopic[] {
  const sections = extractSectionHeadings(lectureText);
  if (sections.length) {
    // Prefer top-level sections (X.Y) for the Course Map; nested X.Y.Z stay as evidence.
    const topLevel = sections.filter((s) => s.sectionNumber.split(".").length === 2);
    const chosen = topLevel.length ? topLevel : sections;
    return chosen.map((s) => ({
      id: createId("topic"),
      title: `${s.sectionNumber} ${s.title}`,
      sourceFileNames: files.filter((f) => f.role === "lecture_notes" || !f.role).map((f) => f.name),
      importance: "high" as TopicImportance,
      evidenceReason: "Detected numbered section heading in lecture text.",
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// Pack assembly
// ---------------------------------------------------------------------------

export type HeuristicPackContext = {
  files: LecturePackFile[];
  settings: PackGeneratorSettings;
  combinedLectureText: string;
  hasPastEvidence: boolean;
};

/** Build structured study pack from parsed file text using local rules. */
export function buildHeuristicStudentRevisionPack(ctx: HeuristicPackContext): GeneratedRevisionPack {
  const { files, settings, combinedLectureText, hasPastEvidence } = ctx;
  const lectureFiles = files.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const primaryName = lectureFiles[0]?.name ?? files[0]?.name ?? "your materials";
  const sections = extractSectionHeadings(combinedLectureText);

  const allBlocks: LabelledBlock[] = [];
  const allProofBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const t = f.parsedText ?? "";
    if (!t.trim()) continue;
    allBlocks.push(...extractLabelledBlocks(t, f.name, sections));
    allProofBlocks.push(...extractProofBlocks(t, f.name, sections));
  }
  const blocks = dedupeLabelledBlocks(allBlocks);
  const proofBlocks = dedupeLabelledBlocks(allProofBlocks);

  let definitions = blocksToDefinitions(blocks);
  definitions = dedupeDefinitions(definitions);

  const cleanText = combinedLectureText.replace(/\r\n/g, "\n");
  const lineFormulas = extractFormulaLines(cleanText, primaryName, sections);
  const canonicalFormulas = extractCanonicalFormulas(cleanText, primaryName, sections);
  const blockFormulas = extractFormulasFromBlocks(blocks, primaryName);
  const formulas = dedupeFormulas([...canonicalFormulas, ...blockFormulas, ...lineFormulas]).map((f) => {
    const v = validateLatexSnippet(f.latex);
    return { ...f, mathStatus: mathStatusFromValidation(v) };
  });

  let proofs = blocksToProofs(blocks, proofBlocks);
  proofs = dedupeProofs(proofs);

  const methods = algorithmBlocksToMethods(blocks);

  const chapterTitle =
    combinedLectureText.split("\n").map((l) => l.trim()).find((l) => /markov|monte carlo|mcmc/i.test(l) && l.length < 120) ??
    files.find((f) => f.role === "lecture_notes")?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

  let courseMap = courseTopicsFromSections(files, combinedLectureText);
  if (!courseMap.length) {
    courseMap = guessTopicsFallback(files);
  }

  const mistakes: GeneratedCommonMistake[] = [
    {
      id: createId("mis"),
      mistake: "Confusing stationarity with detailed balance",
      whyItHappens: "Detailed balance is sufficient but not necessary for π.",
      howToAvoid: "When checking invariance, verify πK=π directly if detailed balance is unclear.",
    },
    {
      id: createId("mis"),
      mistake: "Wrong proposal direction in MH ratio",
      whyItHappens: "Asymmetric proposals need q(x′|x) and q(x|x′) consistently.",
      howToAvoid: "Write the ratio before cancelling terms; track conditioning carefully.",
    },
  ];

  const patterns = buildPastPaperPatterns(hasPastEvidence, settings);

  const cram: GeneratedCramSheet = {
    definitionBullets: definitions.slice(0, 10).map((d) => `${d.formalLabel ?? d.term}: ${d.definition.slice(0, 100)}${d.definition.length > 100 ? "…" : ""}`),
    formulaBullets: formulas.slice(0, 10).map((f) => `${f.name}: ${f.latex}`),
    proofSkeletonBullets: proofs.slice(0, 8).map((p) => `${p.name}: ${p.proofSkeleton.split("\n")[0]!.slice(0, 200)}`),
    trapBullets: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const overview = {
    courseName: chapterTitle,
    summary: `Structured locally from ${files.length} file(s): ${definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term)).length} definitions · ${formulas.length} formulas · ${proofs.length} proofs · ${methods.length} methods.`,
    likelyExamStructure: hasPastEvidence
      ? "Past/problem-sheet evidence present — cross-check emphasis against these notes."
      : "Lecture-only snapshot: definitions, algorithms, and balance conditions — add past papers to estimate exam weighting.",
    highPriorityTopics: courseMap.filter((t) => t.importance === "high").map((t) => t.title).slice(0, 10),
  };

  return {
    generatedAt: new Date().toISOString(),
    examOverview: overview,
    courseMap,
    definitions,
    formulas,
    proofs,
    methods,
    pastPaperPatterns: patterns,
    commonMistakes: mistakes,
    cramSheet: cram,
  };
}

/**
 * Pull central equations out of labelled blocks (Definition/Theorem/Proposition/Algorithm).
 * Anchors formulas to their formal label so traceability is preserved.
 */
function extractFormulasFromBlocks(blocks: LabelledBlock[], primarySource: string): GeneratedFormulaItem[] {
  const out: GeneratedFormulaItem[] = [];
  const include: PackItemKind[] = ["definition", "theorem", "proposition", "lemma", "algorithm"];
  for (const b of blocks) {
    if (!include.includes(b.kind)) continue;
    const lines = b.body.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!looksLikeFormula(line)) continue;
      const normalized = normalizeMathText(line).slice(0, 400);
      const v = validateLatexSnippet(normalized);
      out.push({
        id: createId("form"),
        name: `${b.formalLabel}${b.parenTitle ? ` (${b.parenTitle})` : ""}`,
        latex: wrapAsMath(normalized),
        whenToUse: `Central equation from ${b.formalLabel}.`,
        source: b.sourceFile || primarySource,
        sourceFile: b.sourceFile || primarySource,
        sourceSection: b.sourceSection,
        sourcePage: b.sourcePage,
        sourceLabel: b.formalLabel,
        sourceExcerpt: line.slice(0, 420),
        mathStatus: mathStatusFromValidation(v),
      });
      // Only the first equation per block as the "central" one; the rest will be picked up by line scanning.
      break;
    }
  }
  return out;
}

function dedupeDefinitions(items: GeneratedDefinitionItem[]): GeneratedDefinitionItem[] {
  const out: GeneratedDefinitionItem[] = [];
  for (const d of items) {
    const dupIdx = out.findIndex(
      (x) =>
        (Boolean(d.sourceLabel) && x.sourceLabel === d.sourceLabel) ||
        (normalizeTitleKey(x.term) === normalizeTitleKey(d.term) && normalizeTitleKey(d.term).length > 4),
    );
    if (dupIdx >= 0) {
      const prev = out[dupIdx]!;
      if ((d.definition?.length ?? 0) > (prev.definition?.length ?? 0)) out[dupIdx] = d;
      continue;
    }
    out.push(d);
  }
  return out;
}

function dedupeProofs(items: GeneratedProofItem[]): GeneratedProofItem[] {
  const out: GeneratedProofItem[] = [];
  for (const p of items) {
    if (out.some((x) => (x.sourceLabel && x.sourceLabel === p.sourceLabel) || jaccardSimilarity(x.statement, p.statement) > 0.85)) continue;
    out.push(p);
  }
  return out.slice(0, 16);
}

function guessTopicsFallback(files: LecturePackFile[]): GeneratedCourseTopic[] {
  const byStem = new Map<string, { names: string[]; roles: Set<StudyFileRole | undefined> }>();
  for (const file of files) {
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60);
    const cur = byStem.get(stem) ?? { names: [], roles: new Set() };
    cur.names.push(file.name);
    cur.roles.add(file.role);
    byStem.set(stem, cur);
  }
  const topics: GeneratedCourseTopic[] = [];
  for (const [title, { names, roles }] of byStem) {
    const lectureHit = roles.has("lecture_notes");
    let importance: TopicImportance = "medium";
    let evidenceReason = "Inferred from uploaded filenames.";
    if (lectureHit) {
      importance = "high";
      evidenceReason = "Lecture notes filename stem.";
    }
    topics.push({
      id: createId("topic"),
      title: title || "Topic",
      sourceFileNames: names,
      importance,
      evidenceReason,
    });
  }
  return topics.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.importance] - order[b.importance];
  });
}

function buildPastPaperPatterns(hasEvidence: boolean, settings: PackGeneratorSettings): GeneratedPastPaperPattern[] {
  if (!hasEvidence) {
    return [
      {
        id: createId("pat"),
        title: "Past paper evidence",
        evidence: "No past paper evidence uploaded yet. Upload past papers or problem sheets to identify exam patterns.",
        likelyExamStyle: "Unknown until assessment materials are added.",
        suggestedPracticeQuestion: "Upload a past paper or problem sheet, regenerate, then revisit this tab.",
      },
    ];
  }
  return [
    {
      id: createId("pat"),
      title: "Repeated exam emphasis",
      evidence: "Assessment-class files included in this project.",
      likelyExamStyle: settings.revisionStyle === "problem_heavy" ? "Multi-part calculation with interpretation" : "Short recall plus applied follow-up",
      suggestedPracticeQuestion: "Timed past-paper question: definitions first, then a medium-length computation.",
    },
  ];
}
