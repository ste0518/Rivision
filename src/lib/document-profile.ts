/**
 * Document-level profiling for generic revision-pack generation.
 * All signals are derived from the uploaded file text only.
 */

import { collectStructuralHeadings, type StructuralHeading } from "@/lib/lecture-segmentation";
import { extractSectionHeadingsFromText, mergeExtractedSectionHeadings, type ExtractedSectionHeading } from "@/lib/section-headings";
import { parseTableOfContents, type TocParseResult } from "@/lib/table-of-contents";

export type DocumentType =
  | "lecture_notes"
  | "problem_sheet"
  | "past_paper"
  | "solutions"
  | "formula_sheet"
  | "revision_guide"
  | "mixed"
  | "unknown";

export type ChapterMapEntry = {
  chapterLabel: string;
  chapterTitle: string;
  startPage: number;
  endPage: number;
  sectionHeadings: string[];
};

export type NotationEntry = {
  symbol: string;
  count: number;
  meaningGuess?: string;
};

export type HandwritingNoisePage = {
  page: number;
  noiseScore: number;
  examples: string[];
};

export type DocumentProfile = {
  title: string | null;
  courseName: string | null;
  subjectArea: string | null;
  documentType: DocumentType;
  pageCount: number;
  /** True when a contents/table-of-contents region was detected but no usable chapter rows could be parsed (critical quality gate). */
  criticalTocParseFailure?: boolean;
  chapterMap: ChapterMapEntry[];
  detectedTopics: string[];
  detectedNotation: NotationEntry[];
  /** True when the raw text contains proof-like markers (not extraction success). */
  proofLikeMarkersInSource: boolean;
  handwritingNoisePages: HandwritingNoisePage[];
  hasWorkedExamples: boolean;
  hasExercises: boolean;
  /** @deprecated Prefer proofLikeMarkersInSource — same value for compatibility */
  hasProofs: boolean;
  hasAlgorithms: boolean;
  hasHandwrittenAnnotations: boolean;
  hasTableOfContents: boolean;
  hasChapterHeadings: boolean;
  hasDefinitions: boolean;
  hasLemmas: boolean;
  hasPropositions: boolean;
  hasTheorems: boolean;
  hasProofBlocks: boolean;
  hasExamples: boolean;
  hasFormulas: boolean;
  /** Numbered exam-style questions / past-paper stems (distinct from exercises in notes). */
  hasPastPaperQuestions?: boolean;
  /** Dominant worked answers / mark schemes. */
  hasSolutions?: boolean;
  /** Heuristic 0–1 confidence in profiling signals. */
  confidence: number;
  warnings: string[];
  /** Latest TOC parse (may be empty if no contents page found). */
  tocParseResult?: TocParseResult;
};

export type TextLayers = {
  printedText: string;
  handwrittenText: string;
  noiseText: string;
};

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SOFT_HYPHEN = /\u00ad/g;

/** Strip control chars and soft hyphens for safe matching and display. */
export function sanitiseExtractedText(raw: string): string {
  return raw.replace(CTRL, "").replace(SOFT_HYPHEN, "");
}

function pageNumberFromOffset(fullText: string, offset: number): number {
  let page = 1;
  for (const m of fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((m.index ?? 0) > offset) break;
    page = Number(m[1]) || page;
  }
  return page;
}

function inferPageCount(cleanedPages: Array<{ pageNumber: number; text: string }>, fallbackText: string): number {
  if (cleanedPages.length) return Math.max(...cleanedPages.map((p) => p.pageNumber));
  const marks = [...fallbackText.matchAll(/\[Page\s+(\d+)\]/gi)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n));
  if (marks.length) return Math.max(...marks);
  return 1;
}

/** Heuristic split: printed lecture body vs marginalia / OCR garbage. */
export function splitDocumentTextLayers(fullText: string): TextLayers {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const printed: string[] = [];
  const handwritten: string[] = [];
  const noise: string[] = [];

  const looksLikeNoiseLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    if (t.length <= 2 && /^[A-Za-z0-9]$/.test(t)) return true;
    if (/^[a-z]{1,3}\.{2,}/i.test(t)) return true;
    if (/\bfii+i+n\.?to\b/i.test(t)) return true;
    if (/\bDopulation\b/i.test(t)) return true;
    const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
    const ratio = alnum / Math.max(1, t.length);
    if (t.length < 50 && ratio < 0.35 && /[^\sA-Za-z0-9.,;=+\-()[\]{}]/.test(t)) return true;
    if (t.length < 24 && /^[A-Za-z]\s*$/.test(t)) return true;
    return false;
  };

  const looksHandwrittenMarginalia = (line: string): boolean => {
    const t = line.trim();
    if (t.length < 8 || t.length > 120) return false;
    const words = t.split(/\s+/);
    if (words.length <= 4 && /^[a-z]+$/i.test(t) && t.length < 40) return true;
    const weirdCaps = (t.match(/[a-z][A-Z]/g) ?? []).length >= 2;
    const punctRun = /[!?.]{3,}/.test(t);
    return weirdCaps || punctRun;
  };

  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) {
      printed.push("");
      continue;
    }
    if (looksLikeNoiseLine(t)) {
      noise.push(t);
      continue;
    }
    if (looksHandwrittenMarginalia(t)) {
      handwritten.push(t);
      continue;
    }
    printed.push(line);
  }

  return {
    printedText: printed.join("\n"),
    handwrittenText: handwritten.join("\n"),
    noiseText: noise.join("\n"),
  };
}

/**
 * Classify uploaded PDF text using early-page cues + structure (no filenames).
 * Distinguishes lecture notes from solution sheets: incidental “solution/proof” words in notes must not dominate.
 */
export function classifyDocumentType(
  cleanedPages: Array<{ pageNumber: number; text: string }>,
  combinedPrintedText: string,
): DocumentType {
  const combined = combinedPrintedText.replace(/\r\n/g, "\n");
  const lower = combined.toLowerCase();
  const early =
    cleanedPages.length ?
      cleanedPages
        .slice(0, Math.min(18, cleanedPages.length))
        .map((p) => p.text)
        .join("\n")
        .toLowerCase()
    : combined.slice(0, 45_000).toLowerCase();

  const structural = collectStructuralHeadings(combined);
  const chapterLike = structural.filter((h) => h.kind === "chapter").length;
  const sectionLike = structural.filter((h) => h.kind === "section").length;

  const lectureStructureScore =
    (chapterLike >= 2 ? 5 : chapterLike >= 1 ? 3 : 0) +
    (sectionLike >= 15 ? 5 : sectionLike >= 10 ? 4 : sectionLike >= 6 ? 2 : sectionLike >= 3 ? 1 : 0);

  const lectureCueScore =
    (/\bchapter\s+\d+/i.test(early) ? 3 : 0) +
    (/\d+\.\d+\s+[a-z]/i.test(early) ? 2 : 0) +
    (/\b(lecture\s+notes|course\s+notes|module\s+handout)\b/i.test(lower) ? 3 : 0) +
    (/\b(imperial|department|faculty)\b/i.test(early) && chapterLike >= 1 ? 1 : 0);

  const questionMarksHits = (combined.match(/\b\d+\s*(?:marks?|pts?)\b/gi) ?? []).length;
  const numberedQuestionLines = (combined.match(/(?:^|\n)\s*(?:question|problem)\s+\d{1,2}\s*[.:)]/gi) ?? []).length;

  const examPaperStrong =
    /\b(total\s+marks|minutes\s+allowed|time\s+allowed|candidate\s+number|desk\s+number)\b/i.test(lower) &&
    /\b(final\s+exam|examination|past\s+paper)\b/i.test(lower);

  const problemSheetStrong =
    questionMarksHits >= 10 ||
    (numberedQuestionLines >= 14 && /\b(marks?|points?)\b/i.test(lower)) ||
    (/\b(problem\s+sheet|homework\s*\d|assignment\s*\d|due\s+date)\b/i.test(lower) && numberedQuestionLines >= 8);

  let solutionHeadingScore = 0;
  for (const raw of combined.split("\n")) {
    const s = raw.trim();
    if (s.length > 180) continue;
    if (/worked\s+example/i.test(s)) continue;
    if (/^(solution|solutions)\s+to\b/i.test(s)) solutionHeadingScore += 2;
    else if (/^(solution|solutions)\s*[.:]?\s*$/i.test(s)) solutionHeadingScore += 3;
    else if (/^solution\s+\d+[.:)]/i.test(s)) solutionHeadingScore += 2;
    else if (/^(answer|answers)\s*[.:]?\s*$/i.test(s)) solutionHeadingScore += 2;
    else if (/mark\s+scheme|examiner\s+report|official\s+solutions/i.test(s)) solutionHeadingScore += 4;
  }

  const solutionsDominant =
    solutionHeadingScore >= 16 ||
    (solutionHeadingScore >= 9 && /\b(answer\s+key|official\s+solutions)\b/i.test(lower));

  let lectureStrength = lectureStructureScore + lectureCueScore;
  const openingSlice = combined.slice(0, 18_000);
  if (
    /\b(contents|table\s+of\s+contents)\b/i.test(early) &&
    /\d{1,2}\s+[A-Za-z].{6,120}(?:\.{2,}|…|\s{4,})\s*\d{1,3}/im.test(openingSlice)
  ) {
    lectureStrength += 7;
  }

  const equationHeavy =
    combined.length > 400 &&
    (combined.match(/[=∫∑∏√∂∇]/g) ?? []).length > Math.max(25, combined.length / 90) &&
    (combined.match(/\b(the|and|therefore|because|however)\b/gi) ?? []).length < combined.length / 420;

  const revisionCram =
    /\b(cram|must\s+know|checklist|exam\s+tips|last\s+minute|revision\s+guide|key\s+ideas)\b/i.test(lower) &&
    chapterLike < 2 &&
    lectureStrength < 8;

  if (revisionCram && !examPaperStrong && !solutionsDominant) return "revision_guide";
  if (equationHeavy && !examPaperStrong && lectureStrength < 6 && chapterLike < 2 && !problemSheetStrong) return "formula_sheet";

  if (examPaperStrong && lectureStrength < 7) return "past_paper";
  if (problemSheetStrong && lectureStrength < 8 && !solutionsDominant) return "problem_sheet";

  if (lectureStrength >= 6 || (chapterLike >= 1 && sectionLike >= 8)) return "lecture_notes";
  if (solutionsDominant && lectureStrength < 7) return "solutions";
  if (solutionsDominant && lectureStrength >= 7) return "mixed";
  if (/\bchapter\s+\d+/i.test(combined) || sectionLike >= 5) return "lecture_notes";
  if (problemSheetStrong) return "problem_sheet";
  return "unknown";
}

const ADMIN_TOPIC_STOP = new Set([
  "introduction",
  "module",
  "admin",
  "structure",
  "prerequisites",
  "assessment",
  "handbook",
  "syllabus",
  "contents",
  "appendix",
  "references",
  "bibliography",
]);

/** Short canonical topics from headings + repeated meaningful phrases (no fixed syllabus list). */
function extractDetectedTopicsFromDocument(combined: string, headingTitles: string[]): string[] {
  const topics = new Set<string>();

  for (const raw of headingTitles) {
    const t = raw.replace(/\s+/g, " ").replace(/^[\d.]+/g, "").trim();
    if (t.length < 6 || t.length > 90) continue;
    const words = t
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !ADMIN_TOPIC_STOP.has(w));
    if (words.length === 0) continue;
    const phrase = words.slice(0, 5).join(" ");
    if (phrase.length >= 5 && phrase.length <= 60) topics.add(phrase);
  }

  const slice = combined.slice(0, 220_000).toLowerCase();
  const bigramRe = /\b([a-z][a-z-]{2,})\s+([a-z][a-z-]{2,})\b/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = bigramRe.exec(slice)) !== null) {
    const a = m[1]!;
    const b = m[2]!;
    if (ADMIN_TOPIC_STOP.has(a) || ADMIN_TOPIC_STOP.has(b)) continue;
    const key = `${a} ${b}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const frequent = [...counts.entries()]
    .filter(([, c]) => c >= 4)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 40)
    .map(([k]) => k);
  for (const f of frequent) topics.add(f);

  return [...topics].slice(0, 90);
}

/** Generic subject line from title / early headings only (no fixed course templates). */
function inferSubjectArea(title: string | null, chapterTitles: string[], text: string): string | null {
  if (title && title.length >= 10 && title.length < 180) return title.replace(/\s+/g, " ").trim();
  const firstChapter = chapterTitles.find((c) => c.length >= 8 && c.length < 120);
  if (firstChapter) return firstChapter.replace(/\s+/g, " ").trim().slice(0, 120);
  const early = text.slice(0, 12_000).split("\n").find((l) => {
    const t = l.trim();
    return t.length >= 16 && t.length < 120 && /[a-z]{4,}/i.test(t) && !/^\[Page/i.test(t);
  });
  return early?.trim().slice(0, 120) ?? null;
}

function inferTitleFromFirstPages(text: string): string | null {
  const beforeContents = text.split(/\n\s*Contents\s*\n/i)[0] ?? text;
  const before = beforeContents.split(/\[Page\s+5\]/i)[0] ?? beforeContents;
  const lines = before
    .split("\n")
    .map((l) => sanitiseExtractedText(l).trim())
    .filter(Boolean);

  const skip = (l: string) =>
    /^\[Page\b/i.test(l) ||
    /^\[Source\b/i.test(l) ||
    /^(department|faculty|school)\s+of\b/i.test(l) ||
    (/^(imperial|university|college)\b/i.test(l) && l.length < 100) ||
    /^contents$/i.test(l) ||
    /^table\s+of\s+contents$/i.test(l);

  for (const line of lines) {
    if (skip(line)) continue;
    if (line.length < 12 || line.length > 200) continue;
    if (/^(chapter|section)\s+\d+/i.test(line)) continue;
    const cutAffiliation = (raw: string): string => {
      let t = raw.replace(/\s+/g, " ").trim();
      const idx = t.search(/\b(Department|Faculty|School)\s+of\b/i);
      if (idx > 10) t = t.slice(0, idx).trim();
      const prof = t.search(/\b(Professor|Prof\.|Dr\.)\b/i);
      if (prof > 14) t = t.slice(0, prof).trim();
      return t.replace(/[,\s]+$/u, "").trim();
    };
    const cleaned = cutAffiliation(line);
    if (cleaned.length >= 14 && cleaned.length <= 120) return cleaned;
  }

  const chapterLine = lines.find((l) => /^Chapter\s+\d+/i.test(l) && l.length < 160);
  if (chapterLine) return chapterLine.replace(/\s+/g, " ").trim().slice(0, 120);

  return null;
}

function buildChapterMapFromSections(
  sections: ExtractedSectionHeading[],
  pageCount: number,
  fullText: string,
): ChapterMapEntry[] {
  if (!sections.length) return [];

  const dottedSections = sections.filter((s) => /\d+\.\d+/.test(s.sectionNumber));
  const majorBannerOnly = sections.filter((s) => /^\d+$/.test(s.sectionNumber) || /^Chapter\s+/i.test(s.title));
  /** Prefer x.y / x.y.z headings when present — top-level "3 TITLE" banners alone collapse nuance (e.g. §3.1, §3.2 under Ch.3). */
  let use: ExtractedSectionHeading[];
  if (dottedSections.length >= 3) {
    use = dottedSections;
  } else if (majorBannerOnly.length) {
    use = majorBannerOnly;
  } else {
    use = sections.filter((s) => !s.sectionNumber.includes(".") || s.sectionNumber.split(".").length <= 2);
  }

  const sorted = [...(use.length ? use : sections)].sort((a, b) => a.startOffset - b.startOffset);
  const out: ChapterMapEntry[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    const startPage = pageNumberFromOffset(fullText, cur.startOffset);
    const endPage = next ? Math.max(startPage, pageNumberFromOffset(fullText, next.startOffset) - 1) : pageCount;
    const sectionHeadings = sections
      .filter((s) => s.startOffset >= cur.startOffset && (!next || s.startOffset < next.startOffset))
      .map((s) => `${s.sectionNumber} ${s.title}`.trim())
      .slice(0, 40);

    out.push({
      chapterLabel: cur.sectionNumber || `S${i + 1}`,
      chapterTitle: cur.title,
      startPage,
      endPage: Math.min(pageCount, Math.max(startPage, endPage)),
      sectionHeadings,
    });
  }

  return out.slice(0, 80);
}

function buildChapterMapFromStructuralHeadings(headings: StructuralHeading[], pageCount: number, fullText: string): ChapterMapEntry[] {
  const chapters = headings.filter((h) => h.kind === "chapter");
  if (!chapters.length) return [];

  const sorted = [...chapters].sort((a, b) => a.startOffset - b.startOffset);
  const out: ChapterMapEntry[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const nextCh = sorted[i + 1];
    const startPage = pageNumberFromOffset(fullText, cur.startOffset);
    const endPage = nextCh ? Math.max(startPage, pageNumberFromOffset(fullText, nextCh.startOffset) - 1) : pageCount;

    const sectionHeadings = headings
      .filter((h) => h.kind === "section" && h.startOffset >= cur.startOffset && (!nextCh || h.startOffset < nextCh.startOffset))
      .map((h) => `${h.label} ${h.title}`.trim());

    out.push({
      chapterLabel: cur.label,
      chapterTitle: cur.title,
      startPage,
      endPage: Math.min(pageCount, Math.max(startPage, endPage)),
      sectionHeadings,
    });
  }

  return out.slice(0, 80);
}

const NOTATION_PATTERNS: Array<{ re: RegExp; meaningGuess: string }> = [
  { re: /\bX_t\b/g, meaningGuess: "Time series value at time t" },
  { re: /μ/g, meaningGuess: "Mean" },
  { re: /\\mu\b/g, meaningGuess: "Mean (LaTeX)" },
  { re: /σ/g, meaningGuess: "Std dev / innovation scale" },
  { re: /\\sigma\b/g, meaningGuess: "Std dev (LaTeX)" },
  { re: /\bs_tau\b|\bs_τ\b|γ\s*\(\s*τ\s*\)/gi, meaningGuess: "Autocovariance at lag τ" },
  { re: /\brho_tau\b|ρ_τ|\brho\s*_\s*τ/gi, meaningGuess: "Autocorrelation at lag τ" },
  { re: /\b(?:ε_t|epsilon_t)\b/gi, meaningGuess: "White-noise / innovation term" },
  { re: /\b(?:Φ\(B\)|\\Phi\(B\))/g, meaningGuess: "AR polynomial in backshift" },
  { re: /\b(?:Θ\(B\)|\\Theta\(B\))/g, meaningGuess: "MA polynomial in backshift" },
  { re: /\bB\b(?=\s*\))/g, meaningGuess: "Backshift operator" },
];

function dedupeNotationCounts(combined: string): NotationEntry[] {
  const counts = new Map<string, { count: number; meaningGuess?: string }>();
  for (const { re, meaningGuess } of NOTATION_PATTERNS) {
    re.lastIndex = 0;
    const ms = combined.match(re);
    if (!ms?.length) continue;
    const sym = ms[0]!.replace(/\s+/g, "").slice(0, 24);
    const prev = counts.get(sym);
    const next = (prev?.count ?? 0) + ms.length;
    counts.set(sym, { count: next, meaningGuess: prev?.meaningGuess ?? meaningGuess });
  }
  return [...counts.entries()]
    .map(([symbol, v]) => ({ symbol, count: v.count, meaningGuess: v.meaningGuess }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 48);
}

const NOISE_WORD_RE =
  /\b(T\s+is\s+z|Dopulation|fii+i+n\.?to|antititin|poputation|varience|covarance)\b/i;

function scorePageNoise(pageText: string): { score: number; examples: string[] } {
  const lines = pageText.split("\n").map((l) => l.trim()).filter(Boolean);
  let score = 0;
  const examples: string[] = [];

  for (const ln of lines) {
    if (NOISE_WORD_RE.test(ln)) {
      score += 4;
      if (examples.length < 4) examples.push(ln.slice(0, 120));
      continue;
    }
    if (/^[a-z]{1,3}\.{3,}/i.test(ln)) {
      score += 3;
      if (examples.length < 4) examples.push(ln.slice(0, 120));
      continue;
    }
    const words = ln.split(/\s+/).filter((w) => /^[a-z]{5,}$/i.test(w));
    let weird = 0;
    for (const w of words) {
      if (!/[aeiou]/i.test(w)) weird += 1;
    }
    if (words.length >= 2 && weird / words.length > 0.45) {
      score += 2;
      if (examples.length < 4) examples.push(ln.slice(0, 120));
    }
    if (ln.length <= 4 && /^[A-Za-z]$/.test(ln)) score += 1;
  }

  const symDensity =
    (pageText.match(/[=∑∫∇μσερφθΣ∏√]/g) ?? []).length / Math.max(1, pageText.length / 80);
  if (symDensity > 2.2 && lines.length < 6) score += 2;

  return { score, examples };
}

function computeHandwritingNoisePages(cleanedPages: Array<{ pageNumber: number; text: string }>): HandwritingNoisePage[] {
  const out: HandwritingNoisePage[] = [];
  for (const p of cleanedPages) {
    const { score, examples } = scorePageNoise(p.text);
    if (score >= 4 && examples.length) out.push({ page: p.pageNumber, noiseScore: score, examples });
  }
  return out.slice(0, 120);
}

/** Technical tokens for contamination checks (multi-word phrases and symbols). */
export function buildSourceKeywordSet(sourceLower: string): Set<string> {
  const set = new Set<string>();
  const addPhrase = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length >= 4) set.add(t);
  };

  for (const m of sourceLower.matchAll(/\b[a-z][a-z\-]{2,}(?:\s+[a-z][a-z\-]{2,}){0,4}\b/g)) {
    addPhrase(m[0] ?? "");
  }
  for (const m of sourceLower.matchAll(/\b(?:AR|MA|ARMA|ARIMA|SARIMA|ARCH|VAR|ACF|ACVF)\([^)]*\)/gi)) {
    addPhrase(m[0] ?? "");
  }
  return set;
}

/**
 * Flag generated phrases that introduce prominent topic terms absent from source.
 */
/** Multi-word or symbol-heavy phrases that indicate one course template leaking into another upload. */
export function detectSourceContamination(generatedBlobLower: string, sourceLower: string): string[] {
  const issues: string[] = [];
  const absent = findProminentTermsAbsentFromSource(generatedBlobLower, sourceLower);
  for (const term of absent.slice(0, 16)) {
    issues.push(`Generated text uses “${term}”, which does not appear in the uploaded source — possible stale template or hallucination.`);
  }
  const phrases = generatedBlobLower.match(/\b[a-z]{5,}\s+[a-z]{5,}\s+[a-z]{5,}\b/g) ?? [];
  for (const p of [...new Set(phrases)].slice(0, 12)) {
    if (!sourceLower.includes(p) && p.length >= 18) {
      issues.push(`Generated phrase not grounded in source: “${p.slice(0, 80)}”.`);
    }
  }
  return issues.slice(0, 24);
}

const GENERIC_STOPWORDS = new Set([
  "definition",
  "theorem",
  "proposition",
  "therefore",
  "following",
  "condition",
  "understanding",
  "introduction",
  "techniques",
  "significant",
  "probability",
  "distribution",
  "expectation",
  "variance",
  "function",
  "random",
  "variable",
  "continuous",
]);

/**
 * Long alphabetic tokens in generated text that never occur in the source (possible hallucination).
 */
export function findProminentTermsAbsentFromSource(generatedTextLower: string, sourceLower: string): string[] {
  const hits = generatedTextLower.match(/\b[a-z]{10,}\b/g) ?? [];
  const out: string[] = [];
  for (const w of hits) {
    if (GENERIC_STOPWORDS.has(w)) continue;
    if (!sourceLower.includes(w)) out.push(w);
  }
  return [...new Set(out)].slice(0, 12);
}

export type ProfileDocumentInput = {
  cleanedPages: Array<{ pageNumber: number; text: string }>;
  /** Full sanitised text (e.g. printed layer); used when page array is empty. */
  combinedPrintedText?: string;
};

/**
 * Infer course structure and topics from cleaned per-page text.
 */
export function profileDocument(input: ProfileDocumentInput): DocumentProfile {
  const pageTexts = input.cleanedPages.map((p) => sanitiseExtractedText(p.text.replace(/\r\n/g, "\n")));
  const combinedFromPages = pageTexts.join("\n\n");
  const combined = (input.combinedPrintedText ?? combinedFromPages).replace(/\r\n/g, "\n");
  const pageCount = inferPageCount(input.cleanedPages, combined);

  const sections = extractSectionHeadingsFromText(combined);
  const structuralHeadings = collectStructuralHeadings(combined);
  const chapterMapStructural = buildChapterMapFromStructuralHeadings(structuralHeadings, pageCount, combined);
  const chapterMapFallback = buildChapterMapFromSections(sections, pageCount, combined);

  const hasWorkedExamples =
    /\bworked\s+example\b/i.test(combined) ||
    /(?:^|\n)\s*example\s*[:.-]/im.test(combined) ||
    /\bexample\s*\(\s*\w+/i.test(combined);
  const hasExercises =
    /\b(exercise|problem)\s+\d/i.test(combined) || /(?:^|\n)\s*(question|problem)\s*\d/im.test(combined);
  const proofLikeMarkersInSource = /(?:^|\n)\s*proof\s*[.:]/im.test(combined) || /\bshow\s+that\b/i.test(combined);
  const hasAlgorithms = /\balgorithm\s+\d/i.test(combined) || /\bpseudocode\b/i.test(combined);

  const layers = splitDocumentTextLayers(combined);
  const hwRatio =
    layers.handwrittenText.length / Math.max(1, layers.printedText.length + layers.handwrittenText.length);
  const cleanedPagesForNoise =
    input.cleanedPages.length ? input.cleanedPages.map((p) => ({ pageNumber: p.pageNumber, text: sanitiseExtractedText(p.text) })) : [{ pageNumber: 1, text: combined }];
  const handwritingNoisePages = computeHandwritingNoisePages(cleanedPagesForNoise);
  const hasHandwrittenAnnotations = handwritingNoisePages.length > 0 || hwRatio > 0.02 || layers.handwrittenText.length > 400;

  const headingTopics = sections.map((s) => `${s.title}`.trim()).filter((t) => t.length >= 4);
  const detectedTopics = extractDetectedTopicsFromDocument(combined, headingTopics);

  const notationSource =
    layers.printedText.replace(/\s+/g, " ").trim().length > 400 ? layers.printedText : combined;
  const detectedNotation = dedupeNotationCounts(notationSource);

  const title = inferTitleFromFirstPages(combined);

  const cleanedPagesArg =
    input.cleanedPages.length ?
      input.cleanedPages.map((p) => ({ pageNumber: p.pageNumber, text: sanitiseExtractedText(p.text.replace(/\r\n/g, "\n")) }))
    : [{ pageNumber: 1, text: combined.slice(0, 120_000) }];

  const tocParseResult = parseTableOfContents(cleanedPagesArg, pageCount);
  const structuralOrFallback = chapterMapStructural.length >= 2 ? chapterMapStructural : chapterMapFallback;
  let chapterMap = structuralOrFallback;

  const dottedSubsections = (rows: ChapterMapEntry[]) =>
    rows.filter((c) => /\d+\.\d+/.test(c.chapterLabel) || /\d+\.\d+/.test(c.chapterTitle)).length;
  const dottedFromHeadings = dottedSubsections(structuralOrFallback);
  const dottedFromToc = dottedSubsections(tocParseResult.chapterMap);

  /** Prefer TOC when it is long enough; but do not drop fine-grained x.y headings for a coarse TOC with fewer dotted sections. */
  const tocCoarserThanHeadings = dottedFromHeadings > 2 && dottedFromToc < dottedFromHeadings - 1;
  const useToc =
    tocParseResult.found &&
    tocParseResult.chapterMap.length >= 3 &&
    tocParseResult.chapterMap.length >= structuralOrFallback.length &&
    !tocCoarserThanHeadings;

  if (useToc) {
    chapterMap = tocParseResult.chapterMap.map((ch) => ({
      ...ch,
      sectionHeadings: ch.sectionHeadings ?? [],
    }));
  }

  const chapterHeadingTitles = chapterMap.map((c) => c.chapterTitle).filter(Boolean);
  const subjectArea = inferSubjectArea(title, chapterHeadingTitles.length ? chapterHeadingTitles : headingTopics, combined);
  const courseName = title ?? subjectArea;
  const finalTitle = title ?? (courseName ?? null);

  const hasLemmaLabels = /\blemma\s+\d/i.test(combined);
  const hasPropLabels = /\bproposition\s+\d/i.test(combined);
  const hasThmLabels = /\btheorem\s+\d/i.test(combined);
  const hasDefLabels = /\bdefinition\s+\d/i.test(combined);
  const hasProofLabels = /(?:^|\n)\s*proof\s*[.:]/im.test(combined);
  const hasExampleLabels = /\bexample\s+\d/i.test(combined) || /\bfor\s+instance\b/i.test(combined);
  const hasFormulaSignals =
    (combined.match(/[=∑∫∇∂′″√〈〉]/g) ?? []).length > pageCount ||
    /\bintegral\b|\bdeterminant\b|\\frac/i.test(combined);

  let confidence = 0.45;
  if (finalTitle) confidence += 0.18;
  if (chapterMap.length >= 5) confidence += 0.15;
  if (tocParseResult.found) confidence += 0.12;
  if (detectedTopics.length >= 8) confidence += 0.08;
  confidence = Math.min(0.95, confidence);

  const profileWarnings: string[] = [...tocParseResult.warnings];
  if (tocParseResult.found && tocParseResult.chapterMap.length < 3) {
    profileWarnings.push("Table of contents detected but fewer than 3 parsed sections — check PDF line breaks.");
  }

  const earlyForToc = combined.slice(0, Math.min(45_000, combined.length));
  const contentsBanner = /\b(table\s+of\s+)?contents\b/i.test(earlyForToc);
  const tocLeaderLines =
    /(?:^|\n)\s*\d{1,2}(?:\.\d+){0,2}\s+.{6,180}?(?:\.{3,}|…|(?:\s\.){3,}|\s{5,})\s*\d{1,4}\s*$/m.test(earlyForToc) ||
    /(?:^|\n)\s*[A-Za-z][^.\n]{6,140}(?:\.{3,}|…|(?:\s\.){3,}|\s{5,})\s*\d{1,4}\s*$/m.test(earlyForToc);
  const criticalTocParseFailure = Boolean(contentsBanner && tocLeaderLines && chapterMap.length === 0);

  const hasPastPaperQuestions =
    /\b(total\s+marks|minutes\s+allowed|time\s+allowed|candidate\s+number)\b/i.test(combined) &&
    (/(?:^|\n)\s*question\s+\d/i.test(combined) || /(?:^|\n)\s*(?:q\.?|part)\s*\d/i.test(combined));
  const solutionLineHits = (combined.match(/(?:^|\n)\s*(?:solution|answer|mark\s+scheme)\b/gi) ?? []).length;
  const looksLikeLectureWithIncidentalSolutions =
    /\bchapter\s+\d+/i.test(combined.slice(0, 35_000)) && solutionLineHits < 14;
  const hasSolutions = solutionLineHits >= 10 && !looksLikeLectureWithIncidentalSolutions;

  return {
    title: finalTitle,
    courseName,
    subjectArea,
    documentType: classifyDocumentType(cleanedPagesArg, combined),
    pageCount,
    criticalTocParseFailure,
    chapterMap,
    detectedTopics,
    detectedNotation,
    proofLikeMarkersInSource,
    handwritingNoisePages,
    hasWorkedExamples,
    hasExercises,
    hasProofs: proofLikeMarkersInSource,
    hasAlgorithms,
    hasHandwrittenAnnotations,
    hasTableOfContents: tocParseResult.found,
    hasChapterHeadings: chapterMap.length > 0 || structuralHeadings.length > 0,
    hasDefinitions: hasDefLabels || /\bis\s+(?:called|defined\s+as)\b/i.test(combined),
    hasLemmas: hasLemmaLabels,
    hasPropositions: hasPropLabels,
    hasTheorems: hasThmLabels,
    hasProofBlocks: hasProofLabels,
    hasExamples: hasWorkedExamples || hasExampleLabels,
    hasFormulas: hasFormulaSignals,
    hasPastPaperQuestions,
    hasSolutions,
    confidence,
    warnings: profileWarnings,
    tocParseResult,
  };
}

/** Merge section lists from multiple files (same as study pack). */
export function mergeSectionsForProfile(lists: ExtractedSectionHeading[][]): ExtractedSectionHeading[] {
  return mergeExtractedSectionHeadings(...lists);
}
