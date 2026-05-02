/**
 * Local heuristic extraction for the student-facing Study Pack (no APIs).
 *
 * Pipeline:
 *   1. Parse section headings ("4.1 ..." style) per file.
 *   2. Extract labelled blocks (Definition/Theorem/Proposition/.../Algorithm).
 *   3. Pair Theorem/Proposition/Lemma blocks with following "Proof." bodies.
 *   4. Build typed item collections (definitions, formulas, proofs, methods).
 *   5. Pull formulas from raw lines and from non-algorithm labelled blocks (not pseudocode).
 *   6. Build the cram sheet from typed items only — never directly from raw blocks.
 */

import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import { cleanUploadedStudySourceText } from "@/lib/source-text-cleanup";
import { convertCommonMathToLatex } from "@/lib/revision-item-utils";
import {
  extractSectionHeadingsFromText,
  mergeExtractedSectionHeadings,
  truncateBodyBeforeInteriorSectionHeading,
  type ExtractedSectionHeading,
} from "@/lib/section-headings";
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

export type ExtractedSection = ExtractedSectionHeading;

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

/** Label prefix; `\b` allows labels after merged PDF text (not only line-start). Body follows number/paren. */
const LABEL_START_RE =
  /\b(Definition|Theorem|Proposition|Lemma|Corollary|Example|Exercise|Remark|Algorithm)\s+(\d+(?:\.\d+)*)(?:\s*\(([^)]+)\))?/gi;

const PROOF_HEAD = /(?:^|\n)\s*Proof\s*[.:]\s*/gim;

/** Exported for recall-card builders that skip placeholder definitions. */
export const CORE_IDEA_PLACEHOLDER = /^Core idea\s+\d+$/i;

function pageAtOffset(fullText: string, offset: number): number | undefined {
  let pageNumber: number | undefined;
  for (const match of fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

/** Section headings: single-chapter `1 INTRODUCTION`, nested `1.1.2 …`, banners, etc. */
export function extractSectionHeadings(text: string): ExtractedSection[] {
  return extractSectionHeadingsFromText(text);
}

function mergeSectionHeadingsForPack(files: LecturePackFile[], combinedLectureText: string): ExtractedSection[] {
  const fromCombined = extractSectionHeadingsFromText(combinedLectureText);
  const fromFiles = files
    .filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other" || !f.role)
    .flatMap((f) => extractSectionHeadingsFromText(f.parsedText ?? ""));
  return mergeExtractedSectionHeadings(fromCombined, fromFiles);
}

function inferCourseTitleFromNotes(combinedLectureText: string, primaryFileStem: string): string {
  const firstPages = combinedLectureText.split(/\[Page\s*3\]/i)[0] ?? combinedLectureText;
  const lines = firstPages.split("\n").map((l) => l.trim()).filter(Boolean);

  const cutAffiliation = (line: string): string => {
    let t = line.replace(/\s+/g, " ").trim();
    const idx =
      t.search(/\b(Department|Faculty|School)\s+of\b/i) >= 0
        ? t.search(/\b(Department|Faculty|School)\s+of\b/i)
        : t.search(/\b(Imperial College|University of|Professor|Prof\.|Dr\.)\b/i);
    if (idx > 12) t = t.slice(0, idx).trim();
    const nameCut = t.search(/\b(O\.|Deniz|Akyildiz)\b/i);
    if (nameCut > 14) t = t.slice(0, nameCut).trim();
    return t.replace(/[,\s]+$/u, "").trim();
  };

  for (const line of lines) {
    if (line.length < 14 || line.length > 200) continue;
    if (/^\[Page\b/i.test(line)) continue;
    if (/\b(Department|Imperial College|University of)\b/i.test(line) && !/stochastic simulation/i.test(line)) continue;
    if (/stochastic simulation/i.test(line)) {
      const t = cutAffiliation(line);
      if (t.includes(":")) {
        const main = t.split(":")[0]!.trim();
        if (main.length >= 12 && main.length <= 80 && /stochastic simulation/i.test(main)) return main;
      }
      if (t.length <= 100) return t;
      return t.slice(0, 88).replace(/\s+\S*$/u, "").trim();
    }
  }

  const keywordTitle = lines.find((l) => {
    if (l.length < 14 || l.length > 130) return false;
    if (/\b(Department|University|College|Professor)\b/i.test(l)) return false;
    return (
      (/(stochastic simulation|monte carlo|markov chain mcmc|bayesian inference)/i.test(l) && l.length < 130) ||
      (/simulation|generative models/i.test(l) && l.length > 20 && l.length < 130)
    );
  });
  if (keywordTitle) return cutAffiliation(keywordTitle);
  const mc = lines.find((l) => /markov|monte carlo|\bmcmc\b/i.test(l) && l.length >= 12 && l.length < 120);
  if (mc) return mc;
  return primaryFileStem;
}

function advancePastLabelSeparator(text: string, pos: number): number {
  let i = pos;
  if (text[i] === "." && /\s/.test(text[i + 1] ?? "")) {
    i++;
    while (i < text.length && /\s/.test(text[i])) i++;
  }
  return i;
}

type LabelHit = { index: number; bodyStart: number; kind: string; number: string; paren?: string };

/** Preferred display titles for Proposition 3.1–3.6 in Monte Carlo integration / IS chapters (matches common lecture numbering). */
const MC_CHAPTER_PROPOSITION_TITLE: Record<string, string> = {
  "3.1": "Monte Carlo estimator is unbiased",
  "3.2": "Variance of the Monte Carlo estimator",
  "3.3": "Importance sampling estimator is unbiased",
  "3.4": "Variance of the importance sampling estimator",
  "3.5": "SNIS mean squared error bound",
  "3.6": "Unbiased marginal likelihood estimator",
};

function isMonteCarloIntegrationHeavyContext(noteText: string): boolean {
  const lower = noteText.toLowerCase();
  return (
    /\bmonte\s*carlo\s+integration\b|\bmc\s+estimator\b|\bimportance\s+sampling\b|\bself[-\s]?normali[sz]ed\b|\bsnis\b|\beffective\s+sample\b|\bproposal\s+distribution\b/.test(
      lower,
    )
  );
}

function collectLabelHits(text: string): LabelHit[] {
  const hits: LabelHit[] = [];
  LABEL_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_START_RE.exec(text)) !== null) {
    const bodyStart = advancePastLabelSeparator(text, (m.index ?? 0) + m[0].length);
    hits.push({
      index: m.index ?? 0,
      bodyStart,
      kind: m[1] ?? "",
      number: m[2] ?? "",
      paren: m[3]?.trim(),
    });
  }
  return hits;
}

function isCitationReferenceLabel(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 52), index);
  return /\b(see|cf\.|following|follow|compare|from)\s+$/i.test(before.trimEnd());
}

function isGarbageTheoremLabel(text: string, hit: LabelHit) {
  if (!/^theorem$/i.test(hit.kind)) return false;
  const snip = text.slice(hit.bodyStart, hit.bodyStart + 120).trim();
  return /^\)\s*for\s+the\s+proof/i.test(snip) || (/^\)\s*[.;:]/.test(snip) && snip.length < 40);
}

/** Drop “see Example …” references and citation-broken theorem heads. */
function filterStudyPackLabelHits(text: string): LabelHit[] {
  return collectLabelHits(text).filter((h) => !isCitationReferenceLabel(text, h.index) && !isGarbageTheoremLabel(text, h));
}

function clipInteriorEndAbsolute(text: string, bodyStart: number, hardEnd: number, kind: PackItemKind): number {
  const segment = text.slice(bodyStart, hardEnd);
  let rel = segment.length;
  if (kind === "example" || kind === "exercise" || kind === "remark") {
    const fig = /\n\s*Figure\s+\d+/i.exec(segment);
    if (fig && fig.index >= 12) rel = Math.min(rel, fig.index);
  }
  const bib = /\n\s*(?:BIBLIOGRAPHY|References|REFERENCES)\b/i.exec(segment);
  if (bib && bib.index >= 24) rel = Math.min(rel, bib.index);
  const chap = /\n\s*Chapter\s+\d+(?:\.\d+)*\s+[A-Za-z\u00C0-\u024F]/i.exec(segment);
  if (chap && chap.index >= 32) rel = Math.min(rel, chap.index);
  return bodyStart + rel;
}

function inferChapterMajorPrefixFromFilename(name: string): string | undefined {
  const m = name.match(/chapter[-_\s]*(\d+)/i);
  return m?.[1] ? `${m[1]}.` : undefined;
}

function filterExampleExerciseByChapterPrefix(blocks: LabelledBlock[], prefix: string | undefined): LabelledBlock[] {
  if (!prefix) return blocks;
  const major = prefix.replace(/\.$/, "");
  return blocks.filter((b) => {
    if (b.kind !== "example" && b.kind !== "exercise") return true;
    const n = b.number || "";
    return n === major || n.startsWith(prefix) || n.startsWith(`${major}.`);
  });
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

function inferTitleFromStatement(kind: PackItemKind, body: string, formalNumber: string, courseContext: string): string | undefined {
  if (kind !== "proposition" && kind !== "theorem" && kind !== "lemma") return undefined;
  const raw = body.replace(/^\s+/, "").replace(/\s+/g, " ");
  const lower = raw.toLowerCase();
  if (kind === "proposition" && isMonteCarloIntegrationHeavyContext(courseContext) && MC_CHAPTER_PROPOSITION_TITLE[formalNumber]) {
    return MC_CHAPTER_PROPOSITION_TITLE[formalNumber];
  }
  if (kind === "proposition") {
    if (/unbiased.*monte\s*carlo|monte\s*carlo.*unbiased|\bmc\s+estimator\b.*unbiased/i.test(lower)) return "Monte Carlo estimator is unbiased";
    if (/variance.*monte\s*carlo|monte\s*carlo.*variance|var\s*\(\s*\\?hat\s*\\?phi|variance\s+of\s+the\s+mc/i.test(lower)) return "Monte Carlo estimator variance";
    if (/importance\s*sampling.*unbiased|unbiased.*importance\s*sampling/i.test(lower)) return "Importance sampling estimator is unbiased";
    if (/importance\s*sampling.*variance|variance.*importance\s*sampling/i.test(lower)) return "Importance sampling estimator variance";
    if (/marginal\s+likelihood|evidence|p\s*\(\s*y\s*\)/i.test(lower) && /unbiased/i.test(lower)) return "Unbiased marginal likelihood estimator";
    if (/snis|self[-\s]?normalised.*mse|self[-\s]?normalized.*mse|mse.*snis/i.test(lower) && !/marginal|likelihood|evidence/i.test(lower)) {
      return "SNIS mean squared error bound";
    }
  }
  const sentence = raw.split(/(?<=[.!?])\s+/)[0] ?? raw;
  let s = sentence.replace(/^Let\s+[^.]{4,120}\.\s*/i, "").trim();
  s = s.replace(/^(then|thus|hence)\s+/i, "").trim();
  if (s.length >= 14 && s.length < 140) {
    const head = s.charAt(0).toUpperCase() + s.slice(1);
    return head.length > 120 ? `${head.slice(0, 117)}…` : head;
  }
  return undefined;
}

function titleForBlock(kind: PackItemKind, parenTitle: string | undefined, body: string, formalNumber: string, courseContext: string): string {
  if (parenTitle?.trim()) return parenTitle.trim().replace(/\s+/g, " ");
  const inferred = inferTitleFromStatement(kind, body, formalNumber, courseContext);
  if (inferred) return inferred;
  const firstLine = body.replace(/^\s+/, "").split(/\n/)[0] ?? body;
  const cleaned = firstLine.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 8 && cleaned.length < 160) return cleaned.length > 140 ? `${cleaned.slice(0, 137)}…` : cleaned;
  return `${kind} statement`;
}

function inferDisplayTitle(
  kind: PackItemKind,
  parenTitle: string | undefined,
  body: string,
  algorithmHeadLine: string | undefined,
  formalNumber: string,
  courseContext: string,
): string {
  if (parenTitle?.trim()) return parenTitle.trim().replace(/\s+/g, " ");
  const blob = `${algorithmHeadLine ?? ""}\n${body}`;
  const lower = blob.toLowerCase();

  if (kind === "definition") {
    if (lower.includes("conditionally independent")) return "Conditional independence";
    if (/pseudo[-\s]?random/.test(lower)) return "Pseudo-random numbers";
  }
  if (kind === "theorem") {
    if (lower.includes("fundamental theorem of simulation")) return "Fundamental Theorem of Simulation";
    if (/(probability integral|f_x\s*\^\{-1\}|inverse transform cdf|\bcdf\b.*f_x)/i.test(blob)) return "Probability integral transform";
    if (lower.includes("box") && lower.includes("müller")) return "Box-Müller transform";
  }
  if (kind === "proposition") {
    if (lower.includes("chain rule for sampling")) return "Chain Rule for Sampling";
    if (lower.includes("conditional bayes") || lower.includes("conditional bayes rule")) return "Conditional Bayes rule";
    if (isMonteCarloIntegrationHeavyContext(courseContext) && MC_CHAPTER_PROPOSITION_TITLE[formalNumber]) {
      return MC_CHAPTER_PROPOSITION_TITLE[formalNumber]!;
    }
    const inferred = inferTitleFromStatement(kind, body, formalNumber, courseContext);
    if (inferred) return inferred;
  }
  if (kind === "algorithm") {
    const head = (algorithmHeadLine ?? body.split("\n")[0] ?? "").replace(/^\s+/, "");
    let cleaned = cleanAlgorithmTitle(head);
    cleaned = cleaned.split(/[.!?]/)[0]?.trim() ?? cleaned;
    if (cleaned.length >= 5 && cleaned.length < 140) return cleaned;
  }

  return titleForBlock(kind, undefined, body, formalNumber, courseContext);
}

function extractLabelledBlocks(fullText: string, sourceFile: string, sections: ExtractedSection[], courseContext: string): LabelledBlock[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const hits = filterStudyPackLabelHits(text);

  const blocks: LabelledBlock[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const cur = hits[i]!;
    const next = hits[i + 1];
    const hardEnd = next ? next.index : text.length;
    const kind = kindFromWord(cur.kind);
    const clipped = Math.min(hardEnd, clipInteriorEndAbsolute(text, cur.bodyStart, hardEnd, kind));
    const end = Math.max(cur.index, clipped);
    const rawBlock = text.slice(cur.index, end).trim();
    const body = text.slice(cur.bodyStart, end).trim();
    if (body.length < 6 && rawBlock.length < 14) continue;

    const formalLabel = `${capitalize(cur.kind)} ${cur.number}`;
    const algorithmHeadLine = kind === "algorithm" ? body.split("\n")[0] : undefined;
    const displayTitle = inferDisplayTitle(kind, cur.paren, body, algorithmHeadLine, cur.number, courseContext);
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
  const labelledStarts = filterStudyPackLabelHits(text).map((h) => h.index);

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
  t = t.replace(/\bp\*\(/g, "\\( p^\\star(");
  const profileHint = t.toLowerCase();
  const profile =
    /\b(monte\s*carlo|importance\s*sampling|self[-\s]?normali|snis|proposal\s+distribution|empirical\s+measure|mc\s+estimator|is\s+estimator|effective\s+sample|ess\b|test\s+function)\b/.test(
      profileHint,
    )
      ? "monte_carlo_sampling"
      : /\b(markov|mcmc|metropolis|gibbs|transition\s+matrix|detailed\s+balance|irreducible|aperiodic)\b/.test(profileHint)
        ? "monte_carlo_sampling"
        : "generic";
  return convertCommonMathToLatex(t, profile, t);
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

const FORMULA_LIKE =
  /[=∑∫]|\\sum|\\int|\\propto|∝|\\\(|\$|\\frac|\\mathbb\{P\}|\\mathbb\{E\}|M\^\{|M\^|p\^\*|p_n|p\?\(|K\(|\bsum\b|\bmin\b|\balpha\b|q\(|\bmod\b|\bPhi\b|\bN\(|\bGamma\b|\bExp\b|\bUnif\b|\bPois\b|\bint\b|\bE\[|\bVar\b|\bdet\b/i;

const FORMULA_SECONDARY =
  /[=]|\\sum|\\int|∑|∫|∝|\\\\propto|conditional|\\mathbb\{P\}|\\mathbb\{E\}|M_\{|M\^|p_n|p\^\*|p\?\(|K\(|q\(|\bP\(|\br\(x|\bMij\b|\bx_\{|u_n|F_X|lambda|Sigma|sqrt|∏|prop(?:ortional)?|Bayes/i;

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
  const wordCount = line.split(/\s+/).length;
  const symbolDensity = (line.match(/[=∑∫∝<>≥≤_^|]/g) ?? []).length / Math.max(1, wordCount);
  if (wordCount > 18 && symbolDensity < 0.12) return false;
  if (wordCount > 14 && symbolDensity < 0.18 && !/\b(p\?\(|p\^\*|∫|∝|F_X|Sigma|det\s*J|mod\b)/i.test(line)) return false;
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
  {
    name: "Unnormalised target",
    matcher: /p\*\(\s*x\s*\)\s*=\s*pbar\*\(\s*x\s*\)\s*\/\s*Z|p\^\*\(x\)\s*=\s*\\bar\s*p\^\*\(x\)\s*\/\s*Z/i,
    latex: "p^\\star(x) = \\bar p^\\star(x) / Z",
    whenToUse: "Target density known up to an unknown normalising constant.",
  },
  {
    name: "Bayes posterior",
    matcher: /p\s*\(\s*x\s*\|\s*y\s*\)\s*(?:=|∝)\s*p\s*\(\s*y\s*\|\s*x\s*\)\s*p\s*\(\s*x\s*\)/i,
    latex: "p(x \\mid y) \\propto p(y \\mid x) \\, p(x)",
    whenToUse: "Posterior under a prior and likelihood (Bayes rule).",
  },
  {
    name: "Conditional independence (product form)",
    matcher: /p\s*\(\s*x\s*,\s*y\s*\|\s*z\s*\)\s*=\s*p\s*\(\s*x\s*\|\s*z\s*\)\s*p\s*\(\s*y\s*\|\s*z\s*\)/i,
    latex: "p(x,y \\mid z) = p(x \\mid z) \\, p(y \\mid z)",
    whenToUse: "Factorisation when components are conditionally independent given z.",
  },
  {
    name: "Jacobian change of variables (1D)",
    matcher: /p\s*_?\s*Y\s*\(\s*y\s*\)\s*=\s*p\s*_?\s*X\s*\(\s*g\s*\^\{\s*-1\s*\}\s*\(\s*y\s*\)\s*\)\s*\|.*g\s*\^\{\s*-1\s*\}/i,
    latex: "p_Y(y) = p_X(g^{-1}(y)) \\left|\\frac{d}{dy} g^{-1}(y)\\right|",
    whenToUse: "Density under a smooth invertible transform.",
  },
  {
    name: "Marginal likelihood",
    matcher: /p\s*\(\s*y\s*\)\s*=\s*\\?int\s*p\s*\(\s*y\s*\|\s*x\s*\)\s*p\s*\(\s*x\s*\)/i,
    latex: "p(y) = \\int p(y \\mid x) \\, p(x) \\, dx",
    whenToUse: "Evidence / marginal likelihood as integral of joint contributions.",
  },
  {
    name: "Linear congruential generator",
    matcher: /x\s*_\{\s*n\+1\s*\}\s*=\s*a\s*x\s*_?\s*n\s*\+\s*b\s*mod\s*m|x\s*n\+1\s*=\s*a\s*x\s*n\s*\+\s*b\s*mod\s*m/i,
    latex: "x_{n+1} = (a x_n + b) \\bmod m",
    whenToUse: "Pseudo-random uniform seeds via linear congruential updates.",
  },
  {
    name: "Uniform from congruential output",
    matcher: /\bu\s*_?\s*n\s*=\s*x\s*_?\s*n\s*\/\s*m\b/i,
    latex: "u_n = x_n / m",
    whenToUse: "Normalising LCG state to [0,1).",
  },
  {
    name: "Inverse transform sampling identity",
    matcher: /X\s*=\s*F\s*_?\s*X\s*\^\{\s*-1\s*\}\s*\(\s*U\s*\)|F\s*_?\s*X\s*\^\{\s*-1\s*\}\s*\(\s*U\s*\)/i,
    latex: "X = F_X^{-1}(U), \\quad U \\sim \\mathrm{Unif}(0,1)",
    whenToUse: "Probability integral transform / inverse-CDF sampling.",
  },
  {
    name: "Exponential inverse-CDF",
    matcher: /X\s*=\s*-?\s*lambda\s*\^\{\s*-1\s*\}\s*\\?log\s*\(\s*1\s*-\s*U\s*\)|-\s*lambda\s*\^\{\s*-1\s*\}\s*log/i,
    latex: "X = -\\lambda^{-1} \\log(1-U)",
    whenToUse: "Sampling Exp(lambda) via inverse transform.",
  },
  {
    name: "Box–Muller Z1",
    matcher: /Z\s*_?\s*1\s*=\s*sqrt\s*\(\s*-?\s*2\s*\\?log\s*U\s*_?\s*1\s*\)\s*\\?cos/i,
    latex: "Z_1 = \\sqrt{-2\\log U_1}\\cos(2\\pi U_2)",
    whenToUse: "Box–Muller Gaussian pair construction.",
  },
  {
    name: "Affine Gaussian sample",
    matcher: /Y\s*=\s*Sigma\s*\^\{\s*1\/2\s*\}\s*X\s*\+\s*mu|Y\s*=\s*\\Sigma\s*\^\{\s*1\/2\s*\}/i,
    latex: "Y = \\Sigma^{1/2} X + \\mu",
    whenToUse: "Sampling multivariate Gaussian with mean and covariance.",
  },
  {
    name: "Cholesky Gaussian sample",
    matcher: /x\s*_?\s*i\s*=\s*mu\s*\+\s*L\s*v|Cholesky/i,
    latex: "x_i = \\mu + L v",
    whenToUse: "Drawing Gaussian samples using Cholesky factor L.",
  },
  // Monte Carlo integration / importance sampling (Chapter 3 style)
  {
    name: "Expectation under target p*",
    matcher: /bar\s*\{\s*phi\s*\}.*=\s*.*E|=\s*int[^\n]{0,80}phi|E_\{\s*p\?|E_\{\s*p\^\*/,
    latex: "\\bar\\phi = \\mathbb{E}_{p^\\star}[\\phi(X)] = \\int \\phi(x)\\, p^\\star(x)\\, dx",
    whenToUse: "Expressing an expectation under the target distribution.",
  },
  {
    name: "Empirical measure",
    matcher: /p\s*_?N\^\{?\*?\}?\s*\(dx\)\s*=\s*1\/N|1\/N\s*\\?sum.*\\?delta|empirical\s+distribution/i,
    latex: "p_N^\\star(dx) = \\frac{1}{N} \\sum_{i=1}^N \\delta_{X_i}(dx)",
    whenToUse: "Random measure putting mass 1/N on each sample.",
  },
  {
    name: "Monte Carlo estimator",
    matcher: /\\?hat\s*\\?phi\^?N\s*_\{?MC\}?\s*=|1\/N\s*\\?sum.*\\?phi\s*\(\s*X_i|MC\s+estimator/i,
    latex: "\\hat\\phi^N_{\\mathrm{MC}} = \\frac{1}{N} \\sum_{i=1}^N \\phi(X_i)",
    whenToUse: "Standard Monte Carlo average of a test function under i.i.d. samples.",
  },
  {
    name: "MC estimator variance",
    matcher: /Var\s*\(\s*\\?hat\s*\\?phi\^?N\s*_\{?MC\}?\s*\)\s*=\s*Var/i,
    latex: "\\operatorname{Var}(\\hat\\phi^N_{\\mathrm{MC}}) = \\frac{\\operatorname{Var}(\\phi(X))}{N}",
    whenToUse: "1/N scaling of the variance for an i.i.d. Monte Carlo average.",
  },
  {
    name: "Estimator bias",
    matcher: /bias\s*\(\s*\\?hat\s*\\?phi\^?N\s*\)\s*=\s*E\s*\[/i,
    latex: "\\operatorname{bias}(\\hat\\phi^N) = \\mathbb{E}[\\hat\\phi^N] - \\bar\\phi",
    whenToUse: "Bias of an estimator relative to the target mean \\bar\\phi.",
  },
  {
    name: "MSE decomposition",
    matcher: /MSE\s*=\s*bias|MSE\s*=\s*Bias/i,
    latex: "\\mathrm{MSE} = \\mathrm{bias}^2 + \\mathrm{variance}",
    whenToUse: "Bias–variance decomposition of mean squared error.",
  },
  {
    name: "Importance weights ratio",
    matcher: /w\s*\(\s*x\s*\)\s*=\s*p\?\s*\(\s*x\s*\)\s*\/\s*q\s*\(\s*x\s*\)|w\s*\(\s*x\s*\)\s*=\s*p\^\*\s*\(\s*x\s*\)\s*\/\s*q/i,
    latex: "w(x) = \\dfrac{p^\\star(x)}{q(x)}",
    whenToUse: "Importance sampling weight (target over proposal).",
  },
  {
    name: "Importance sampling estimator",
    matcher: /\\?hat\s*\\?phi\^?N\s*_\{?IS\}?\s*=|1\/N\s*\\?sum.*w_i\s*\\?phi/i,
    latex: "\\hat\\phi^N_{\\mathrm{IS}} = \\frac{1}{N} \\sum_{i=1}^N w_i \\, \\phi(X_i)",
    whenToUse: "Self-weighted average under proposal draws with importance weights.",
  },
  {
    name: "IS estimator variance",
    matcher: /Var\s*_?\{?q\}?\s*\(\s*\\?hat\s*\\?phi\^?N\s*_\{?IS\}?\s*\)|Var\s*\(\s*\\?hat\s*\\?phi\^?N\s*_\{?IS\}/i,
    latex: "\\operatorname{Var}_q(\\hat\\phi^N_{\\mathrm{IS}}) = \\frac{1}{N}\\Big(\\mathbb{E}_q[w^2(X)\\phi^2(X)] - \\bar\\phi^2\\Big)",
    whenToUse: "Variance of the importance sampling estimator under proposal q.",
  },
  {
    name: "Unnormalised weight W(x)",
    matcher: /W\s*\(\s*x\s*\)\s*=\s*\\?bar\s*p\?\s*\(\s*x\s*\)\s*\/\s*q\s*\(\s*x\s*\)/i,
    latex: "W(x) = \\dfrac{\\bar p^\\star(x)}{q(x)}",
    whenToUse: "Weights when only an unnormalised target \\bar p^\\star is known.",
  },
  {
    name: "SNIS estimator",
    matcher: /\\?hat\s*\\?phi\^?N\s*_\{?SNIS\}?\s*=|self[-\s]?normali[sz]ed\s+importance\s+sampling/i,
    latex: "\\hat\\phi^N_{\\mathrm{SNIS}} = \\sum_{i=1}^N \\bar w_i \\, \\phi(X_i)",
    whenToUse: "Self-normalised importance sampling estimator using normalised weights \\bar w_i.",
  },
  {
    name: "Normalised importance weights",
    matcher: /\\?bar\s*w\s*_?i\s*=\s*W\s*\(\s*X_i\s*\)\s*\/\s*\\?sum.*W\s*\(\s*X_j\s*\)|\\?bar\s*w\s*_?i\s*=/i,
    latex: "\\bar w_i = \\dfrac{W(X_i)}{\\sum_j W(X_j)}",
    whenToUse: "Normalising unnormalised weights to sum to 1.",
  },
  {
    name: "Effective sample size ESS",
    matcher: /ESS\s*_?N\s*=\s*1\s*\/\s*\\?sum\s*\\?bar\s*w\s*_?i\s*\^?2|effective\s+sample\s+size.*1\s*\/\s*sum/i,
    latex: "\\mathrm{ESS}_N = \\frac{1}{\\sum_i \\bar w_i^2}",
    whenToUse: "ESS from normalised importance weights (effective number of i.i.d. samples).",
  },
  {
    name: "Root mean squared error (RMSE)",
    matcher: /\bRMSE\b\s*[:=]|\broot\s+mean\s+squared\s+error\b/i,
    latex: "\\mathrm{RMSE} = \\sqrt{\\mathrm{MSE}}",
    whenToUse: "Scalar error metric for estimators; related to MSE as RMSE=√MSE.",
  },
  {
    name: "Relative absolute error (RAE)",
    matcher: /\bRAE\b\s*[:=]|\brelative\s+absolute\s+error\b/i,
    latex: "\\mathrm{RAE} = \\dfrac{|\\hat\\phi - \\phi|}{|\\phi|}",
    whenToUse: "Scale-free comparison of estimator error.",
  },
  {
    name: "Mixture importance sampling proposal",
    matcher: /mixture\s+proposal|mixture\s+importance|q\s*\(\s*x\s*\)\s*=\s*\\?sum\s*_?\s*j/i,
    latex: "q(x) = \\sum_{j=1}^J \\beta_j q_j(x)",
    whenToUse: "Mixture proposals for covering multimodal targets in importance sampling.",
  },
  {
    name: "Log-weight stabilisation",
    matcher: /log\s*-?\s*weight|log\s*w\s*_?i|subtract\s+max\s+log\s*weight/i,
    latex: "\\log \\tilde w_i = \\log W_i - \\max_j \\log W_j",
    whenToUse: "Numerically stable computation of weights via log-domain shifts.",
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
    const plain = m[0]?.replace(/\s+/g, " ").trim() ?? "";
    out.push({
      id: createId("form"),
      name: pat.name,
      latex: wrapAsMath(pat.latex),
      formulaPlain: plain.slice(0, 240),
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

function extractFormulaLines(text: string, sourceFile: string, sections: ExtractedSection[], defaultWhenToUse: string): GeneratedFormulaItem[] {
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
      formulaPlain: trimmed.slice(0, 320),
      whenToUse: defaultWhenToUse,
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
  return out.slice(0, 56);
}

function defaultFormulaWhenToUse(lectureText: string): string {
  const lower = lectureText.toLowerCase();
  if (/\bmonte\s*carlo\b|\bimportance\s*sampling\b|\bself[-\s]?normali[sz]ed\b|\bess\b|\beffective\s+sample\b/i.test(lower))
    return "Use for Monte Carlo integration, importance sampling, self-normalised estimators, variance bounds, or ESS.";
  if (/\bmarkov\b|\bmcmc\b|\bmetropolis\b|\bgibbs\b|\btransition\s+matrix\b|\bdetailed\s+balance\b/i.test(lower))
    return "Use when revising Markov chains, transition kernels, detailed balance, or acceptance ratios.";
  return "Key equation from your lecture notes.";
}

/** Drop generic posterior identities when notes are clearly about Monte Carlo / IS rather than Bayesian inference. */
function filterFormulasForChapterContext(items: GeneratedFormulaItem[], lectureText: string): GeneratedFormulaItem[] {
  const lower = lectureText.toLowerCase();
  const mc =
    /\bmonte\s*carlo\b|\bimportance\s*sampling\b|\bself[-\s]?normali[sz]ed\b|\bess\b|\beffective\s+sample\b|\bmc\s+estimator\b/i.test(lower);
  if (!mc) return items;
  const bayesianContext = /\bbayes\b.*\b(inference|posterior|prior)\b|\bposterior\b.*\blikelihood\b|\bbayesian\s+inference/i.test(lower);
  if (bayesianContext) return items;
  return items.filter((f) => {
    if (f.name === "Bayes posterior" || f.name.toLowerCase().includes("bayes posterior")) return false;
    return true;
  });
}

function buildLikelyExamStructureSnippet(combinedLectureText: string, hasPastEvidence: boolean): string {
  if (hasPastEvidence) return "Past/problem-sheet evidence present — cross-check emphasis against these notes.";
  const lower = combinedLectureText.toLowerCase();
  if (/\bmonte\s*carlo\s+integration\b|\bimportance\s+sampling\b|\bess\b|\bsnis\b|\berror\s+metrics\b/i.test(lower)) {
    return "Lecture-only snapshot: Monte Carlo integration, error metrics, importance sampling, self-normalised importance sampling, and effective sample size — add past papers to estimate exam weighting.";
  }
  if (/\bmarkov\b|\bmcmc\b|\bmetropolis\b|\bgibbs\b|\bdetailed\s+balance\b/i.test(lower)) {
    return "Lecture-only snapshot: Markov chains, detailed balance, and MCMC algorithms — add past papers to estimate exam weighting.";
  }
  return "Lecture-only snapshot: core definitions and methods from your notes — add past papers to estimate exam weighting.";
}

// ---------------------------------------------------------------------------
// Definitions, proofs, methods
// ---------------------------------------------------------------------------

function blocksToDefinitions(blocks: LabelledBlock[]): GeneratedDefinitionItem[] {
  return blocks
    .filter((b) => b.kind === "definition")
    .map((b) => {
      const clipped = truncateBodyBeforeInteriorSectionHeading(b.body).slice(0, 3500);
      const defText = normalizeMathText(clipped);
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
        definitionKind: "formal" as const,
        itemKind: b.kind as StudyPackEntryKind,
        importance: b.importance,
        mathStatus: mathStatusFromValidation(v),
      };
    });
}

const CONCEPTUAL_REVISION_SEEDS: Array<{ term: string; pattern: RegExp }> = [
  { term: "Monte Carlo integration", pattern: /\bmonte\s*carlo\s+integration\b/i },
  { term: "Test function", pattern: /\btest\s+function\b/i },
  { term: "Empirical measure", pattern: /\bempirical\s+(measure|distribution)\b/i },
  { term: "Dirac delta measure", pattern: /\bdirac\s+delta\b/i },
  { term: "Monte Carlo estimator", pattern: /\bmonte\s*carlo\s+estimator\b|\bMC\s+estimator\b/i },
  { term: "Unbiased estimator", pattern: /\bunbiased\s+estimator\b/i },
  { term: "Estimator variance", pattern: /\bestimator\s+variance\b|\bvariance\s+of\s+the\s+estimator\b/i },
  { term: "Empirical variance estimator", pattern: /\bempirical\s+variance\b/i },
  { term: "Bias", pattern: /\bbias\s*\(\s*\\?hat|\bbias\s+of\s+the\s+estimator\b/i },
  { term: "Mean squared error (MSE)", pattern: /\bMSE\b|\bmean\s+squared\s+error\b/i },
  { term: "Root mean squared error (RMSE)", pattern: /\bRMSE\b|\broot\s+mean\s+squared\b/i },
  { term: "Relative absolute error (RAE)", pattern: /\bRAE\b|\brelative\s+absolute\b/i },
  { term: "Proposal distribution", pattern: /\bproposal\s+distribution\b/i },
  { term: "Importance weight", pattern: /\bimportance\s+weight/i },
  { term: "Support condition for importance sampling", pattern: /\bsupport\s+condition\b/i },
  { term: "Finite variance condition for importance sampling", pattern: /\bfinite\s+variance\b/i },
  { term: "Optimal proposal", pattern: /\boptimal\s+proposal\b/i },
  { term: "Self-normalised importance sampling", pattern: /\bself[-\s]?normali[sz]ed\s+importance\s+sampling\b|\bSNIS\b/i },
  { term: "Unnormalised weight", pattern: /\bunnormali[sz]ed\s+weight\b/i },
  { term: "Normalised weight", pattern: /\bnormali[sz]ed\s+weight\b|\bnormalised\s+weights\b/i },
  { term: "Effective sample size", pattern: /\beffective\s+sample\s+size\b|\bESS\b/i },
  { term: "Mixture importance sampling", pattern: /\bmixture\s+importance\b/i },
  { term: "Log-weight trick", pattern: /\blog[-\s]?weight\b|\blog\s+trick\b/i },
];

function harvestConceptualDefinitions(
  lectureText: string,
  primaryFile: string,
  sections: ExtractedSection[],
  formalDefs: GeneratedDefinitionItem[],
): GeneratedDefinitionItem[] {
  const used = new Set(formalDefs.map((d) => d.term.toLowerCase()));
  const out: GeneratedDefinitionItem[] = [];
  for (const seed of CONCEPTUAL_REVISION_SEEDS) {
    if (used.has(seed.term.toLowerCase())) continue;
    const hit = seed.pattern.exec(lectureText);
    if (!hit || hit.index === undefined) continue;
    const excerptStart = Math.max(0, hit.index - 40);
    const excerptEnd = Math.min(lectureText.length, hit.index + 280);
    const def = normalizeMathText(lectureText.slice(excerptStart, excerptEnd).replace(/\s+/g, " ").trim());
    if (def.length < 28) continue;
    const v = validateLatexSnippet(def.slice(0, 600));
    out.push({
      id: createId("def"),
      term: seed.term,
      definition: def,
      source: primaryFile,
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(lectureText, hit.index),
      sourceSection: sectionForOffset(sections, hit.index),
      sourceExcerpt: lectureText.slice(hit.index, hit.index + 120),
      importance: "high",
      definitionKind: "conceptual",
      mathStatus: mathStatusFromValidation(v),
    });
    used.add(seed.term.toLowerCase());
  }
  return out;
}

function proofSkeletonFromBody(title: string, body: string): { skeleton: string; mistake: string } {
  const lower = `${title} ${body}`.toLowerCase();
  const mcChapter =
    /\bmonte\s*carlo\b|\bimportance\s*sampling\b|\bsnis\b|\bself[-\s]?normali/.test(lower) &&
    !/\b(simple\s+kriging|ordinary\s+kriging|semivariogram)\b/.test(lower);
  if (mcChapter && /monte\s*carlo/.test(lower) && /unbiased|expectation/.test(lower) && /hat|mc\s+estimator|ϕˆ/i.test(lower)) {
    return {
      skeleton:
        "Write the MC estimator as an average of ϕ(X_i); use linearity of expectation and i.i.d. sampling from the target to relate E[estimator] to E[ϕ(X)].",
      mistake: "Forgetting independence between samples when passing expectation through the sum, or confusing target expectation with proposal expectation.",
    };
  }
  if (mcChapter && (/variance.*mc|mc.*variance|var\s*\(\s*hat\s*phi/i.test(lower) || title.toLowerCase().includes("variance of the monte carlo"))) {
    return {
      skeleton: "Expand Var( (1/N)Σ ϕ(X_i) ) using independence → (1/N²)Σ Var(ϕ(X)). Identify Var(ϕ(X))/N.",
      mistake: "Using proposal variance formulas under i.i.d. target sampling, or dropping the 1/N scaling.",
    };
  }
  if (mcChapter && /importance\s*sampling/.test(lower) && /unbiased/.test(lower)) {
    return {
      skeleton: "Rewrite expectation under q using weights w=p*/q; apply expectation linearity and ∫ p*(x)dx=1.",
      mistake: "Mixing up expectation under q vs p* when moving w inside the integral.",
    };
  }
  if (mcChapter && /snis|self[-\s]?normali/.test(lower) && /mse|mean\s+squared/i.test(lower)) {
    return {
      skeleton: "Express SNIS estimator as ratio of sums; bound MSE via bias–variance or Cauchy–Schwarz style arguments on normalized weights.",
      mistake: "Treating self-normalised weights as deterministic, or ignoring dependence introduced by the random denominator.",
    };
  }
  if (mcChapter && (/marginal\s+likelihood|evidence/.test(lower) || title.toLowerCase().includes("marginal likelihood"))) {
    return {
      skeleton: "Identify an unbiased estimator of the marginal likelihood as an integral identity under an importance proposal; verify expectation step-by-step.",
      mistake: "Confusing marginal likelihood with posterior density, or wrong proposal normalization.",
    };
  }
  if (
    lower.includes("f_x") ||
    lower.includes("probability integral") ||
    (lower.includes("f_x^{-1}") && lower.includes("cdf"))
  ) {
    return {
      skeleton:
        "Let U ~ Uniform(0,1); set X = F_X^{-1}(U). Then P(X<=x) = P(F_X^{-1}(U)<=x) = P(U<=F_X(x)) = F_X(x).",
      mistake: "Forgetting monotonicity/right-continuity of F_X when pushing the inequality through F_X^{-1}.",
    };
  }
  if (lower.includes("conditional bayes") || (lower.includes("p(x|y)") && lower.includes("p(y|x)"))) {
    return {
      skeleton: "Apply Bayes with conditional independence structure; simplify using factors shared across observations.",
      mistake: "Mixing up conditioning directions in p(y|x) vs p(x|y).",
    };
  }
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
  const markovish = /\b(markov|transition\s+matrix|irreducible|aperiodic|detailed\s+balance|stationar)\b/i.test(lower);
  return {
    skeleton: "State assumptions → expand definitions → algebraic manipulation → conclude.",
    mistake: markovish
      ? "Skipping hypotheses (irreducibility, aperiodicity, positivity) when invoking limit theorems."
      : "Omitting integrability/support conditions when swapping limits, sums, and expectations.",
  };
}

/** Build proof items from theorem/proposition/lemma blocks plus paired Proof bodies only (no orphan Proof paragraphs). */
function blocksToProofs(blocks: LabelledBlock[], proofBlocks: LabelledBlock[]): GeneratedProofItem[] {
  const STMT_KINDS: PackItemKind[] = ["theorem", "proposition", "lemma"];
  const stmtBlocks = blocks.filter((b) => STMT_KINDS.includes(b.kind));

  const items: GeneratedProofItem[] = [];

  for (const b of stmtBlocks) {
    const proof = proofBlocks
      .filter((p) => p.sourceFile === b.sourceFile && p.startOffset > b.startOffset)
      .sort((a, c) => a.startOffset - c.startOffset)[0];

    if (!proof?.body?.trim() || proof.body.trim().length < 22) continue;

    const heading = `${b.formalLabel}: ${b.displayTitle}`;
    const { skeleton, mistake } = proofSkeletonFromBody(b.displayTitle, `${b.body}\n${proof.body}`);
    const statementOnly = truncateBodyBeforeInteriorSectionHeading(b.body.split(/(?:^|\n)\s*Proof\s*[.:]/i)[0]!.trim());
    if (/^(example|sketch|remark)\b/i.test(statementOnly) || /^consider\s+the\s+following\s+example\b/i.test(statementOnly)) continue;
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

  return items;
}

/** Clean up algorithm titles like "Algorithm 9 Pseudocode for Metropolis Hastings method". */
function cleanAlgorithmTitle(rawHeading: string): string {
  let t = rawHeading.replace(/^\s+/, "");
  t = t.split(/\n\s*\d+\s*[:.]/)[0]!;
  t = t.split(/\n/)[0]!;
  t = t.replace(/\bpseudocode\s+for\s+/gi, "");
  t = t.replace(/^algorithm\s+\d+(?:\.\d+)?\s*[:.]?\s*/i, "");
  t = t.replace(/\s+\d+\s*:\s*input\b[\s\S]*$/i, "").trim();
  t = t.replace(/^\d+\s*:\s*input\s*:?\s*/i, "").trim();
  t = t.replace(/\bmetropolis\s+hastings\b/gi, "Metropolis–Hastings");
  t = t.replace(/\s+/g, " ").trim();
  if (!t) t = "Algorithm";
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

/** Stop algorithm body before the next labelled environment (e.g. Remark merged after pseudocode). */
function truncateAlgorithmBody(body: string): string {
  const text = body.replace(/\r\n/g, "\n");
  const stop =
    /\n\s*(Remark|Example|Exercise|Algorithm|Theorem|Proposition|Lemma|Definition|Corollary)\s+\d|\n\s*\d{1,2}(?:\.\d+){1,3}\s+[A-Za-z\u00C0-\u024F][^\n]{8,120}/i;
  const m = stop.exec(text);
  if (m && m.index > 12) return text.slice(0, m.index).trim();
  return text;
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
    const headLine = b.body.split("\n")[0] ?? "";
    const cleanTitle =
      b.parenTitle?.trim() && b.parenTitle.trim().length > 3
        ? b.parenTitle.trim()
        : cleanAlgorithmTitle(b.displayTitle || headLine || b.body);
    const steps = cleanAlgorithmSteps(truncateAlgorithmBody(b.body)).map((s) => normalizeMathText(s));
    return {
      id: createId("meth"),
      problemType: `${b.formalLabel}: ${cleanTitle}`,
      steps,
      triggerWords: [cleanTitle, "MCMC", "Metropolis", "Gibbs"].filter(Boolean),
      relatedPracticeType: "Exam-style algorithm recall",
    };
  });

  const textBlob = blocks.map((b) => b.body).join("\n").toLowerCase();
  const markovPresent = /\b(markov|transition\s+matrix|mcmc|gibbs|metropolis|detailed\s+balance)\b/i.test(textBlob);
  const extras: Array<{ title: string; steps: string[]; triggers: string[]; requiresMarkovContext?: boolean }> = [
    {
      title: "Simulate a discrete Markov chain",
      steps: [
        "Choose initial state X0 from p0 or fixed state.",
        "For each step, sample next state from row Xn of transition matrix M.",
        "Repeat to obtain a path; optionally discard burn-in for Monte Carlo averages.",
      ],
      triggers: ["transition matrix", "discrete", "markov chain"],
      requiresMarkovContext: true,
    },
    {
      title: "Compute n-step transition probabilities",
      steps: ["Identify one-step kernel M.", "Use M(n)=Mn for discrete time homogeneous chains.", "For probabilities, track pn=p0Mn."],
      triggers: ["m^n", "chapman", "transition"],
      requiresMarkovContext: true,
    },
    {
      title: "Verify an invariant distribution",
      steps: ["Candidate π — check πM=π row-wise.", "Or integrate π(x')K(x|x')dx'=π(x) for continuous state.", "Confirm positivity/normalisation."],
      triggers: ["invariant", "stationary"],
      requiresMarkovContext: true,
    },
    {
      title: "Use detailed balance",
      steps: ["Write π(i)Mij=π(j)Mji or continuous analogue.", "Conclude π is invariant.", "Note: DB ⇒ stationarity but not always necessary."],
      triggers: ["detailed balance"],
      requiresMarkovContext: true,
    },
    {
      title: "Sampling importance resampling",
      steps: [
        "Draw samples from a proposal and compute importance weights w ∝ p*/q.",
        "Normalise weights; resample indices with replacement using those weights.",
        "Use the resampled points as an (approximate) target sample (often after optional rejuvenation).",
      ],
      triggers: ["sampling importance resampling"],
    },
    {
      title: "Derive a Gibbs sampler from full conditionals",
      steps: ["Write full conditional distributions.", "Cycle updates (systematic or random scan).", "Each update leaves π invariant — verify using conditional detail."],
      triggers: ["gibbs", "full conditional"],
      requiresMarkovContext: true,
    },
  ];

  for (const ex of extras) {
    if (ex.requiresMarkovContext && !markovPresent) continue;
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

function courseTopicsFromSections(files: LecturePackFile[], sections: ExtractedSection[]): GeneratedCourseTopic[] {
  if (!sections.length) return [];
  const names = files.filter((f) => f.role === "lecture_notes" || !f.role).map((f) => f.name);
  return sections.map((s) => ({
    id: createId("topic"),
    title: `${s.sectionNumber} ${s.title}`,
    sourceFileNames: names.length ? names : files.map((f) => f.name),
    importance: "high" as TopicImportance,
    evidenceReason: "Detected numbered section heading in lecture text.",
  }));
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
  const cleanedCombined = cleanUploadedStudySourceText(combinedLectureText.replace(/\r\n/g, "\n"));
  const sectionsMerged = mergeSectionHeadingsForPack(lectureFiles, cleanedCombined);
  const sections = extractSectionHeadings(cleanedCombined);
  const courseContext = cleanedCombined;

  const allBlocks: LabelledBlock[] = [];
  const allProofBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const t = cleanUploadedStudySourceText(f.parsedText ?? "");
    if (!t.trim()) continue;
    const fileSections = extractSectionHeadings(t);
    allBlocks.push(...extractLabelledBlocks(t, f.name, fileSections, courseContext));
    allProofBlocks.push(...extractProofBlocks(t, f.name, fileSections));
  }
  let blocks = dedupeLabelledBlocks(allBlocks);
  blocks = filterExampleExerciseByChapterPrefix(blocks, inferChapterMajorPrefixFromFilename(primaryName));
  const proofBlocks = dedupeLabelledBlocks(allProofBlocks);

  const formalDefs = blocksToDefinitions(blocks);
  const definitions = dedupeDefinitions([...formalDefs, ...harvestConceptualDefinitions(cleanedCombined, primaryName, sections, formalDefs)]);

  const cleanText = cleanedCombined;
  const whenHint = defaultFormulaWhenToUse(cleanText);
  const lineFormulas = extractFormulaLines(cleanText, primaryName, sections, whenHint);
  const canonicalFormulas = extractCanonicalFormulas(cleanText, primaryName, sections);
  const blockFormulas = extractFormulasFromBlocks(blocks, primaryName);
  let formulas = dedupeFormulas([...canonicalFormulas, ...blockFormulas, ...lineFormulas]).map((f) => {
    const v = validateLatexSnippet(f.latex);
    return { ...f, mathStatus: mathStatusFromValidation(v) };
  });
  formulas = filterFormulasForChapterContext(formulas, cleanText);

  let proofs = blocksToProofs(blocks, proofBlocks);
  proofs = dedupeProofs(proofs);

  const methods = algorithmBlocksToMethods(blocks);

  const primaryStem =
    files.find((f) => f.role === "lecture_notes")?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") ??
    primaryName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  const chapterTitle = inferCourseTitleFromNotes(cleanedCombined, primaryStem);

  let courseMap = courseTopicsFromSections(files, sectionsMerged);
  if (!courseMap.length) {
    courseMap = guessTopicsFallback(files);
  }

  const mistakes: GeneratedCommonMistake[] = isMonteCarloIntegrationHeavyContext(cleanedCombined)
    ? [
        {
          id: createId("mis"),
          mistake: "Using MC variance formulas under proposal draws",
          whyItHappens: "IS/SNIS moments depend on q unless weights are handled explicitly.",
          howToAvoid: "State whether expectations are under q or p* before manipulating variance expressions.",
        },
        {
          id: createId("mis"),
          mistake: "Ignoring support overlap between target and proposal",
          whyItHappens: "Weights explode where q≈0 but p*>0.",
          howToAvoid: "Verify q>0 on the support of p* (and finite-variance conditions).",
        },
      ]
    : [
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

  const cramFormulaSource = formulas.filter(
    (f) => !/^algorithm\s+\d/i.test(f.sourceLabel ?? "") && !/^algorithm\s+\d/i.test(f.name) && !/\bpseudocode\b/i.test(f.name),
  );

  const cram: GeneratedCramSheet = {
    definitionBullets: definitions.slice(0, 10).map((d) => `${d.formalLabel ?? d.term}: ${d.definition.slice(0, 100)}${d.definition.length > 100 ? "…" : ""}`),
    formulaBullets: cramFormulaSource.slice(0, 10).map((f) => `${f.name}: ${f.latex}`),
    proofSkeletonBullets: proofs.slice(0, 8).map((p) => `${p.name}: ${p.proofSkeleton.split("\n")[0]!.slice(0, 200)}`),
    trapBullets: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const overview = {
    courseName: chapterTitle,
    summary: `Structured locally from ${files.length} file(s): ${definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term)).length} definitions · ${formulas.length} formulas · ${proofs.length} proofs · ${methods.length} methods.`,
    likelyExamStructure: buildLikelyExamStructureSnippet(cleanedCombined, hasPastEvidence),
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
  const include: PackItemKind[] = ["definition", "theorem", "proposition", "lemma"];
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
        formulaPlain: line.slice(0, 320),
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

/** Labelled Example / Exercise blocks for debug export (not shown as separate Study Pack tabs today). */
export type DebugExampleExerciseItem = {
  id: string;
  kind: "example" | "exercise";
  title: string;
  formalLabel: string;
  body: string;
  sourceFile: string;
  sourcePage?: number;
  sourceSection?: string;
  rawBlock: string;
  /** Set when the block matches exam-critical wording (e.g. cited past finals). */
  highPriority?: boolean;
};

/** Collect Example N / Exercise N blocks from lecture text for JSON export and QA. */
export function extractExampleAndExerciseItemsForDebug(files: LecturePackFile[]): { examples: DebugExampleExerciseItem[]; exercises: DebugExampleExerciseItem[] } {
  const lectureFiles = files.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const courseContext = lectureFiles.map((f) => cleanUploadedStudySourceText(f.parsedText ?? "")).join("\n\n");
  const exampleBlocks: LabelledBlock[] = [];
  const exerciseBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const t = cleanUploadedStudySourceText(f.parsedText ?? "");
    if (!t.trim()) continue;
    const fileSections = extractSectionHeadings(t);
    const blocks = extractLabelledBlocks(t, f.name, fileSections, courseContext);
    for (const b of blocks) {
      if (b.kind === "example") exampleBlocks.push(b);
      if (b.kind === "exercise") exerciseBlocks.push(b);
    }
  }
  const map = (b: LabelledBlock, kind: "example" | "exercise"): DebugExampleExerciseItem => {
    const blob = `${b.body}\n${b.rawBlock}`;
    const highPriority =
      kind === "exercise" &&
      b.number === "3.8" &&
      /\bfinal\s+exam\b/i.test(blob) &&
      /\b2024\b/.test(blob);
    return {
      id: createId(kind === "example" ? "ex" : "exe"),
      kind,
      title: b.displayTitle,
      formalLabel: b.formalLabel,
      body: b.body,
      sourceFile: b.sourceFile,
      sourcePage: b.sourcePage,
      sourceSection: b.sourceSection,
      rawBlock: b.rawBlock,
      ...(highPriority ? { highPriority: true } : {}),
    };
  };
  return {
    examples: dedupeLabelledBlocks(exampleBlocks).map((b) => map(b, "example")),
    exercises: dedupeLabelledBlocks(exerciseBlocks).map((b) => map(b, "exercise")),
  };
}
