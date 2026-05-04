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

import {
  profileDocument,
  sanitiseExtractedText,
  splitDocumentTextLayers,
  type DocumentProfile,
} from "@/lib/document-profile";
import { countProofLikeLineMarkers, extractRawExamPackCandidates } from "@/lib/exam-pack-candidates";
import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import { applyMathNormalisation } from "@/lib/math-normalisation";
import { cleanUploadedStudySourceText } from "@/lib/source-text-cleanup";
import { convertCommonMathToLatex } from "@/lib/revision-item-utils";
import { buildChapterMap, validateChapterMap } from "@/lib/chapter-map-builder";
import { detectHeadingsByPageWithRejections } from "@/lib/heading-detection";
import { buildHeadingHierarchy, summarizeHeadingHierarchy } from "@/lib/heading-hierarchy";
import {
  buildPageRecordsFromParsedPages,
  flattenLectureFilesToFlatPages,
  pageRecordsToMarkedFullText,
} from "@/lib/page-records";
import {
  buildSectionBlocks,
  buildSectionBlocksFromChapterMap,
  buildSectionBlocksFromHeadingGraph,
  buildSectionBlocksPageAware,
  buildSemanticSectionBlocksFromHeadingCandidates,
  ensureMinimumSectionBlocksForLongNotes,
  type SectionBlock,
} from "@/lib/section-blocks";
import {
  extractSectionHeadingsFromText,
  findFirstInteriorSectionHeadingIndex,
  mergeExtractedSectionHeadings,
  truncateBodyBeforeInteriorSectionHeading,
  type ExtractedSectionHeading,
} from "@/lib/section-headings";
import type {
  CourseMapChapterEntry,
  DebugExtractedExampleExercise,
  DefinitionImportance,
  ExamPackBundle,
  ExtractionPipelineDiagnostics,
  GeneratedCommonMistake,
  GeneratedCourseTopic,
  GeneratedCramSheet,
  GeneratedDefinitionItem,
  GeneratedDerivationItem,
  GeneratedFormulaItem,
  GeneratedMethodTemplate,
  GeneratedPastPaperPattern,
  GeneratedPracticeQuestion,
  GeneratedProofItem,
  GeneratedRevisionPack,
  MathStatus,
  SourceGrounding,
  StudyPackEntryKind,
  TopicImportance,
} from "@/lib/student-revision-schema";
import {
  APP_SYSTEM_WORD_WHITELIST,
  excerptGroundedInSource,
  findProminentTermsAbsentFromSource,
  isStaleVersusSource,
  stripUiAndPackLabelsForGrounding,
} from "@/lib/source-grounding";
import type { StudyFileRole } from "@/lib/types";
import { createId } from "@/lib/utils";

/** Mirrors {@link PackSourceFile} without importing revision-pack-generator (avoid circular deps). */
export type LecturePackFile = {
  id: string;
  name: string;
  role?: StudyFileRole;
  parsedText?: string;
  pages?: Array<{ pageNumber: number; text: string }>;
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

/** Inline proofs after page markers / merged PDF lines — must not require line-start (see real PDFs). */
const PROOF_HEAD = /\bProof\s*[.:]\s*/gi;

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

function inferCourseTitleFromNotes(primaryFileStem: string, profile: DocumentProfile): string {
  return profile.title ?? profile.courseName ?? profile.subjectArea ?? primaryFileStem;
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
  const before = text.slice(Math.max(0, index - 72), index);
  return /\b(see|cf\.|following|follow|compare|from|recall|as in|e\.g\.)\s+$/i.test(before.trimEnd());
}

/** Example items must start at a line boundary (PDF glue often inlines “see Example …”). */
function isExampleLabelAtLineStart(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  const gap = text.slice(lineStart, index);
  return /^\s*$/.test(gap);
}

function isGarbageTheoremLabel(text: string, hit: LabelHit) {
  if (!/^theorem$/i.test(hit.kind)) return false;
  const snip = text.slice(hit.bodyStart, hit.bodyStart + 120).trim();
  return /^\)\s*for\s+the\s+proof/i.test(snip) || (/^\)\s*[.;:]/.test(snip) && snip.length < 40);
}

/** Drop “see Example …” references and citation-broken theorem heads. */
function filterStudyPackLabelHits(text: string): LabelHit[] {
  return collectLabelHits(text).filter((h) => {
    if (isCitationReferenceLabel(text, h.index) || isGarbageTheoremLabel(text, h)) return false;
    if (/^example$/i.test(h.kind) && !isExampleLabelAtLineStart(text, h.index)) return false;
    return true;
  });
}

function clipInteriorEndAbsolute(text: string, bodyStart: number, hardEnd: number, kind: PackItemKind): number {
  const segment = text.slice(bodyStart, hardEnd);
  let rel = segment.length;
  if (kind === "example" || kind === "exercise" || kind === "remark") {
    const fig = /\n\s*Figure\s+\d+/i.exec(segment);
    if (fig && fig.index >= 12) rel = Math.min(rel, fig.index);
    const secIdx = findFirstInteriorSectionHeadingIndex(segment, 16);
    if (secIdx !== undefined && secIdx >= 12) rel = Math.min(rel, secIdx);
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
  if (kind === "definition") {
    const raw = body.replace(/^\s+/, "").replace(/\s+/g, " ");
    let s = (raw.split(/(?<=[.!?])\s+/)[0] ?? raw).trim();
    if (s.length > 110) {
      const comma = s.indexOf(",");
      if (comma > 36 && comma < 100) s = s.slice(0, comma);
      else s = s.slice(0, 96);
    }
    s = s.trim();
    if (s.length > 84) s = `${s.slice(0, 81)}…`;
    if (s.length >= 8) return s;
  }
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

  if (kind === "proposition" || kind === "theorem" || kind === "lemma") {
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
    let after = Math.min(nextProof, nextLabelled);
    const segment = text.slice(cur.contentStart, after);
    const secIdx = findFirstInteriorSectionHeadingIndex(segment, 12);
    if (secIdx !== undefined && secIdx >= 10) after = Math.min(after, cur.contentStart + secIdx);
    const bib = /\n\s*(?:BIBLIOGRAPHY|References|REFERENCES)\b/i.exec(segment);
    if (bib && bib.index >= 14) after = Math.min(after, cur.contentStart + bib.index);
    const body = text.slice(cur.contentStart, after).trim();
    if (body.length < 8) continue;
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
  let t = applyMathNormalisation(text.replace(/\r\n/g, "\n"));
  t = t.replace(/\uFFFE|\u0000/g, "");
  t = t.replace(/\\([A-Z])_([A-Za-z0-9]+)/g, "$1_$2");
  t = t.replace(/\\([A-Z])\b/g, "$1");
  t = t.replace(/\bp\?\s*\(/g, "p^\\star(");
  t = t.replace(/\bp\*\s*\(/g, "p^\\star(");
  t = t.replace(/\bbar\s+p\^?star\b/gi, "\\bar p^\\star");
  t = t.replace(/\bp\^star\b/gi, "p^\\star");
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
  t = t.replace(/\bp\*\(/g, "p^\\star(");
  const profileHint = t.toLowerCase();
  const tsContext =
    /\b(time\s+series|autocovariance|autocorrelation|arma|arima|sarima|stationar|white\s+noise|backshift|acf\b|pacf\b|variogram|spectral\s+density|vector\s+autoregression)\b/.test(
      profileHint,
    );
  const mcContext =
    /\b(monte\s*carlo|importance\s*sampling|self[-\s]?normali|snis|proposal\s+distribution|empirical\s+measure|mc\s+estimator|is\s+estimator|effective\s+sample|ess\b|test\s+function)\b/.test(
      profileHint,
    );
  /** MCMC-only — do not match plain discrete-time Markov chains / transition matrices (those need generic math fixes). */
  const mcmcKernelContext =
    !tsContext &&
    /\b(mcmc|markov\s+chain\s+monte\s*carlo|metropolis-hastings|metropolis-hastings|\bmetropolis\b|\bgibbs\s+sampling)\b/i.test(
      profileHint,
    );
  const profile = tsContext ? "time_series" : mcContext ? "monte_carlo_sampling" : mcmcKernelContext ? "monte_carlo_sampling" : "generic";
  return convertCommonMathToLatex(t, profile, t);
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

const FORMULA_LIKE =
  /[=∑∫∇∂κτφγ′″√⟨〉→⇒⇔≤≥×]|\\sum|\\int|\\propto|∝|\\\(|\$|\\frac|\\mathbb\{P\}|\\mathbb\{E\}|\\partial|\\nabla|\\times|\\langle|\\argmin|\\sup|\\inf|M\^\{|M\^|p\^\*|p_n|p\?\(|K\(|\bsum\b|\bmin\b|\blog\b|\bexp\b|\balpha\b|q\(|\bmod\b|\bPhi\b|\bN\(|\bGamma\b|\bExp\b|\bUnif\b|\bPois\b|\bint\b|\bE\{|\bE\[|\bVar\b|\bcov\b|\bdet\b|\\mathrm\{tr\}|\\operatorname\{tr\}|d\s*\/\s*d\s*t|\/\s*d\s*t/i;

const FORMULA_SECONDARY =
  /[=]|\\sum|\\int|∑|∫|∝|∇|∂|κ|τ|φ|→|⇒|⇔|≤|≥|×|\\\\propto|conditional|\\mathbb\{P\}|\\mathbb\{E\}|M_\{|M\^|p_n|p\^\*|p\?\(|K\(|q\(|\bP\(|\br\(x|\bMij\b|\bx_\{|u_n|F_X|lambda|Sigma|sqrt|∏|prop(?:ortional)?|Bayes|det|tr|⟨|〉|\|\s*\|/i;

function looksLikeFormula(line: string, relaxed = false): boolean {
  if (relaxed) {
    const t = line.trim();
    if (t.length < 5 || t.length > 520) return false;
    if (
      /[=∑∫∇∂κτφγ′″√⟨〉×]|\\partial|\\nabla|\\frac|\\int|\\sum|\\times|\\langle/i.test(t) &&
      /[=∑∫+\-]|\\sum|\\int|\\frac|\\mathbb\{E\}|E\s*\{|\\partial|\\nabla/i.test(t)
    ) {
      return true;
    }
    if (
      /\b(cov|corr|var)\s*\(|\\operatorname\{cov\}|\\mathrm\{cov\}|ρ_|\\rho_|φ_|\\phi_|MA\s*\(|AR\s*\(|ARMA|ARCH|ARIMA|VAR\s*\(|GLP|acf\b|PACF\b|\\Phi\(B\)|\\Theta\(B\)|backshift|seasonal\s+difference|spectral\s+density|S\s*\(\s*f\s*\)/i.test(t) &&
      /[=∑∫+\-]|\\sum|\\int|\\frac|\\mathbb\{E\}|E\s*\{/i.test(t)
    ) {
      return true;
    }
  }
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
  const symbolDensity = (line.match(/[=∑∫∝<>≥≤_^|∇∂κτφ′″]/g) ?? []).length / Math.max(1, wordCount);
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
    matcher: /Var\s*_\{?\s*p|Var\s*\(\s*\\?hat\s*\\?phi\^?N\s*_\{?MC\}?\s*\)\s*=\s*Var/i,
    latex:
      "\\operatorname{Var}_{p^\\star}(\\hat\\phi^N_{\\mathrm{MC}}) = \\frac{1}{N}\\operatorname{Var}_{p^\\star}(\\phi(X))",
    whenToUse: "1/N scaling of the variance for an i.i.d. Monte Carlo average under the target law.",
  },
  {
    name: "Empirical variance estimator",
    matcher: /hat\s*\{\s*sigma|sigma\s*\^?\s*2\s*_\{?\s*phi|empirical\s+variance/i,
    latex: "\\hat\\sigma_{\\phi,N}^2 = \\frac{1}{N^2}\\sum_{i=1}^N(\\phi(X_i)-\\hat\\phi^N_{\\mathrm{MC}})^2",
    whenToUse: "Empirical MC variance estimate from sample residuals.",
  },
  {
    name: "Indicator probability estimator",
    matcher: /widehat\s*\{\s*P\s*\}|\\?hat\s*P\s*\(|1\s*_?\s*A\s*\(\s*X|indicator\s+probability/i,
    latex: "\\widehat{\\mathbb{P}}(X\\in A)=\\frac{1}{N}\\sum_{i=1}^N \\mathbf{1}_A(X_i)",
    whenToUse: "Monte Carlo estimate of a probability via an indicator test function.",
  },
  {
    name: "Estimator bias",
    matcher: /bias\s*\(\s*\\?hat\s*\\?phi\^?N\s*\)\s*=\s*E\s*\[/i,
    latex: "\\operatorname{bias}(\\hat\\phi^N) = \\mathbb{E}[\\hat\\phi^N]-\\bar\\phi",
    whenToUse: "Bias of an estimator relative to the target mean \\bar\\phi.",
  },
  {
    name: "Estimator variance (general)",
    matcher: /Var\s*\(\s*\\?hat\s*\\?phi\^?N\s*\)\s*=\s*E\s*\[\s*\(\s*\\?hat\s*\\?phi/i,
    latex: "\\operatorname{Var}(\\hat\\phi^N)=\\mathbb{E}[(\\hat\\phi^N-\\mathbb{E}[\\hat\\phi^N])^2]",
    whenToUse: "Variance of an estimator as squared deviation from its expectation.",
  },
  {
    name: "Mean squared error",
    matcher: /MSE\s*\(\s*\\?hat\s*\\?phi|MSE\s*\(\s*hat\s*phi/i,
    latex: "\\mathrm{MSE}(\\hat\\phi^N)=\\mathbb{E}[(\\hat\\phi^N-\\bar\\phi)^2]",
    whenToUse: "MSE relative to the target functional \\bar\\phi.",
  },
  {
    name: "MSE decomposition",
    matcher: /MSE\s*=\s*bias|MSE\s*=\s*Bias|MSE\s*\(\s*\\?hat/i,
    latex: "\\mathrm{MSE}(\\hat\\phi^N)=\\operatorname{bias}(\\hat\\phi^N)^2+\\operatorname{Var}(\\hat\\phi^N)",
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
    latex:
      "\\operatorname{Var}_q(\\hat\\phi^N_{\\mathrm{IS}})=\\frac{1}{N}\\big(\\mathbb{E}_q[w(X)^2\\phi(X)^2]-\\bar\\phi^2\\big)",
    whenToUse: "Variance of the importance sampling estimator under proposal q.",
  },
  {
    name: "IS identity (change of measure)",
    matcher: /bar\s*\{\s*phi\s*\}.*int\s*phi\s*\(\s*x\s*\).*p\*/i,
    latex: "\\bar\\phi=\\int \\phi(x)\\frac{p^\\star(x)}{q(x)}q(x)\\,dx",
    whenToUse: "Rewriting the target expectation as an expectation under the proposal q.",
  },
  {
    name: "Finite variance condition (IS)",
    matcher: /finite\s+variance|E\s*_?\{?q\s*\}\s*\[\s*w\(\s*X\s*\)\s*\^?\s*2|E_q\s*\[\s*w\(\s*X\s*\)/i,
    latex: "\\mathbb{E}_q[w(X)^2\\phi(X)^2]<\\infty",
    whenToUse: "Square-integrability condition for bounded IS variance.",
  },
  {
    name: "Optimal IS proposal",
    matcher: /optimal\s+proposal|q\s*\^\s*\\?\*\s*\(\s*x\s*\).*phi\s*\(\s*x\s*\)/i,
    latex: "q^\\star(x)=\\dfrac{|\\phi(x)|p^\\star(x)}{\\mathbb{E}_{p^\\star}[|\\phi(X)|]}",
    whenToUse: "Variance-minimising proposal within an unconstrained family (sign-aware form).",
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
    matcher: /\bRMSE\b\s*\(\s*\\?hat\s*\\?phi|\bRMSE\b\s*[:=]/i,
    latex: "\\mathrm{RMSE}(\\hat\\phi^N)=\\sqrt{\\mathrm{MSE}(\\hat\\phi^N)}",
    whenToUse: "Scalar error metric for estimators; RMSE is the square root of MSE.",
  },
  {
    name: "Relative absolute error (RAE)",
    matcher: /\bRAE\b\s*\(\s*\\?hat|\bRAE\b\s*[:=]/i,
    latex: "\\mathrm{RAE}(\\hat\\phi^N)=|\\hat\\phi^N-\\bar\\phi|/|\\bar\\phi|",
    whenToUse: "Scale-free relative error versus the target mean.",
  },
  {
    name: "Mixture importance sampling proposal",
    matcher: /mixture\s+proposal|q\s*_?\{?\s*alpha\s*\}?|mixture\s+importance/i,
    latex: "q_\\alpha(x)=\\sum_{k=1}^K \\alpha_k q_k(x)",
    whenToUse: "Convex combination of component proposals for defensive importance sampling.",
  },
  {
    name: "Log-weight stabilisation",
    matcher: /widetilde\s*\{\\s*log|log\s*-?\s*weight\s*stabil|max\s*_?\s*j\s*\\?\s*log\s*W/i,
    latex:
      "\\widetilde{\\log W_i}=\\log \\bar p^\\star(X_i)-\\log q(X_i)-\\max_j\\log W_j",
    whenToUse: "Numerically stable centred log-weights for SNIS implementations.",
  },
];

/** Canonical matchers that only apply when the source discusses Monte Carlo / importance sampling. */
const MONTE_CARLO_CANONICAL_NAMES = new Set([
  "Expectation under target p*",
  "Empirical measure",
  "Monte Carlo estimator",
  "MC estimator variance",
  "Empirical variance estimator",
  "Indicator probability estimator",
  "Estimator bias",
  "Estimator variance (general)",
  "Mean squared error",
  "MSE decomposition",
  "Importance weights ratio",
  "Importance sampling estimator",
  "IS estimator variance",
  "IS identity (change of measure)",
  "Finite variance condition (IS)",
  "Optimal IS proposal",
  "Unnormalised weight W(x)",
  "SNIS estimator",
  "Normalised importance weights",
  "Effective sample size ESS",
  "Root mean squared error (RMSE)",
  "Relative absolute error (RAE)",
  "Mixture importance sampling proposal",
  "Log-weight stabilisation",
]);

/** Matchers specific to Markov chains / MCMC kernels. */
const MARKOV_MCMC_CANONICAL_NAMES = new Set([
  "Transition matrix entries",
  "Row stochasticity of M",
  "n-step transition (matrix power)",
  "Chapman–Kolmogorov",
  "Distribution one-step evolution",
  "Distribution n-step evolution",
  "Detailed balance (discrete)",
  "K-invariance (continuous)",
  "Detailed balance (continuous)",
  "Metropolis–Hastings acceptance ratio",
  "MH acceptance probability",
  "MALA / Langevin proposal",
]);

function isTimeSeriesHeavyContext(blob: string): boolean {
  const lower = blob.toLowerCase();
  return /\b(time\s+series|autocovariance|autocorrelation|acf\b|pacf\b|arma|arima|sarima|stationar|white\s+noise|spectral|periodogram|backshift|variogram|glp\b|general\s+linear\s+process)\b/.test(lower);
}

/** Curves/surfaces / general mathematical PDFs — relaxes formula-line gates when TS/MC patterns do not apply. */
export function isMathHeavyGeometryContext(blob: string): boolean {
  const lower = blob.toLowerCase();
  return (
    /\b(curvature|frenet|geodesic|gauss-bonnet|fundamental\s+form|christoffel|gaussian\s+curvature|mean\s+curvature|torsion|binormal|normal\s+vector|tangent\s+plane|parametrised\s+curve|arc[-\s]?length|reparametr|second\s+fundamental)\b/i.test(lower) ||
    (blob.match(/[=∑∫∇∂κτφγ⟨〉]/g) ?? []).length > 100
  );
}

/** Canonical formulas for mathematical statistics / time-series lecture notes (only when notes match context). */
const TIME_SERIES_FORMULA_PATTERNS: Array<{ name: string; matcher: RegExp; latex: string; whenToUse: string }> = [
  {
    name: "Covariance definition",
    matcher: /cov\s*\(\s*X\s*,\s*Y\s*\)\s*=\s*E\s*\[\s*\(\s*X\s*-\s*E\s*\[X\]\s*\)/i,
    latex: "\\operatorname{cov}(X,Y)=\\mathbb{E}[(X-\\mathbb{E}[X])(Y-\\mathbb{E}[Y])]",
    whenToUse: "Covariance from centred products / computing via expectations.",
  },
  {
    name: "Correlation from covariance",
    matcher: /corr\s*\(\s*X\s*,\s*Y\s*\)|ρ\s*=\s*cov|correlation\s+coefficient/i,
    latex: "\\rho_{XY}=\\dfrac{\\operatorname{cov}(X,Y)}{\\sqrt{\\operatorname{Var}(X)\\operatorname{Var}(Y)}}",
    whenToUse: "Pearson correlation rescales covariance to [-1,1].",
  },
  {
    name: "Autocovariance at lag τ",
    matcher: /s_τ\s*=\s*cov\s*\(\s*X_t\s*,\s*X_\{t\+τ\}|γ\s*\(\s*τ\s*\)\s*=\s*cov/i,
    latex: "s_\\tau=\\operatorname{cov}(X_t,X_{t+\\tau})",
    whenToUse: "Autocovariance sequence for equally spaced times.",
  },
  {
    name: "Autocorrelation at lag τ",
    matcher: /ρ_τ\s*=\s*s_τ\s*\/\s*s_0|acf\s+at\s+lag/i,
    latex: "\\rho_\\tau=s_\\tau/s_0",
    whenToUse: "Normalised autocovariance (ACF).",
  },
  {
    name: "White noise autocovariances",
    matcher: /white\s+noise[\s\S]{0,80}s_0\s*=|σ\s*\^?\s*2\s*δ/i,
    latex: "s_\\tau=\\sigma^2\\mathbf{1}_{\\{\\tau=0\\}}",
    whenToUse: "IID Gaussian white noise autocovariance.",
  },
  {
    name: "MA(q) model",
    matcher: /MA\s*\(\s*q\s*\)|moving\s+average\s+order\s+q/i,
    latex: "X_t=\\varepsilon_t+\\sum_{j=1}^q \\theta_j \\varepsilon_{t-j}",
    whenToUse: "Moving-average representation with innovations ε.",
  },
  {
    name: "AR(p) model",
    matcher: /AR\s*\(\s*p\s*\)|autoregressive\s+order\s+p/i,
    latex: "X_t=\\sum_{j=1}^p \\phi_j X_{t-j}+\\varepsilon_t",
    whenToUse: "Autoregressive recursion.",
  },
  {
    name: "AR(1) stationarity",
    matcher: /AR\(1\)[\s\S]{0,120}\|\s*φ\s*\|\s*<\s*1|\|\s*phi\s*\|\s*<\s*1/i,
    latex: "|\\phi|<1",
    whenToUse: "Stationarity condition for causal AR(1).",
  },
  {
    name: "ARMA(p,q) compact",
    matcher: /ARMA\s*\(\s*p\s*,\s*q\s*\)|\\Phi\(B\)|\\Theta\(B\)/i,
    latex: "\\Phi(B)X_t=\\Theta(B)\\varepsilon_t",
    whenToUse: "ARMA in operator notation.",
  },
  {
    name: "ARCH dynamics",
    matcher: /ARCH\s*\(\s*p\s*\)|conditional\s+variance/i,
    latex: "\\sigma_t^2=\\omega+\\sum_{i=1}^p \\alpha_i X_{t-i}^2",
    whenToUse: "Volatility clustering (ARCH-type variance law).",
  },
  {
    name: "Trend–seasonal decomposition",
    matcher: /X_t\s*=\s*m_t\s*\+\s*s_t\s*\+\s*Y_t|signal\s*\+\s*noise\s*\+\s*seasonal/i,
    latex: "X_t=m_t+s_t+Y_t",
    whenToUse: "Additive signal/trend/seasonal decomposition.",
  },
  {
    name: "First difference",
    matcher: /∇\s*X_t|first\s+difference|\(1\s*-\s*B\)X/i,
    latex: "\\nabla X_t=X_t-X_{t-1}",
    whenToUse: "Removing polynomial trends via differencing.",
  },
  {
    name: "Backshift operator",
    matcher: /B\s+X_t\s*=\s*X_\{t-1\}|backshift/i,
    latex: "BX_t=X_{t-1}",
    whenToUse: "Lag operator on discrete-time processes.",
  },
  {
    name: "ARIMA operator form",
    matcher: /ARIMA\s*\(\s*p\s*,\s*d\s*,\s*q\s*\)|\(1\s*-\s*B\)\^?\s*d/i,
    latex: "\\Phi(B)(1-B)^d X_t=\\Theta(B)\\varepsilon_t",
    whenToUse: "Integrated ARMA with differencing order d.",
  },
  {
    name: "Seasonal difference",
    matcher: /seasonal\s+differencing|\(1\s*-\s*B\^s\)/i,
    latex: "\\nabla_s X_t=X_t-X_{t-s}",
    whenToUse: "Removing seasonal cycles with period s.",
  },
  {
    name: "Spectral density as Fourier pair",
    matcher: /spectral\s+density|f\s*\(\s*ω\s*\)|periodogram/i,
    latex: "f(\\omega)=\\sum_{\\tau=-\\infty}^\\infty s_\\tau e^{-i\\omega\\tau}",
    whenToUse: "Linking autocovariance to spectrum (notation varies by course).",
  },
  {
    name: "VAR(p) model",
    matcher: /VAR\s*\(\s*p\s*\)|vector\s+autoregression/i,
    latex: "X_t=\\sum_{j=1}^p \\Phi_j X_{t-j}+\\varepsilon_t",
    whenToUse: "Multivariate AR dynamics.",
  },
];

const GEOMETRY_FORMULA_PATTERNS: Array<{ name: string; matcher: RegExp; latex: string; whenToUse: string }> = [
  {
    name: "Arc-length of a curve",
    matcher: /length\s+of.*∫|∫[^\n]{0,40}\|\s*φ|∫[^\n]{0,40}\|phi|arc[-\s]?length[^\n]{0,80}∫/i,
    latex: "L(\\gamma)=\\int_a^b|\\gamma'(t)|\\,dt",
    whenToUse: "Length of a smooth parametrised curve.",
  },
  {
    name: "Arc-length parameter",
    matcher: /\|\s*φ\s*'\s*\(\s*t\s*\)\s*\|\s*=\s*1|\|\s*gamma\s*'\s*\(\s*s\s*\)\s*\|\s*=\s*1|unit\s+speed/i,
    latex: "|\\gamma'(s)|=1",
    whenToUse: "Arc-length (unit-speed) parametrisation.",
  },
  {
    name: "Curvature (norm of acceleration)",
    matcher: /κ\s*\(\s*t\s*\)\s*=\s*\|\s*φ\s*''|curvature[^\n]{0,40}\|\s*γ\s*''/i,
    latex: "\\kappa(t)=|\\gamma''(t)|",
    whenToUse: "Plane-curve curvature magnitude (common definition).",
  },
  {
    name: "Frenet frame (T, N, B)",
    matcher: /T\s*=\s*γ\s*'|binormal|principal\s+normal|Frenet/i,
    latex: "T=\\gamma',\\quad N=\\frac{T'}{|T'|},\\quad B=T\\times N",
    whenToUse: "Moving orthonormal frame along a space curve.",
  },
  {
    name: "Gaussian curvature",
    matcher: /Gaussian\s+curvature|K\s*=\s*κ\s*_?1\s*κ\s*_?2/i,
    latex: "K=\\kappa_1\\kappa_2",
    whenToUse: "Intrinsic curvature of a surface (product of principal curvatures in common convention).",
  },
  {
    name: "Mean curvature",
    matcher: /mean\s+curvature|H\s*=\s*\(?κ\s*_?1\s*\+\s*κ\s*_?2/i,
    latex: "H=\\tfrac12(\\kappa_1+\\kappa_2)",
    whenToUse: "Mean curvature from principal curvatures.",
  },
  {
    name: "First fundamental form",
    matcher: /first\s+fundamental\s+form|I\s*=\s*E\s*du\s*\^2/i,
    latex: "I=E\\,du^2+2F\\,du\\,dv+G\\,dv^2",
    whenToUse: "Induced metric on a parametrised surface.",
  },
  {
    name: "Second fundamental form",
    matcher: /second\s+fundamental\s+form|II\s*=/i,
    latex: "II=L\\,du^2+2M\\,du\\,dv+N\\,dv^2",
    whenToUse: "Extrinsic shape operator / second fundamental form coefficients.",
  },
  {
    name: "Christoffel symbols",
    matcher: /Christoffel|\\Gamma\s*\^|Γ\s*\^/i,
    latex: "\\Gamma_{ij}^k",
    whenToUse: "Connection coefficients from the induced metric.",
  },
  {
    name: "Gauss–Bonnet (classic form)",
    matcher: /Gauss[-\s]*Bonnet|∫∫\s*K|total\s+curvature/i,
    latex: "\\iint_M K\\,dA+\\int_{\\partial M}\\kappa_g\\,ds=2\\pi\\chi(M)",
    whenToUse: "Links total Gaussian curvature to topology (Euler characteristic).",
  },
];

function filterGeometryFormulaPatterns(sourceRaw: string): typeof GEOMETRY_FORMULA_PATTERNS {
  return isMathHeavyGeometryContext(sourceRaw) ? GEOMETRY_FORMULA_PATTERNS : [];
}

function filterTimeSeriesFormulaPatterns(sourceLower: string): typeof TIME_SERIES_FORMULA_PATTERNS {
  return isTimeSeriesHeavyContext(sourceLower) ? TIME_SERIES_FORMULA_PATTERNS : [];
}

function filterCanonicalFormulaPatterns(sourceLower: string) {
  const mc =
    /\bmonte\s*carlo\b|\bimportance\s+sampling\b|\bsnis\b|\beffective\s+sample\b|\bess\b|\bmc\s+estimator\b|\bself[-\s]?normali/i.test(sourceLower);
  const mk =
    /\b(markov\s+chain|\bmcmc\b|\bmetropolis\b|\bgibbs\b|\btransition\s+matrix|\bdetailed\s+balance)\b/i.test(sourceLower);
  return FORMULA_PATTERNS.filter((p) => {
    if (MONTE_CARLO_CANONICAL_NAMES.has(p.name) && !mc) return false;
    if (MARKOV_MCMC_CANONICAL_NAMES.has(p.name) && !mk) return false;
    return true;
  });
}

function sourceGroundingPack(
  sourceFile: string,
  sourcePage: number | undefined,
  sourceSection: string | undefined,
  excerpt: string,
): SourceGrounding {
  const ex = excerpt.trim();
  const groundingConfidence = ex.length >= 48 ? 0.88 : ex.length >= 20 ? 0.72 : 0.45;
  return {
    sourceFile,
    sourcePage: sourcePage ?? null,
    sourceSection: sourceSection ?? null,
    sourceExcerpt: ex.slice(0, 900),
    groundingConfidence,
  };
}

function extractCanonicalFormulas(text: string, sourceFile: string, sections: ExtractedSection[]): GeneratedFormulaItem[] {
  const lower = text.toLowerCase();
  const out: GeneratedFormulaItem[] = [];
  for (const pat of [...filterCanonicalFormulaPatterns(lower), ...filterTimeSeriesFormulaPatterns(lower), ...filterGeometryFormulaPatterns(text)]) {
    pat.matcher.lastIndex = 0;
    const m = pat.matcher.exec(text);
    if (!m) continue;
    const offset = m.index;
    const wrapped = wrapAsMath(pat.latex);
    const v = validateLatexSnippet(wrapped);
    const plain = m[0]?.replace(/\s+/g, " ").trim() ?? "";
    const excerpt = text.slice(Math.max(0, offset - 40), offset + 200).slice(0, 420);
    const pg = pageAtOffset(text, offset) ?? 1;
    out.push({
      id: createId("form"),
      name: pat.name,
      latex: wrapped,
      formulaPlain: plain.slice(0, 240),
      rawFormula: plain.slice(0, 240),
      cleanedLatex: pat.latex,
      whenToUse: pat.whenToUse,
      source: sourceFile,
      sourceFile,
      sourceSection: sectionForOffset(sections, offset),
      sourcePage: pg,
      sourceExcerpt: excerpt,
      mathStatus: mapFormulaMathStatus(v),
      groundingConfidence: 0.8,
      grounding: sourceGroundingPack(sourceFile, pg, sectionForOffset(sections, offset), excerpt),
    });
  }
  return out;
}

/** Lines likely to contain equations (before strict LaTeX cleanup). */
function countFormulaLikeLines(text: string): number {
  const relaxed = isTimeSeriesHeavyContext(text) || isMathHeavyGeometryContext(text);
  let n = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (looksLikeFormula(trimmed, relaxed)) n += 1;
    else if (
      relaxed &&
      /\b(defined\s+as|given\s+by|we\s+define|is\s+expressed\s+as|denoted\s+by|model|equation|condition|where)\b/i.test(trimmed) &&
      trimmed.length < 220
    ) {
      n += 1;
    }
  }
  return n;
}

function extractCueAdjacentFormulaLines(
  text: string,
  sourceFile: string,
  sections: ExtractedSection[],
  defaultWhenToUse: string,
): GeneratedFormulaItem[] {
  const cue =
    /\b(defined\s+as|given\s+by|we\s+define|is\s+expressed\s+as|denoted\s+by|stationarity\s+condition|invertibility\s+condition|satisfies|therefore|hence|we\s+have|model|equation)\b/i;
  const lines = text.split("\n");
  let offset = 0;
  const out: GeneratedFormulaItem[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const contentStart = offset + (line.length - line.trimStart().length);
    if (!cue.test(trimmed) || trimmed.length > 260) {
      offset += line.length + 1;
      continue;
    }
    const next = (lines[i + 1] ?? "").trim();
    const candidate = next && (looksLikeFormula(next, true) || /^[=∑∫]/.test(next)) ? next : trimmed;
    if (!looksLikeFormula(candidate, true) && !/[=∑∫ρφθω]/i.test(candidate)) {
      offset += line.length + 1;
      continue;
    }
    const normalized = normalizeMathText(candidate);
    const sig = normalized.replace(/\s+/g, " ").slice(0, 160).toLowerCase();
    if (seen.has(sig)) {
      offset += line.length + 1;
      continue;
    }
    seen.add(sig);
    const wrappedCue = wrapAsMath(normalized);
    const v = validateLatexSnippet(wrappedCue);
    const excerpt = `${trimmed}\n${candidate}`.slice(0, 520);
    const pg = pageAtOffset(text, contentStart) ?? 1;
    out.push({
      id: createId("form"),
      name: trimmed.slice(0, 72).replace(/\s+/g, " "),
      latex: wrappedCue,
      formulaPlain: candidate.slice(0, 320),
      rawFormula: candidate.slice(0, 320),
      cleanedLatex: normalized.slice(0, 480),
      whenToUse: defaultWhenToUse,
      source: sourceFile,
      sourceFile,
      sourceSection: sectionForOffset(sections, contentStart),
      sourcePage: pg,
      sourceExcerpt: excerpt,
      mathStatus: mapFormulaMathStatus(v),
      groundingConfidence: 0.72,
      grounding: sourceGroundingPack(sourceFile, pg, sectionForOffset(sections, contentStart), excerpt),
    });
    offset += line.length + 1;
  }
  return out;
}

function mapFormulaMathStatus(v: ReturnType<typeof validateLatexSnippet>): MathStatus {
  const base = mathStatusFromValidation(v);
  if (base === "needs_check") return "needs_review";
  return base;
}

function extractFormulaLines(text: string, sourceFile: string, sections: ExtractedSection[], defaultWhenToUse: string): GeneratedFormulaItem[] {
  const relaxedLines = isTimeSeriesHeavyContext(text) || isMathHeavyGeometryContext(text);
  const lines = text.split("\n");
  let offset = 0;
  const out: GeneratedFormulaItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!looksLikeFormula(trimmed, relaxedLines)) {
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
    const wrapped = wrapAsMath(normalized);
    const v = validateLatexSnippet(wrapped);
    const nameGuess = trimmed.match(/^([^=:{]+)[:=]/);
    const name = nameGuess ? nameGuess[1]!.trim().slice(0, 72) : `Relation near “${trimmed.slice(0, 40)}…”`;
    const excerpt = trimmed.slice(0, 420);
    const pg = pageAtOffset(text, offset) ?? 1;
    out.push({
      id: createId("form"),
      name: name.replace(/\s+/g, " "),
      latex: wrapped,
      formulaPlain: trimmed.slice(0, 320),
      rawFormula: trimmed.slice(0, 320),
      cleanedLatex: normalized.slice(0, 480),
      whenToUse: defaultWhenToUse,
      source: sourceFile,
      sourceFile,
      sourceSection: sectionForOffset(sections, offset),
      sourcePage: pg,
      sourceExcerpt: excerpt,
      mathStatus: mapFormulaMathStatus(v),
      groundingConfidence: excerpt.length >= 48 ? 0.85 : 0.62,
      grounding: sourceGroundingPack(sourceFile, pg, sectionForOffset(sections, offset), excerpt),
    });
    offset += line.length + 1;
  }
  return out;
}

function dedupeFormulas(items: GeneratedFormulaItem[], maxItems = 120): GeneratedFormulaItem[] {
  const out: GeneratedFormulaItem[] = [];
  for (const f of items) {
    const sig = f.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase();
    if (out.some((x) => x.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase() === sig)) continue;
    if (out.some((x) => jaccardSimilarity(x.latex, f.latex) > 0.92)) continue;
    out.push(f);
  }
  return out.slice(0, maxItems);
}

function defaultFormulaWhenToUse(lectureText: string): string {
  const lower = lectureText.toLowerCase();
  if (isMathHeavyGeometryContext(lectureText)) {
    return "Key identity for curves/surfaces: use with the exact regularity conditions from the same page (parametrisation, domain, orientation).";
  }
  if (/\bmonte\s*carlo\b|\bimportance\s*sampling\b|\bself[-\s]?normali[sz]ed\b|\bess\b|\beffective\s+sample\b/i.test(lower))
    return "Use for Monte Carlo integration, importance sampling, self-normalised estimators, variance bounds, or ESS.";
  if (/\bmarkov\b|\bmcmc\b|\bmetropolis\b|\bgibbs\b|\btransition\s+matrix\b|\bdetailed\s+balance\b/i.test(lower))
    return "Use when revising Markov chains, transition kernels, detailed balance, or acceptance ratios.";
  return "Key equation from your lecture notes.";
}

function inferExamQuestionTypesFromSource(text: string): string[] {
  const lower = text.toLowerCase();
  const add = (label: string, ok: boolean, arr: string[]) => {
    if (ok && !arr.includes(label)) arr.push(label);
  };
  const out: string[] = [];
  add("Proof / derivation", /\bprove\b|\bshow\s+that\b|\bdeduce\b/i.test(lower), out);
  add("Computation / evaluation", /\bcalculate\b|\bcompute\b|\bevaluate\b|\bfind\b/i.test(lower), out);
  add("Verify hypotheses / regularity", /\bverify\b|\bcheck\s+that\b|\bshow\s+that\s+.+\s+is\s+regular/i.test(lower), out);
  add("Counterexamples / examples", /\bcounterexample\b|\bfor\s+example\b|\bfor\s+instance\b/i.test(lower), out);
  add("Short definitions / recall", /\bdefine\b|\bstate\s+the\s+definition\b/i.test(lower), out);
  add("Past-paper style numeric marks", /\bmarks?\b|\bminutes\b|\bcandidates\b/i.test(lower), out);
  return out.slice(0, 28);
}

function buildMinimalPracticePreview(
  definitions: GeneratedDefinitionItem[],
  formulas: GeneratedFormulaItem[],
  proofs: GeneratedProofItem[],
  primaryFile: string,
): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  for (const d of definitions.slice(0, 12)) {
    if (CORE_IDEA_PLACEHOLDER.test(d.term)) continue;
    out.push({
      id: createId("pq"),
      question: `Define “${d.term.slice(0, 120)}” precisely.`,
      expectedAnswer: d.definition.slice(0, 800),
      topic: d.term.slice(0, 80),
      difficulty: "easy",
      sourceBasis: d.sourceFile ?? primaryFile,
      hints: ["Include assumptions"],
    });
    if (out.length >= 18) break;
  }
  for (const f of formulas.slice(0, 12)) {
    if (out.length >= 18) break;
    out.push({
      id: createId("pq"),
      question: `Write ${f.name} and state when it applies.`,
      expectedAnswer: `${f.latex}\n${f.whenToUse}`.slice(0, 900),
      topic: f.name,
      difficulty: "medium",
      sourceBasis: f.sourceFile ?? primaryFile,
      hints: ["Symbols", "Domain"],
    });
  }
  for (const p of proofs.slice(0, 8)) {
    if (out.length >= 18) break;
    out.push({
      id: createId("pq"),
      question: `Outline the proof of: ${p.statement.slice(0, 140)}`,
      expectedAnswer: p.proofSkeleton.slice(0, 900),
      topic: p.name,
      difficulty: "hard",
      sourceBasis: p.sourceFile ?? primaryFile,
      hints: ["Assumptions first"],
    });
  }
  return out.slice(0, 18);
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

function buildExamStructureFromProfile(profile: DocumentProfile, hasPastEvidence: boolean): string {
  if (hasPastEvidence) return "Past/problem-sheet evidence present — align priorities with the headings below.";
  const topics = profile.detectedTopics.slice(0, 16).filter(Boolean);
  const chapters = profile.chapterMap.slice(0, 10).map((c) => c.chapterTitle || c.chapterLabel).filter(Boolean);
  const topicPart = topics.length ? topics.join(", ") : "the concepts surfaced from headings";
  const chapterPart = chapters.length ? chapters.join("; ") : "chapter banners detected in the PDF text";
  return `Structured overview from this upload only: ${topicPart}. Sections: ${chapterPart}. Add past papers to estimate exam weighting.`;
}

// ---------------------------------------------------------------------------
// Definitions, proofs, methods
// ---------------------------------------------------------------------------

/**
 * Long PDF blocks become unreadable on revision cards — trim at sentence boundaries while keeping early content.
 * Style caps approximate length; detailed_guide keeps more prose for non-exam narrative notes.
 */
function compactDefinitionForExamPack(raw: string, revisionStyle: PackGeneratorSettings["revisionStyle"]): string {
  const normalized = raw.replace(/\s+/g, " ").trim();
  const maxChars =
    revisionStyle === "detailed_guide" ? 1650
    : revisionStyle === "flashcard_heavy" ? 520
    : revisionStyle === "problem_heavy" ? 1040
    : 860;
  if (normalized.length <= maxChars) return normalized;
  const slice = normalized.slice(0, maxChars + 120);
  const indices = [slice.lastIndexOf(". "), slice.lastIndexOf("? "), slice.lastIndexOf("! "), slice.lastIndexOf("; ")]
    .filter((i) => i >= Math.floor(maxChars * 0.42));
  const cut = indices.length ? Math.max(...indices) + 1 : maxChars;
  return `${normalized.slice(0, cut).trim()}…`;
}

/** Section / topic titles from TOC can be full sentences — keep card headings short. */
function truncatePackConceptTerm(raw: string, max = 76): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max);
  return `${t.slice(0, cut > 36 ? cut : max).trim()}…`;
}

/** Cut definition/proof bodies before bibliography — PDF extractors often append refs after main text. */
function clipBibliographyFromPackBody(body: string): string {
  const bib = body.search(/\n\s*(?:BIBLIOGRAPHY|Bibliography|References|REFERENCES)\b/i);
  if (bib === -1 || bib < 48) return body;
  return body.slice(0, bib).trim();
}

function clipEssDefinitionBody(body: string, formalLabel?: string, term?: string): string {
  const head = `${formalLabel ?? ""} ${term ?? ""}`.toLowerCase();
  const blob = body.toLowerCase();
  const looksEss = /\bess\b|effective\s+sample/i.test(blob) || /effective\s+sample/i.test(head);
  if (!looksEss) return body;

  const bounded = body.match(/1\s*(?:≤|<=|<)\s*ESS(?:_N|\s*N)\s*(?:≤|<=|<)\s*N\s*\./i);
  if (bounded && bounded.index !== undefined) return body.slice(0, bounded.index + bounded[0].length).trim();

  const mix = body.search(/\n\s*(?:\d+\.){2,}\s*(?:Mixture|mixture)\s+importance/i);
  if (mix > 40) return body.slice(0, mix).trim();
  const bib = body.search(/\n\s*(?:BIBLIOGRAPHY|Bibliography|References|REFERENCES)\b/i);
  if (bib > 40) return body.slice(0, bib).trim();
  return truncateBodyBeforeInteriorSectionHeading(body);
}

function blocksToDefinitions(blocks: LabelledBlock[], revisionStyle: PackGeneratorSettings["revisionStyle"]): GeneratedDefinitionItem[] {
  return blocks
    .filter((b) => b.kind === "definition")
    .map((b) => {
      const trimmed = clipBibliographyFromPackBody(truncateBodyBeforeInteriorSectionHeading(b.body).slice(0, 3500));
      const clipped = clipEssDefinitionBody(trimmed, b.formalLabel, b.displayTitle);
      const defText = compactDefinitionForExamPack(normalizeMathText(clipped), revisionStyle);
      const snippet = defText.slice(0, 700);
      const v = validateLatexSnippet(snippet);
      const excerpt = b.rawBlock.slice(0, 900);
      return {
        id: createId("def"),
        term: b.displayTitle,
        definition: defText,
        source: b.sourceFile,
        sourceFile: b.sourceFile,
        sourcePage: b.sourcePage,
        sourceSection: b.sourceSection,
        sourceLabel: b.formalLabel,
        sourceExcerpt: excerpt,
        formalLabel: b.formalLabel,
        definitionKind: "formal" as const,
        itemKind: b.kind as StudyPackEntryKind,
        importance: b.importance,
        mathStatus: mathStatusFromValidation(v),
        grounding: sourceGroundingPack(b.sourceFile, b.sourcePage, b.sourceSection, excerpt),
      };
    });
}

/** Concept cards from headings + document topics + definition-shaped sentences (no fixed syllabus list). */
function harvestConceptualDefinitions(
  lectureText: string,
  primaryFile: string,
  sections: ExtractedSection[],
  formalDefs: GeneratedDefinitionItem[],
  profile: DocumentProfile,
  extraHeadingTerms: string[] = [],
  revisionStyle: PackGeneratorSettings["revisionStyle"] = "concise_exam",
): GeneratedDefinitionItem[] {
  const used = new Set(formalDefs.map((d) => d.term.toLowerCase()));
  const out: GeneratedDefinitionItem[] = [];

  const candidateTerms: string[] = [];
  for (const s of sections) {
    const t = `${s.title}`.trim();
    if (t.length >= 6 && t.length < 120) candidateTerms.push(t);
  }
  for (const t of profile.detectedTopics) {
    if (t.length >= 5 && t.length < 90) candidateTerms.push(t);
  }
  for (const t of extraHeadingTerms) {
    const x = t.replace(/\s+/g, " ").trim();
    if (x.length >= 6 && x.length < 160) candidateTerms.push(x);
  }

  for (const rawTerm of candidateTerms) {
    const term = truncatePackConceptTerm(rawTerm.replace(/\s+/g, " ").trim());
    const key = term.toLowerCase();
    if (isInvalidConceptualDefinitionTerm(term)) continue;
    if (used.has(key)) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = new RegExp(`\\b${escaped}\\b`, "i").exec(lectureText);
    if (!hit || hit.index === undefined) continue;
    const excerptStart = Math.max(0, hit.index - 60);
    const excerptEnd = Math.min(lectureText.length, hit.index + 420);
    const window = lectureText.slice(excerptStart, excerptEnd).replace(/\s+/g, " ").trim();
    const def = compactDefinitionForExamPack(normalizeMathText(window), revisionStyle);
    if (def.length < 32) continue;
    const sourceExcerpt = lectureText.slice(hit.index, Math.min(lectureText.length, hit.index + 160));
    const v = validateLatexSnippet(def.slice(0, 600));
    out.push({
      id: createId("def"),
      term,
      definition: def,
      source: primaryFile,
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(lectureText, hit.index),
      sourceSection: sectionForOffset(sections, hit.index),
      sourceExcerpt,
      importance: "high",
      definitionKind: "conceptual",
      mathStatus: mathStatusFromValidation(v),
      grounding: sourceGroundingPack(primaryFile, pageAtOffset(lectureText, hit.index), sectionForOffset(sections, hit.index), sourceExcerpt),
    });
    used.add(key);
  }

  for (const m of lectureText.matchAll(/\bwe\s+define\s+([^.:;\n]{8,220}?)\s*(?:as|to\s+be)\s+([^.;!\n]{12,360}[.;!])/gi)) {
    const termGuess = (m[1] ?? "").trim();
    const body = (m[2] ?? "").trim();
    const block = `We define ${termGuess} as ${body}`;
    const idx = m.index ?? 0;
    if (termGuess.length < 6 || termGuess.length > 140) continue;
    if (isInvalidConceptualDefinitionTerm(termGuess)) continue;
    const key = termGuess.toLowerCase();
    if (used.has(key)) continue;
    const v = validateLatexSnippet(block.slice(0, 600));
    out.push({
      id: createId("def"),
      term: truncatePackConceptTerm(termGuess.slice(0, 120)),
      definition: compactDefinitionForExamPack(normalizeMathText(block), revisionStyle),
      source: primaryFile,
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(lectureText, idx),
      sourceSection: sectionForOffset(sections, idx),
      sourceExcerpt: block.slice(0, 220),
      importance: "medium",
      definitionKind: "conceptual",
      mathStatus: mathStatusFromValidation(v),
      grounding: sourceGroundingPack(primaryFile, pageAtOffset(lectureText, idx), sectionForOffset(sections, idx), block.slice(0, 320)),
    });
    used.add(key);
  }

  for (const m of lectureText.matchAll(
    /\b((?:[A-Z][a-z]+\s+){1,4}[a-z]+)\s+is\s+(?:called|defined\s+as|said\s+to\s+be)\b[^.!?]{0,200}[.!?]/gi,
  )) {
    const phrase = m[1]?.trim();
    if (!phrase || phrase.length < 10 || phrase.length > 90) continue;
    const key = phrase.toLowerCase();
    if (used.has(key)) continue;
    const block = m[0]?.trim() ?? "";
    if (block.length < 40) continue;
    const idx = m.index ?? 0;
    const v = validateLatexSnippet(block.slice(0, 600));
    out.push({
      id: createId("def"),
      term: truncatePackConceptTerm(phrase),
      definition: compactDefinitionForExamPack(normalizeMathText(block), revisionStyle),
      source: primaryFile,
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(lectureText, idx),
      sourceSection: sectionForOffset(sections, idx),
      sourceExcerpt: block.slice(0, 220),
      importance: "medium",
      definitionKind: "conceptual",
      mathStatus: mathStatusFromValidation(v),
      grounding: sourceGroundingPack(primaryFile, pageAtOffset(lectureText, idx), sectionForOffset(sections, idx), block.slice(0, 320)),
    });
    used.add(key);
  }

  return out;
}

function isInvalidConceptualDefinitionTerm(term: string): boolean {
  const t = term.replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || t.length < 4) return true;
  if (/^(algorithm|exercise|example|proof|remark|proposition|theorem|lemma|corollary)\b/.test(t)) return true;
  if (/\b(pseudocode|input|output|return)\b/.test(t)) return true;
  return false;
}

function proofSkeletonFromBody(title: string, body: string): { skeleton: string; mistake: string } {
  const steps = proofStepsFromBody(body);
  const highSignal = steps.filter((step) =>
    /\b(assume|suppose|let|then|hence|therefore|thus|since|because|so|conclude|it follows|we have|we get|we obtain|show|prove)\b/i.test(step) ||
    /[=∫∑∂≤≥⇒⇔]/.test(step),
  );
  const selected = (highSignal.length >= 2 ? highSignal : steps).slice(0, 5);
  if (selected.length) {
    return {
      skeleton: selected.map((step, i) => `${i + 1}. ${normalizeMathText(step).slice(0, 260)}`).join("\n"),
      mistake: "Do not replace the source proof with a memorised template; check each stated assumption and reproduce the uploaded proof's logical order.",
    };
  }
  return {
    skeleton: `Use the proof body from the source for ${title}; the parsed text was too short or too fragmented to make a reliable outline.`,
    mistake: "Treat this as needs-review: verify the proof against the uploaded notes before relying on it.",
  };
}

function repairMonteCarloProofStatement(title: string, statement: string, proofBody: string): string {
  const blob = `${title}\n${statement}\n${proofBody}`;
  const lower = blob.toLowerCase();
  if (
    /\bmonte\s*carlo\b/.test(lower) &&
    /\bunbiased\b/.test(lower) &&
    /(mc\s+estimator|φ\s*mc|φmc|phimc|hat\s*phi|\\hat\{\\phi\}|\\mathrm\{MC\})/i.test(blob)
  ) {
    return "Let \\(X_1,\\ldots,X_N\\) be i.i.d. samples from \\(p^\\star\\). Then the Monte Carlo estimator \\(\\hat\\phi^N_{\\mathrm{MC}}=\\frac{1}{N}\\sum_{i=1}^N\\phi(X_i)\\) is unbiased, i.e. \\(\\mathbb{E}_{p^\\star}[\\hat\\phi^N_{\\mathrm{MC}}]=\\bar\\phi\\).";
  }
  if (
    /\bmonte\s*carlo\b/.test(lower) &&
    /\bvariance\b/.test(lower) &&
    /(mc\s+estimator|φ\s*mc|φmc|phimc|hat\s*phi|\\hat\{\\phi\}|\\mathrm\{MC\})/i.test(blob)
  ) {
    return "For i.i.d. samples, the Monte Carlo estimator has variance \\(\\operatorname{Var}_{p^\\star}(\\hat\\phi^N_{\\mathrm{MC}})=\\operatorname{Var}_{p^\\star}(\\phi(X))/N\\).";
  }
  return normalizeMathText(statement);
}

function proofStepsFromBody(body: string): string[] {
  const cleaned = body.replace(/\s+/g, " ").trim();
  const sentences = cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z(\\[{])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 16);
  if (sentences.length >= 2) return sentences.slice(0, 14);
  return body
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 16)
    .slice(0, 14);
}

/** Build proof items from theorem/proposition/lemma blocks plus paired Proof bodies only (no orphan Proof paragraphs). */
function blocksToProofs(blocks: LabelledBlock[], proofBlocks: LabelledBlock[], hasPastEvidence: boolean): GeneratedProofItem[] {
  const STMT_KINDS: PackItemKind[] = ["theorem", "proposition", "lemma"];
  const stmtBlocks = blocks.filter((b) => STMT_KINDS.includes(b.kind));

  const items: GeneratedProofItem[] = [];

  for (const b of stmtBlocks) {
    const later = blocks.filter((x) => x.sourceFile === b.sourceFile && x.startOffset > b.startOffset);
    const nextBoundary = later.length ? Math.min(...later.map((x) => x.startOffset)) : Number.POSITIVE_INFINITY;
    const proof = proofBlocks
      .filter((p) => p.sourceFile === b.sourceFile && p.startOffset > b.startOffset && p.startOffset < nextBoundary)
      .sort((a, c) => a.startOffset - c.startOffset)[0];

    if (!proof?.body?.trim() || proof.body.trim().length < 8) continue;

    const heading = `${b.formalLabel}: ${b.displayTitle}`;
    const proofBodyForPack = clipBibliographyFromPackBody(proof.body);
    const { skeleton, mistake } = proofSkeletonFromBody(b.displayTitle, `${b.body}\n${proofBodyForPack}`);
    const statementOnly = clipBibliographyFromPackBody(
      truncateBodyBeforeInteriorSectionHeading(b.body.split(/\bProof\s*[.:]\s*/i)[0]!.trim()),
    );
    if (/^(example|sketch|remark)\b/i.test(statementOnly) || /^consider\s+the\s+following\s+example\b/i.test(statementOnly)) continue;
    if (/\btheorem\s+1\s+for\s+the\s+proof\b/i.test(statementOnly)) continue;

    const repairedStatement = repairMonteCarloProofStatement(b.displayTitle, statementOnly, proofBodyForPack);
    const steps = proofStepsFromBody(proofBodyForPack);

    const proofExcerpt = b.rawBlock.slice(0, 900);
    items.push({
      id: createId("prf"),
      name: heading,
      proofName: heading,
      statement: repairedStatement.slice(0, 1500),
      proofSteps: steps,
      proofSkeleton: `Source proof excerpt: ${normalizeMathText(proofBodyForPack.slice(0, 800))}\n\nExtractive outline:\n${skeleton}`,
      commonMistake: mistake,
      importance: hasPastEvidence ? "must_know" : "needs_review",
      source: b.sourceFile,
      sourceFile: b.sourceFile,
      sourcePage: b.sourcePage,
      sourceSection: b.sourceSection,
      sourceLabel: b.formalLabel,
      sourceExcerpt: proofExcerpt,
      grounding: sourceGroundingPack(b.sourceFile, b.sourcePage, b.sourceSection, proofExcerpt),
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
  // Find positions of step markers like "1:", "2:" even when PDF extraction
  // glues the whole pseudocode block into a single paragraph.
  const stepRe = /(?:^|\n|\s)(\d{1,2})\s*[:.]\s+(?=\S)/g;
  const matches: Array<{ index: number; match: string; step: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(text)) !== null) {
    const step = Number(m[1]);
    if (step < 1 || step > 30) continue;
    matches.push({ index: m.index, match: m[0], step });
  }
  if (matches.length < 2) {
    // Fallback: split on sentences.
    return body
      .split(/(?:\n|;|\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8)
      .map(cleanAlgorithmStepText)
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
    const stepText = cleanAlgorithmStepText(raw);
    if (stepText) steps.push(stepText);
  }
  return steps.slice(0, 16);
}

function cleanAlgorithmStepText(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  t = t.replace(/^pseudocode\s+for\s+[^:]{4,160}\s+/i, "");
  t = t.replace(/\bThe\s+number\s+of\s+samples\s+N\b/i, "sample size \\(N\\)");
  t = normalizeMathText(t);
  t = t.replace(/\s+/g, " ").trim();
  if (/^sample\s+\\?\(?X_i\\?\)?\s*(?:~|\\sim)\s*q(?:\s*\(\s*x\s*\))?.*p\^\\star/i.test(t)) {
    return "Sample \\(X_i\\sim q\\).";
  }
  if (/^compute\s+weights?\b/i.test(t) && /\bp\^\\star/i.test(t) && /\bq\s*\(/i.test(t)) {
    return "Compute weights \\(w_i=p^\\star(X_i)/q(X_i)\\).";
  }
  return t;
}

function repairKnownAlgorithmSteps(title: string, body: string, steps: string[]): string[] {
  const blob = `${title}\n${body}`.toLowerCase();
  if (/\bbasic\s+importance\s+sampling\b/.test(blob) && /\bp\^?\\?star|p\?|\bp\*/i.test(body) && /\bq\b/.test(body)) {
    return [
      "Input proposal \\(q\\), sample size \\(N\\), and test function \\(\\phi\\).",
      "For \\(i=1,\\ldots,N\\), sample \\(X_i\\sim q\\).",
      "Compute importance weight \\(w_i=p^\\star(X_i)/q(X_i)\\).",
      "Return \\(\\hat\\phi^N_{\\mathrm{IS}}=\\frac{1}{N}\\sum_{i=1}^N w_i\\phi(X_i)\\).",
    ];
  }
  if (/\bself[-\s]?normali[sz]ed\s+importance\s+sampling\b|\bsnis\b/.test(blob) && /\bbar\s*p|\\bar\s*p|unnormali/i.test(body)) {
    return [
      "Input unnormalised target \\(\\bar p^\\star\\), proposal \\(q\\), and sample size \\(N\\).",
      "For \\(i=1,\\ldots,N\\), sample \\(X_i\\sim q\\) and compute \\(W_i=\\bar p^\\star(X_i)/q(X_i)\\).",
      "Normalise weights with \\(\\bar w_i=W_i/\\sum_{j=1}^N W_j\\).",
      "Return \\(\\hat\\phi^N_{\\mathrm{SNIS}}=\\sum_{i=1}^N \\bar w_i\\phi(X_i)\\).",
    ];
  }
  return steps;
}

function algorithmBlocksToMethods(blocks: LabelledBlock[]): GeneratedMethodTemplate[] {
  const textBlob = blocks.map((b) => b.body).join("\n").toLowerCase();
  const markovPresent = /\b(markov|transition\s+matrix|mcmc|gibbs|metropolis|detailed\s+balance)\b/i.test(textBlob);
  const monteCarloPresent = /\b(monte\s*carlo|importance\s+sampling|snis|self[-\s]?normali)\b/i.test(textBlob);

  const algos = blocks.filter((b) => b.kind === "algorithm");
  const methods: GeneratedMethodTemplate[] = algos.map((b) => {
    const headLine = b.body.split("\n")[0] ?? "";
    const cleanTitle =
      b.parenTitle?.trim() && b.parenTitle.trim().length > 3
        ? b.parenTitle.trim()
        : cleanAlgorithmTitle(b.displayTitle || headLine || b.body);
    const steps = cleanAlgorithmSteps(truncateAlgorithmBody(b.body)).map((s) => normalizeMathText(s));
    const repairedSteps = repairKnownAlgorithmSteps(cleanTitle, b.body, steps);
    return {
      id: createId("meth"),
      problemType: `${b.formalLabel}: ${cleanTitle}`,
      steps: repairedSteps,
      triggerWords: [cleanTitle, ...(markovPresent ? (["MCMC", "Metropolis", "Gibbs"] as const) : [])].filter(Boolean),
      relatedPracticeType: "Exam-style algorithm recall",
    };
  });
  const extras: Array<{ title: string; steps: string[]; triggers: string[]; requiresMarkovContext?: boolean; requiresMonteCarlo?: boolean }> =
    [
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
      requiresMonteCarlo: true,
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
    if (ex.requiresMonteCarlo && !monteCarloPresent) continue;
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

function shouldPreferSectionCourseMap(chapterCount: number, sections: ExtractedSection[]): boolean {
  if (chapterCount === 0 || sections.length === 0) return true;
  const dottedSections = sections.filter((s) => /^\d+\.\d+/.test(s.sectionNumber));
  if (!dottedSections.length) return false;
  return sections.length >= Math.max(chapterCount + 2, 4);
}

// ---------------------------------------------------------------------------
// Pack assembly
// ---------------------------------------------------------------------------

function buildRichCourseMap(
  profile: DocumentProfile,
  definitions: GeneratedDefinitionItem[],
  formulas: GeneratedFormulaItem[],
  derivations: GeneratedDerivationItem[],
): CourseMapChapterEntry[] {
  if (!profile.chapterMap.length) return [];
  return profile.chapterMap.map((ch) => {
    const mustKnowDefinitions = definitions
      .filter((d) => {
        const p = d.sourcePage;
        if (p != null && p >= ch.startPage && p <= ch.endPage) return true;
        return ch.sectionHeadings.some((h) => (d.sourceSection ?? "").includes(h.slice(0, 36)));
      })
      .map((d) => d.term)
      .slice(0, 28);
    const mustKnowFormulas = formulas
      .filter((f) => {
        const p = f.sourcePage;
        return p != null && p >= ch.startPage && p <= ch.endPage;
      })
      .map((f) => f.name)
      .slice(0, 28);
    const weight = mustKnowDefinitions.length + mustKnowFormulas.length;
    const examRisk: CourseMapChapterEntry["examRisk"] = weight > 14 ? "high" : weight > 6 ? "medium" : "low";
    const workedExamples = derivations
      .filter((d) => {
        const p = d.sourcePage;
        if (p == null) return ch.sectionHeadings.some((h) => d.title.includes(h.slice(0, 20)));
        return p >= ch.startPage && p <= ch.endPage;
      })
      .map((d) => d.title)
      .slice(0, 12);
    return {
      chapter: /chapter/i.test(ch.chapterLabel) ? ch.chapterLabel : `Chapter ${ch.chapterLabel}`,
      title: ch.chapterTitle,
      coreTopics: ch.sectionHeadings.slice(0, 20),
      mustKnowDefinitions,
      mustKnowFormulas,
      workedExamples,
      examRisk,
    };
  });
}

function dedupeDerivations(items: GeneratedDerivationItem[]): GeneratedDerivationItem[] {
  const out: GeneratedDerivationItem[] = [];
  for (const d of items) {
    if (out.some((x) => jaccardSimilarity(x.summary, d.summary) > 0.88)) continue;
    out.push(d);
    if (out.length >= 36) break;
  }
  return out;
}

function extractDerivationCards(text: string, primaryFile: string, sections: ExtractedSection[]): GeneratedDerivationItem[] {
  const out: GeneratedDerivationItem[] = [];

  const pushChunk = (title: string, body: string, offset: number, type: NonNullable<GeneratedDerivationItem["type"]>) => {
    if (body.length < 48) return;
    const steps = body
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 14)
      .slice(0, 26);
    const excerpt = body.slice(0, 820);
    out.push({
      id: createId("der"),
      title: title.slice(0, 180),
      summary: body.slice(0, 520).replace(/\s+/g, " ").trim(),
      type,
      steps,
      keySteps: steps.slice(0, 14),
      problemStatement: body.split(/\n\s*\n/)[0]?.trim().slice(0, 520),
      finalResult: steps.slice(-3).join(" ")?.slice(0, 400),
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(text, offset),
      sourceSection: sectionForOffset(sections, offset),
      sourceExcerpt: excerpt,
      groundingConfidence: /\b(hence|therefore|show\s+that|thus|stationar|invertibil)/i.test(body) ? 0.84 : 0.7,
    });
  };

  const patterns: Array<{ re: RegExp; type: NonNullable<GeneratedDerivationItem["type"]> }> = [
    {
      re: /(?:^|\n)\s*(Worked\s+example\s*:[^\n]+)\n([\s\S]{60,14000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Worked\s+example|Definition\s+\d|Theorem\s+\d|Proposition\s+\d)\b)/gi,
      type: "worked_example",
    },
    {
      re: /(?:^|\n)\s*(Example\s*:[^\n]+)\n([\s\S]{40,9000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Worked\s+example|Example\s*:|Exercise\s+\d)\b)/gi,
      type: "worked_example",
    },
    {
      re: /(?:^|\n)\s*(Proof\s*[.:]\s*[^\n]*)\n([\s\S]{40,12000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Proof\s*[.:]|Theorem\s+\d|Lemma\s+\d)\b)/gi,
      type: "proof",
    },
    {
      re: /(?:^|\n)\s*((?:Show\s+that|Suppose\s+that)[^\n]{8,200})\n([\s\S]{60,12000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Show\s+that|Worked\s+example)\b)/gi,
      type: "derivation",
    },
    {
      re: /(?:^|\n)\s*((?:Hence|Therefore|Thus|So),?[^\n]{4,220})\n([\s\S]{60,14000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Hence|Therefore|Worked\s+example|Proof\s*[.:])\b)/gi,
      type: "derivation",
    },
  ];

  for (const { re, type } of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const title = (m[1] ?? "").trim().slice(0, 180);
      const body = (m[2] ?? "").trim();
      pushChunk(title || type, body, m.index ?? 0, type);
      if (out.length >= 48) break;
    }
  }

  return dedupeDerivations(out);
}

function mergeProofsAndDerivations(proofs: GeneratedProofItem[], derivations: GeneratedDerivationItem[]): GeneratedDerivationItem[] {
  const fromProofs: GeneratedDerivationItem[] = proofs.map((p) => ({
    id: `merged-${p.id}`,
    title: p.name,
    summary: p.statement.slice(0, 520),
    type: "proof" as const,
    steps: p.proofSteps,
    keySteps: p.proofSteps?.slice(0, 14),
    problemStatement: p.statement.slice(0, 420),
    finalResult: p.proofSkeleton.split("\n").at(-1)?.slice(0, 360),
    sourceFile: p.sourceFile,
    sourcePage: p.sourcePage ?? null,
    sourceSection: p.sourceSection ?? null,
    sourceExcerpt: (p.sourceExcerpt ?? p.statement).slice(0, 900),
    groundingConfidence: 0.78,
  }));
  return dedupeDerivations([...fromProofs, ...derivations]);
}

function harvestWorkedExampleCards(text: string, primaryFile: string, sections: ExtractedSection[]): DebugExtractedExampleExercise[] {
  const out: DebugExtractedExampleExercise[] = [];
  const re = /(?:^|\n)\s*(Worked\s+example\s*:[^\n]+)\n([\s\S]{40,6000}?)(?=\n\s*(?:Chapter\s+\d+|\d+(?:\.\d+)+\s+[A-Za-z]|Worked\s+example)\b)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[1]!.trim().slice(0, 160);
    const body = normalizeMathText(m[2]!.trim());
    const offset = m.index ?? 0;
    out.push({
      id: createId("wex"),
      kind: "example",
      title,
      body,
      sourceFile: primaryFile,
      sourcePage: pageAtOffset(text, offset),
      sourceSection: sectionForOffset(sections, offset),
      sourceExcerpt: `${title}\n${body.slice(0, 400)}`,
      groundingConfidence: 0.82,
    });
    if (out.length >= 40) break;
  }
  return out;
}

function filterStaleFormulas(formulas: GeneratedFormulaItem[], sourceLower: string): GeneratedFormulaItem[] {
  return formulas.filter((f) => !isStaleVersusSource(`${f.name}\n${f.latex}\n${f.whenToUse}`.toLowerCase(), sourceLower));
}

function filterStaleMethods(methods: GeneratedMethodTemplate[], sourceLower: string): GeneratedMethodTemplate[] {
  return methods.filter((m) => !isStaleVersusSource(`${m.problemType}\n${m.steps.join("\n")}\n${m.triggerWords.join(" ")}`.toLowerCase(), sourceLower));
}

function filterStaleMistakes(mistakes: GeneratedCommonMistake[], sourceLower: string): GeneratedCommonMistake[] {
  return mistakes.filter((m) => !isStaleVersusSource(`${m.mistake}\n${m.howToAvoid}\n${m.whyItHappens}`.toLowerCase(), sourceLower));
}

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
  const cleanedCombined = applyMathNormalisation(cleanUploadedStudySourceText(combinedLectureText.replace(/\r\n/g, "\n")));
  const layers = splitDocumentTextLayers(cleanedCombined);
  const extractionBase =
    layers.printedText.replace(/\s+/g, " ").trim().length > 400 ? layers.printedText : cleanedCombined;
  const cleanedPrintedFallback = applyMathNormalisation(cleanUploadedStudySourceText(extractionBase.replace(/\r\n/g, "\n")));

  const primaryStem =
    files.find((f) => f.role === "lecture_notes")?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") ??
    primaryName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

  const flatPagesRaw = flattenLectureFilesToFlatPages(lectureFiles);
  const normalizedFlat = flatPagesRaw.map((p) => ({
    pageNumber: p.pageNumber,
    text: sanitiseExtractedText(applyMathNormalisation(cleanUploadedStudySourceText(p.text.replace(/\r\n/g, "\n")))),
  }));
  const syntheticSingle =
    !normalizedFlat.length && lectureFiles[0]?.parsedText ?
      [
        {
          pageNumber: 1,
          text: sanitiseExtractedText(
            applyMathNormalisation(cleanUploadedStudySourceText((lectureFiles[0].parsedText ?? "").replace(/\r\n/g, "\n"))),
          ),
        },
      ]
    : [];

  const pagesForModel = normalizedFlat.length ? normalizedFlat : syntheticSingle.length ? syntheticSingle : [{ pageNumber: 1, text: cleanedPrintedFallback }];
  const pageRecords = buildPageRecordsFromParsedPages(pagesForModel, {
    fileId: lectureFiles[0]?.id ?? "local",
    fileName: primaryStem,
  });
  const cleanedPrinted = pageRecordsToMarkedFullText(primaryStem, pageRecords);
  const rawExamBuckets = extractRawExamPackCandidates(primaryStem, pageRecords);

  let documentProfile = profileDocument({
    cleanedPages: pagesForModel,
    combinedPrintedText: cleanedPrinted,
    sourceFileStem: primaryStem,
  });

  const { accepted: headingCandidates, rejected: rejectedHeadingCandidates } = detectHeadingsByPageWithRejections(pageRecords);
  const headingTree = buildHeadingHierarchy(headingCandidates);
  const headingHierarchySummary = summarizeHeadingHierarchy(headingTree);
  const tocResult = documentProfile.tocParseResult;
  const preferToc = (tocResult?.entries?.filter((e) => e.startPage != null).length ?? 0) >= 3;
  const { chapterMap: unifiedChapterMap, validation: chapterRangeValidation, source } = buildChapterMap({
    tocEntries: tocResult?.entries ?? [],
    tocFound: tocResult?.found ?? false,
    headingCandidates,
    pageCount: documentProfile.pageCount,
    preferToc,
  });
  let chapterMapSource = source;
  if (
    unifiedChapterMap.length >= 2 &&
    chapterMapSource === "heading_scan" &&
    headingCandidates.length === 0
  ) {
    chapterMapSource = tocResult?.found ? "toc" : "manual_fallback";
  }

  if (
    unifiedChapterMap.length >= 2 &&
    (unifiedChapterMap.length >= documentProfile.chapterMap.length || chapterRangeValidation.ok || chapterMapSource !== "none")
  ) {
    documentProfile = {
      ...documentProfile,
      chapterMap: unifiedChapterMap,
      chapterMapSource,
      warnings: [...documentProfile.warnings, ...chapterRangeValidation.errors, ...chapterRangeValidation.warnings],
    };
  }

  const pageCountForBlocks = documentProfile.pageCount;
  let sectionBlocks: SectionBlock[] = [];

  const semanticBlocks = buildSemanticSectionBlocksFromHeadingCandidates(
    pageRecords,
    headingCandidates,
    documentProfile.chapterMap,
    primaryStem,
  );
  if (semanticBlocks.length >= 2) {
    sectionBlocks = semanticBlocks;
  } else if (documentProfile.chapterMap.length >= 2) {
    sectionBlocks = buildSectionBlocksPageAware(documentProfile.chapterMap, headingCandidates, pageRecords, primaryStem);
  }
  if ((!sectionBlocks.length || sectionBlocks.length < 3) && documentProfile.chapterMap.length >= 2) {
    const fromMap = buildSectionBlocksFromChapterMap(
      cleanedPrinted,
      documentProfile.chapterMap,
      primaryStem,
      pageCountForBlocks,
    );
    if (fromMap.length > sectionBlocks.length) sectionBlocks = fromMap;
  }
  if ((!sectionBlocks.length || sectionBlocks.length < 3) && headingCandidates.length < 4) {
    const fromStructural = buildSectionBlocks(cleanedPrinted, primaryStem);
    if (fromStructural.length > sectionBlocks.length) sectionBlocks = fromStructural;
  }
  if (!sectionBlocks.length) {
    sectionBlocks = buildSectionBlocks(cleanedPrinted, primaryStem);
  }
  if (pageCountForBlocks > 28 && sectionBlocks.length < 10 && headingCandidates.length >= 4 && semanticBlocks.length < 2) {
    const fromGraph = buildSectionBlocksFromHeadingGraph(
      pageRecords,
      headingCandidates,
      primaryStem,
      documentProfile.chapterMap,
    );
    if (fromGraph.length > sectionBlocks.length) sectionBlocks = fromGraph;
  }
  sectionBlocks = ensureMinimumSectionBlocksForLongNotes(
    sectionBlocks,
    cleanedPrinted,
    primaryStem,
    pageCountForBlocks,
    headingCandidates.length,
  );

  const resolvedChapterMapSource =
    documentProfile.chapterMap.length >= 2 ?
      chapterMapSource !== "none" ?
        chapterMapSource
      : documentProfile.chapterMapSource ?? "heading_scan"
    : "none";

  documentProfile = {
    ...documentProfile,
    chapterMapSource: resolvedChapterMapSource === "none" && documentProfile.chapterMap.length >= 2 ? "heading_scan" : resolvedChapterMapSource,
    structureDiagnostics: {
      ...documentProfile.structureDiagnostics,
      titleConfidence: documentProfile.structureDiagnostics?.titleConfidence ?? 0,
      titleSourcePage: documentProfile.structureDiagnostics?.titleSourcePage ?? null,
      pageHeadingCandidateCount: headingCandidates.length,
      sectionBlockCountHint: sectionBlocks.length,
    },
  };

  const sectionsMerged = mergeSectionHeadingsForPack(lectureFiles, cleanedPrinted);
  const sections = extractSectionHeadings(cleanedPrinted);
  const courseContext = cleanedPrinted;

  const allBlocks: LabelledBlock[] = [];
  const allProofBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const raw = applyMathNormalisation(cleanUploadedStudySourceText(f.parsedText ?? ""));
    if (!raw.trim()) continue;
    const split = splitDocumentTextLayers(raw);
    const t = split.printedText.replace(/\s+/g, " ").trim().length > 120 ? split.printedText : raw;
    const fileSections = extractSectionHeadings(t);
    allBlocks.push(...extractLabelledBlocks(t, f.name, fileSections, courseContext));
    allProofBlocks.push(...extractProofBlocks(t, f.name, fileSections));
  }
  let blocks = dedupeLabelledBlocks(allBlocks);
  blocks = filterExampleExerciseByChapterPrefix(blocks, inferChapterMajorPrefixFromFilename(primaryName));
  const proofBlocks = dedupeLabelledBlocks(allProofBlocks);

  const formalDefs = blocksToDefinitions(blocks, settings.revisionStyle);
  const tocHeadingHints = [
    ...(documentProfile.tocParseResult?.headingCandidates ?? []),
    ...documentProfile.chapterMap.map((c) => c.chapterTitle).filter((t) => t.length > 4),
  ];
  const sourceBlobLower = cleanedPrinted.toLowerCase();
  const extractionRejected: Array<{ kind: string; reason: string; detail?: string }> = [];
  let definitions = dedupeDefinitions([
    ...formalDefs,
    ...harvestConceptualDefinitions(cleanedPrinted, primaryName, sections, formalDefs, documentProfile, tocHeadingHints, settings.revisionStyle),
  ]);
  definitions = stripPackItemsFailingGrounding(definitions, sourceBlobLower, "definition", extractionRejected);

  const cleanText = cleanedPrinted;
  const whenHint = defaultFormulaWhenToUse(cleanText);
  const lineFormulas = extractFormulaLines(cleanText, primaryName, sections, whenHint);
  const canonicalFormulas = extractCanonicalFormulas(cleanText, primaryName, sections);
  const blockFormulas = extractFormulasFromBlocks(blocks, primaryName);
  const cueFormulas = extractCueAdjacentFormulaLines(cleanText, primaryName, sections, whenHint);
  const heuristicLineCandidates = Math.max(countFormulaLikeLines(cleanText), rawExamBuckets.formulaLineScanCount);
  const formulaCandidatesPreDedupe = Math.max(
    heuristicLineCandidates,
    canonicalFormulas.length + blockFormulas.length + lineFormulas.length + cueFormulas.length,
    rawExamBuckets.formulaCandidates.length,
  );
  const pageCount = documentProfile.pageCount;
  const maxFormulas = pageCount < 15 ? 90 : pageCount <= 50 ? 150 : 220;
  const mergedFormulas = dedupeFormulas(
    [...canonicalFormulas, ...blockFormulas, ...lineFormulas, ...cueFormulas],
    maxFormulas,
  );
  let formulas = filterFormulasForChapterContext(mergedFormulas, cleanText);
  const afterChapterFilter = formulas;
  formulas = filterStaleFormulas(formulas, sourceBlobLower);
  for (const f of afterChapterFilter) {
    if (!formulas.some((x) => x.id === f.id)) {
      extractionRejected.push({
        kind: "formula",
        reason: "stale_or_ungrounded_template_or_topic_mismatch",
        detail: f.name.slice(0, 160),
      });
    }
  }
  formulas = stripPackItemsFailingGrounding(formulas, sourceBlobLower, "formula", extractionRejected);

  let proofs = blocksToProofs(blocks, proofBlocks, hasPastEvidence);
  proofs = dedupeProofs(proofs);
  proofs = stripPackItemsFailingGrounding(proofs, sourceBlobLower, "proof", extractionRejected);

  const derivations = extractDerivationCards(cleanedPrinted, primaryName, sections);
  const proofsAndDerivations = mergeProofsAndDerivations(proofs, derivations);
  const workedExamplesHarvest = harvestWorkedExampleCards(cleanedPrinted, primaryName, sections);

  let methods = algorithmBlocksToMethods(blocks);
  methods = filterStaleMethods(methods, sourceBlobLower);

  const inferredTitle = inferCourseTitleFromNotes(primaryStem, documentProfile);
  const chapterTitle = documentProfile.courseName ?? documentProfile.title ?? inferredTitle;

  let courseMap: GeneratedCourseTopic[] = [];
  if (documentProfile.chapterMap.length) {
    const names = files.filter((f) => f.role === "lecture_notes" || !f.role).map((f) => f.name);
    const chapterTopics = documentProfile.chapterMap.map((ch) => ({
      id: createId("topic"),
      title: `${ch.chapterLabel}: ${ch.chapterTitle}`.replace(/^\s*:\s*/, "").trim(),
      sourceFileNames: names.length ? names : files.map((f) => f.name),
      importance: "high" as TopicImportance,
      evidenceReason: documentProfile.tocParseResult?.found ?
        "Parsed from table of contents (primary structure)."
      : "Chapter / section headings detected in lecture text.",
    }));
    const sectionTopics = courseTopicsFromSections(files, sectionsMerged);
    courseMap = shouldPreferSectionCourseMap(documentProfile.chapterMap.length, sectionsMerged) ? sectionTopics.slice(0, 40) : chapterTopics;
  } else {
    courseMap = courseTopicsFromSections(files, sectionsMerged);
    if (!courseMap.length) courseMap = guessTopicsFallback(files);
  }

  const lowerCtx = cleanedPrinted.toLowerCase();
  let mistakes: GeneratedCommonMistake[] = [
    {
      id: createId("mis"),
      mistake: "Applying a theorem or formula without checking its hypotheses",
      whyItHappens: "Conditions are often stated pages before the result you quote.",
      howToAvoid: "List hypotheses explicitly before using a formula or limit theorem.",
    },
  ];
  if (/\b(proof|show\s+that|derive)\b/i.test(lowerCtx)) {
    mistakes.push({
      id: createId("mis"),
      mistake: "Skipping logical structure in proof-style answers",
      whyItHappens: "Markers reward stated assumptions and clear intermediate steps.",
      howToAvoid: "State assumptions first, then one short sentence per main step.",
    });
  }

  mistakes = filterStaleMistakes(mistakes, sourceBlobLower);

  const assessmentText = files
    .filter((f) => ["exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "mark_scheme"].includes(f.role ?? ""))
    .map((f) => f.parsedText ?? "")
    .join("\n\n");
  const patterns = buildPastPaperPatterns(assessmentText, hasPastEvidence, settings);

  const courseMapChapters = buildRichCourseMap(documentProfile, definitions, formulas, derivations);

  const cramFormulaSource = formulas.filter(
    (f) => !/^algorithm\s+\d/i.test(f.sourceLabel ?? "") && !/^algorithm\s+\d/i.test(f.name) && !/\bpseudocode\b/i.test(f.name),
  );

  const cram: GeneratedCramSheet = {
    definitionBullets: definitions.slice(0, 12).map((d) => `${d.formalLabel ?? d.term}: ${d.definition.slice(0, 100)}${d.definition.length > 100 ? "…" : ""}`),
    formulaBullets: cramFormulaSource.slice(0, 12).map((f) => `${f.name}: ${f.latex}`),
    proofSkeletonBullets: proofs.slice(0, 10).map((p) => `${p.name}: ${p.proofSkeleton.split("\n")[0]!.slice(0, 200)}`),
    trapBullets: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const exampleCandidateCount =
    sectionBlocks.reduce((n, b) => n + (b.exampleCandidates?.length ?? 0) + (b.exerciseCandidates?.length ?? 0), 0) +
    workedExamplesHarvest.length;

  const generatedItemStatsBySection: Record<string, { definitions: number; formulas: number; proofs: number }> = {};
  for (const b of sectionBlocks) {
    const k = b.heading.replace(/\s+/g, " ").slice(0, 80) || b.sectionId;
    generatedItemStatsBySection[k] = {
      definitions: b.definitionCandidates?.length ?? 0,
      formulas: b.formulaCandidates?.length ?? 0,
      proofs: b.proofCandidates?.length ?? 0,
    };
  }

  const excerptMissing =
    definitions.filter((d) => !String(d.sourceExcerpt ?? d.grounding?.sourceExcerpt ?? "").trim()).length +
    formulas.filter((f) => !String(f.sourceExcerpt ?? f.grounding?.sourceExcerpt ?? "").trim()).length +
    proofs.filter((p) => !String(p.sourceExcerpt ?? p.grounding?.sourceExcerpt ?? "").trim()).length;

  const commonExamQuestionTypes = inferExamQuestionTypesFromSource(cleanedPrinted);

  const examPack: ExamPackBundle = {
    courseMap,
    chapterSummaries: documentProfile.chapterMap.map((ch) => `${ch.chapterTitle} — pp. ${ch.startPage}–${ch.endPage}`),
    mustKnowDefinitions: definitions.filter((d) => d.importance === "must_know").map((d) => d.term).slice(0, 96),
    mustKnowFormulas: formulas.slice(0, 96).map((f) => f.name),
    proofChecklist: proofs.map((p) => p.proofName ?? p.name),
    methodTemplates: methods,
    workedExamples: workedExamplesHarvest,
    commonExamQuestionTypes,
    practiceQuestions: buildMinimalPracticePreview(definitions, formulas, proofs, primaryName),
    formulaSheet: cram.formulaBullets,
    theoremSheet: proofs.slice(0, 48).map((p) => `${p.name}: ${p.statement.slice(0, 280)}`),
    lastMinuteCramSheet: cram,
    weakSpotWarnings: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const topActionableIssues: string[] = [];
  if (documentProfile.criticalTocParseFailure) {
    topActionableIssues.push(
      "Table of contents detected on early pages but chapterMap is empty — extraction cannot segment by chapters (critical).",
    );
  }
  if (!documentProfile.title && !documentProfile.courseName) {
    topActionableIssues.push("Document profile failed: title/courseName null — check first pages after PDF extraction.");
  }
  if (documentProfile.hasTableOfContents && documentProfile.chapterMap.length < 3) {
    topActionableIssues.push("Table of contents signal present but chapterMap is sparse — TOC lines may be merged.");
  }
  if (documentProfile.chapterMap.length >= 5 && sectionBlocks.length < documentProfile.chapterMap.length * 0.4) {
    topActionableIssues.push("Section blocks far fewer than TOC rows — page markers may be missing or TOC parse incomplete.");
  }
  if (sectionsMerged.length === 0 && documentProfile.chapterMap.length === 0 && documentProfile.pageCount > 25) {
    topActionableIssues.push("headingCandidateCount effectively zero — improve PDF text layout or heading regex coverage.");
  }
  if (formulaCandidatesPreDedupe === 0 && documentProfile.pageCount > 12) {
    topActionableIssues.push("formulaCandidateCount is zero despite long notes — formula line heuristics found no math-like rows.");
  }
  if (definitions.length < 10 && documentProfile.pageCount > 50) {
    topActionableIssues.push("Very few definitions for 50+ pages — expand labelled blocks or conceptual harvesting.");
  }

  const normalizedPrefixes = sectionBlocks.map((b) => b.text.replace(/\s+/g, " ").slice(0, 300));
  const duplicateOpeningSlices =
    normalizedPrefixes.some(
      (p, i) => p.length > 50 && normalizedPrefixes.findIndex((x) => x === p) !== i,
    );
  if (duplicateOpeningSlices) {
    topActionableIssues.push("Section blocks share the same opening text — page-aware slicing may be misaligned.");
  }

  const chapterRangeValidationFinal = validateChapterMap(documentProfile.chapterMap, pageCountForBlocks);

  const extractionPipelineDiagnostics: ExtractionPipelineDiagnostics = {
    frontMatter: documentProfile.frontMatter,
    rawHeadingCandidates: headingCandidates.slice(0, 200).map((h) => ({
      text: h.text.slice(0, 200),
      normalizedText: h.normalizedText,
      pageNumber: h.pageNumber,
      lineIndex: h.lineIndex,
      headingType: h.headingType,
      level: h.level,
      confidence: h.confidence,
      ...(h.rejectionReason ? { rejectionReason: h.rejectionReason } : {}),
    })),
    rejectedHeadingCandidates: rejectedHeadingCandidates.slice(0, 400).map((r) => ({
      text: r.text.slice(0, 200),
      pageNumber: r.pageNumber,
      lineIndex: r.lineIndex,
      rejectionReason: r.rejectionReason,
    })),
    headingHierarchySummary,
    formulaCandidateCount: formulaCandidatesPreDedupe,
    formulaRawEquationCount: rawExamBuckets.formulaRawEquationCount,
    formulaExtractedCount: formulas.length,
    formulaRejectedCount: Math.max(0, formulaCandidatesPreDedupe - formulas.length),
    formulaRejectionReasons: [...new Set(extractionRejected.filter((r) => r.kind === "formula").map((r) => r.reason))],
    conceptCandidateCount:
      rawExamBuckets.conceptCandidates.length +
      rawExamBuckets.definitionCandidates.length +
      rawExamBuckets.theoremCandidates.length +
      blocks.filter((b) => b.kind === "definition").length +
      sectionsMerged.length +
      (documentProfile.chapterMap?.length ?? 0) +
      rawExamBuckets.exerciseCandidates.length,
    definitionCandidateCount: rawExamBuckets.definitionCandidates.length,
    theoremCandidateCount: rawExamBuckets.theoremCandidates.length,
    headingCandidateCount: Math.max(sectionsMerged.length, headingCandidates.length),
    pageHeadingCandidateCount: headingCandidates.length,
    sectionBlockCount: sectionBlocks.length,
    chapterCandidateCount: documentProfile.chapterMap.length,
    chapterMapSource: documentProfile.chapterMapSource ?? resolvedChapterMapSource,
    chapterRangeValidation: {
      ok: chapterRangeValidationFinal.ok,
      errors: chapterRangeValidationFinal.errors,
      warnings: chapterRangeValidationFinal.warnings,
    },
    sectionBlocksSummary: { count: sectionBlocks.length, duplicateOpeningSlices },
    sectionBlocksSummaryHeadings: sectionBlocks.map((b) => b.heading.replace(/\s+/g, " ").trim().slice(0, 120)).slice(0, 120),
    workedExampleCandidateCount:
      workedExamplesHarvest.length +
      derivations.filter((d) => d.type === "worked_example").length +
      rawExamBuckets.workedExampleCandidates.length,
    proofLikeMarkerLineCount: countProofLikeLineMarkers(pageRecords),
    rawExerciseCandidateCount: rawExamBuckets.exerciseCandidates.length,
    exerciseCandidateCount: rawExamBuckets.exerciseCandidates.length,
    proofCandidateCount: rawExamBuckets.proofCandidates.length,
    exampleCandidateCount,
    rawCandidateSnippets: {
      formulas: (() => {
        const rows = rawExamBuckets.formulaCandidates;
        if (rows.length) return rows.slice(0, 24).map((c) => c.rawText.replace(/\s+/g, " ").trim().slice(0, 220));
        if (formulaCandidatesPreDedupe === 0) return [];
        return mergedFormulas
          .slice(0, 24)
          .map((f) => (f.rawFormula ?? f.formulaPlain ?? f.latex ?? "").replace(/\s+/g, " ").trim().slice(0, 220))
          .filter(Boolean);
      })(),
      proofs: (() => {
        const rows = rawExamBuckets.proofCandidates;
        if (!rows.length) return [];
        return rows.slice(0, 14).map((c) => c.rawText.replace(/\s+/g, " ").trim().slice(0, 280));
      })(),
      workedExamples: (() => {
        const rows = rawExamBuckets.workedExampleCandidates;
        if (!rows.length) return [];
        return rows.slice(0, 10).map((c) => c.rawText.replace(/\s+/g, " ").trim().slice(0, 280));
      })(),
      definitions: (() => {
        const rows = rawExamBuckets.definitionCandidates;
        if (!rows.length) return [];
        return rows.slice(0, 12).map((c) => c.rawText.replace(/\s+/g, " ").trim().slice(0, 220));
      })(),
      concepts: (() => {
        const rows = rawExamBuckets.conceptCandidates;
        if (!rows.length) return [];
        return rows.slice(0, 12).map((c) => c.rawText.replace(/\s+/g, " ").trim().slice(0, 220));
      })(),
    },
    rejectedItems: extractionRejected.slice(0, 400),
    rejectionReasons: [...new Set(extractionRejected.map((r) => r.reason))],
    sourceGroundingSummary: {
      itemsWithExcerpt: definitions.length + formulas.length + proofs.length - excerptMissing,
      itemsMissingExcerpt: excerptMissing,
      contaminationFlags: 0,
    },
    generatedItemStatsBySection,
    extractionPipelineTrace: [
      "flatten_multi_file_pages → PageRecord",
      "profileDocument + TOC.entries",
      "buildChapterMap(toc|heading_scan) + chapterRangeValidation",
      "buildSectionBlocksPageAware | chapterMap | structural_fallback",
      "labelled_blocks + proof_blocks",
      "formula_pipeline(canonical + blocks + lines + cues)",
      "source_grounding_filter",
      "derivation_and_worked_example_harvest",
      "examPack_bundle",
    ],
    topActionableIssues,
  };

  const overview = {
    courseName: chapterTitle,
    summary: `Structured locally from ${files.length} file(s): ${definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term)).length} definitions · ${formulas.length} formulas · ${proofs.length} proof cards · ${proofsAndDerivations.length} proofs/derivations (merged) · ${methods.length} methods.`,
    likelyExamStructure: buildExamStructureFromProfile(documentProfile, hasPastEvidence),
    highPriorityTopics: documentProfile.detectedTopics.slice(0, 16),
  };

  return {
    generatedAt: new Date().toISOString(),
    examOverview: overview,
    documentProfile,
    sectionBlocks,
    courseMap,
    courseMapChapters,
    definitions,
    formulas,
    proofs,
    derivations,
    proofsAndDerivations,
    methods,
    pastPaperPatterns: patterns,
    commonMistakes: mistakes,
    cramSheet: cram,
    workedExamples: workedExamplesHarvest,
    extractionPipelineDiagnostics,
    examPack,
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
      const wrappedBl = wrapAsMath(normalized);
      const v = validateLatexSnippet(wrappedBl);
      const excerpt = line.slice(0, 420);
      const sf = b.sourceFile || primarySource;
      out.push({
        id: createId("form"),
        name: `${b.formalLabel}${b.parenTitle ? ` (${b.parenTitle})` : ""}`,
        latex: wrappedBl,
        formulaPlain: line.slice(0, 320),
        rawFormula: line.slice(0, 320),
        cleanedLatex: normalized,
        whenToUse: `Central equation from ${b.formalLabel}.`,
        source: sf,
        sourceFile: sf,
        sourceSection: b.sourceSection,
        sourcePage: b.sourcePage,
        sourceLabel: b.formalLabel,
        sourceExcerpt: excerpt,
        mathStatus: mapFormulaMathStatus(v),
        groundingConfidence: 0.78,
        grounding: sourceGroundingPack(sf, b.sourcePage, b.sourceSection, excerpt),
      });
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
  return out.slice(0, 96);
}

/** Stale-template check: ignore pedagogy / UI phrasing; focus on technical tokens from core fields. */
function packItemStaleCheckBlob(
  item: { name?: string; term?: string; statement?: string; definition?: string; latex?: string; whenToUse?: string },
  kind: string,
): string {
  const latex = (item.latex ?? "").toLowerCase();
  const when = (item.whenToUse ?? "").toLowerCase();
  if (kind === "formula") {
    return [item.name, latex, (item as { formulaPlain?: string }).formulaPlain, (item as { rawFormula?: string }).rawFormula]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
  }
  if (kind === "proof") {
    return [item.name, item.statement, (item as { proofSkeleton?: string }).proofSkeleton?.slice(0, 1200)]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
  }
  if (kind === "definition") {
    return [item.term, item.definition?.slice(0, 2000)].filter(Boolean).join("\n").toLowerCase();
  }
  return [item.name, item.term, item.statement, item.definition, latex].filter(Boolean).join("\n").toLowerCase();
}

function hasSevereMathExtractionDamage(blob: string): boolean {
  return (
    /\\[A-Z](?:_|[)\s]|$)/.test(blob) ||
    /\bp\?(?!\w)/.test(blob) ||
    /[∑Σ]\s*N\s+1\s+N/i.test(blob) ||
    /\bN\s+i\s*=\s*1\b/.test(blob) ||
    /\\\(\s*$|^\s*\\\)/.test(blob) ||
    /(?:\(\s*){2,}X_i|X_i\)\){2,}/.test(blob)
  );
}

function formulaDisplayBlob(item: unknown): string {
  const f = item as { name?: string; latex?: string; cleanedLatex?: string; whenToUse?: string };
  return [f.name, f.latex, f.cleanedLatex, f.whenToUse].filter(Boolean).join("\n");
}

function stripPackItemsFailingGrounding<T extends { sourceExcerpt?: string; grounding?: SourceGrounding }>(
  items: T[],
  sourceLower: string,
  kind: string,
  extractionRejected: Array<{ kind: string; reason: string; detail?: string }>,
): T[] {
  const out: T[] = [];
  for (const item of items) {
    const excerpt = String(item.sourceExcerpt ?? item.grounding?.sourceExcerpt ?? "").trim();
    if (excerpt.length < 8) {
      const it = item as unknown as { name?: string; term?: string };
      extractionRejected.push({
        kind,
        reason: "missing_source_excerpt",
        detail: it.name ?? it.term ?? kind,
      });
      continue;
    }
    if (!excerptGroundedInSource(excerpt, sourceLower)) {
      extractionRejected.push({ kind, reason: "weak_grounding", detail: excerpt.slice(0, 120) });
      continue;
    }
    const staleCheckInput = item as unknown as Parameters<typeof packItemStaleCheckBlob>[0];
    const rawBlob = packItemStaleCheckBlob(staleCheckInput, kind);
    if (kind === "formula" && hasSevereMathExtractionDamage(formulaDisplayBlob(item))) {
      extractionRejected.push({ kind, reason: "broken_math_extraction", detail: formulaDisplayBlob(item).slice(0, 160) });
      continue;
    }
    const staleBlob = stripUiAndPackLabelsForGrounding(
      rawBlob,
    );
    const absent = findProminentTermsAbsentFromSource(staleBlob, sourceLower);
    const technicalAbsent = absent.filter((w) => !APP_SYSTEM_WORD_WHITELIST.has(w.toLowerCase()));
    if (technicalAbsent.length >= 8) {
      extractionRejected.push({
        kind,
        reason: "stale_template_technical_term",
        detail: technicalAbsent.slice(0, 5).join(", "),
      });
      continue;
    }
    if (absent.length >= 6 && technicalAbsent.length <= 2) {
      extractionRejected.push({ kind, reason: "ui_word_false_positive", detail: absent.slice(0, 8).join(", ") });
    }
    out.push(item);
  }
  return out;
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

function buildPastPaperPatterns(assessmentText: string, hasEvidence: boolean, settings: PackGeneratorSettings): GeneratedPastPaperPattern[] {
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
  const questionBlocks = extractAssessmentQuestionPatterns(assessmentText);
  if (questionBlocks.length) return questionBlocks.slice(0, 8);
  return [
    {
      id: createId("pat"),
      title: "Assessment evidence uploaded",
      evidence: "Assessment-class files were included, but clear question stems were not detected in the parsed text.",
      likelyExamStyle: settings.revisionStyle === "problem_heavy" ? "Problem-heavy revision recommended." : "Use uploaded assessment files for manual cross-checking.",
      suggestedPracticeQuestion: "Open the assessment source, pick one question stem, and regenerate after OCR if the text looks incomplete.",
    },
  ];
}

function extractAssessmentQuestionPatterns(assessmentText: string): GeneratedPastPaperPattern[] {
  const text = cleanUploadedStudySourceText(assessmentText.replace(/\r\n/g, "\n"));
  const lines = text.split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: GeneratedPastPaperPattern[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const startsQuestion = /^(?:question|problem|exercise)\s+\d+[A-Za-z]?(?:[).:\s]|$)/i.test(line) || /^(?:\d+|[a-z])\)\s+/.test(line);
    const commandStem = /^(?:show|prove|derive|calculate|compute|find|explain|state|define|estimate|simulate|discuss)\b/i.test(line);
    if (!startsQuestion && !commandStem) continue;
    const body = [line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join(" ").replace(/\s+/g, " ").trim();
    if (body.length < 24) continue;
    const lower = body.toLowerCase();
    const style =
      /\b(show|prove|derive)\b/.test(lower) ? "Proof or derivation question"
      : /\b(calculate|compute|find|estimate|simulate)\b/.test(lower) ? "Calculation or applied method question"
      : /\b(state|define|explain|discuss)\b/.test(lower) ? "Short-answer conceptual question"
      : "Assessment question pattern";
    out.push({
      id: createId("pat"),
      title: style,
      evidence: body.slice(0, 360),
      likelyExamStyle: style,
      suggestedPracticeQuestion: body.length > 220 ? `${body.slice(0, 217).trim()}...` : body,
    });
    i += 2;
  }
  return dedupePastPaperPatterns(out);
}

function dedupePastPaperPatterns(items: GeneratedPastPaperPattern[]): GeneratedPastPaperPattern[] {
  const out: GeneratedPastPaperPattern[] = [];
  for (const item of items) {
    if (out.some((x) => jaccardSimilarity(x.evidence, item.evidence) > 0.82)) continue;
    out.push(item);
  }
  return out;
}

/** Labelled Example / Exercise blocks for debug export (not shown as separate Study Pack tabs today). */
export type DebugExampleExerciseItem = {
  id: string;
  kind: "example" | "exercise";
  title: string;
  formalLabel: string;
  body: string;
  /** First paragraph / problem statement heuristic. */
  problem?: string;
  solutionSummary?: string;
  keyFormulaIds?: string[];
  sourceFile: string;
  sourcePage?: number;
  sourceSection?: string;
  rawBlock: string;
  importance?: DefinitionImportance;
  examTag?: string;
  subQuestions?: Array<{ label: string; text: string }>;
  /** Set when the block matches exam-critical wording (e.g. cited past finals). */
  highPriority?: boolean;
  sourceExcerpt?: string;
  groundingConfidence?: number;
};

function splitExerciseSubQuestions(body: string): Array<{ label: string; text: string }> | undefined {
  const t = body.replace(/\r\n/g, "\n").trim();
  if (t.length < 900) return undefined;
  const chunks = t.split(/\n(?=\s*\(\s*[a-z]\s*\)\s*)/i).filter((c) => c.trim().length > 20);
  if (chunks.length < 2) return undefined;
  const out: Array<{ label: string; text: string }> = [];
  for (const chunk of chunks) {
    const m = chunk.match(/^\s*\(\s*([a-z])\s*\)\s*([\s\S]+)/i);
    if (m) out.push({ label: `(${m[1]!.toLowerCase()})`, text: m[2]!.trim().slice(0, 4000) });
  }
  return out.length >= 2 ? out : undefined;
}

/** Collect Example N / Exercise N blocks from lecture text for JSON export and QA. */
export function extractExampleAndExerciseItemsForDebug(files: LecturePackFile[]): { examples: DebugExampleExerciseItem[]; exercises: DebugExampleExerciseItem[] } {
  const lectureFiles = files.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const courseContext = lectureFiles.map((f) => applyMathNormalisation(cleanUploadedStudySourceText(f.parsedText ?? ""))).join("\n\n");
  const exampleBlocks: LabelledBlock[] = [];
  const exerciseBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const t = applyMathNormalisation(cleanUploadedStudySourceText(f.parsedText ?? ""));
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
    const examReferenced =
      kind === "exercise" && (/\bfinal\s+exam\b/i.test(blob) || /\bexam\s+\d{4}\b/i.test(blob) || /\bpast\s+paper\b/i.test(blob));
    const problem = b.body.split(/\n\s*\n/)[0]?.trim() ?? b.body.trim();
    const subQ = kind === "exercise" ? splitExerciseSubQuestions(b.body) : undefined;
    const excerpt = `${b.formalLabel}\n${problem}`.slice(0, 600);
    const base: DebugExampleExerciseItem = {
      id: createId(kind === "example" ? "ex" : "exe"),
      kind,
      title: b.displayTitle,
      formalLabel: b.formalLabel,
      body: normalizeMathText(b.body),
      problem,
      solutionSummary: undefined,
      keyFormulaIds: [],
      sourceFile: b.sourceFile,
      sourcePage: b.sourcePage,
      sourceSection: b.sourceSection,
      rawBlock: normalizeMathText(b.rawBlock),
      sourceExcerpt: excerpt,
      groundingConfidence: examReferenced ? 0.85 : 0.7,
    };
    if (subQ?.length) base.subQuestions = subQ;
    if (examReferenced) base.highPriority = true;
    return base;
  };
  return {
    examples: dedupeLabelledBlocks(exampleBlocks).map((b) => map(b, "example")),
    exercises: dedupeLabelledBlocks(exerciseBlocks).map((b) => map(b, "exercise")),
  };
}
