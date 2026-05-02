/**
 * Document-level profiling for generic revision-pack generation.
 * All signals are derived from the uploaded file text only.
 */

import { extractSectionHeadingsFromText, mergeExtractedSectionHeadings, type ExtractedSectionHeading } from "@/lib/section-headings";

export type DocumentType =
  | "lecture_notes"
  | "problem_sheet"
  | "past_paper"
  | "solutions"
  | "mixed"
  | "unknown";

export type ChapterMapEntry = {
  chapterLabel: string;
  chapterTitle: string;
  startPage: number;
  endPage: number;
  sectionHeadings: string[];
};

export type DocumentProfile = {
  title: string | null;
  courseName: string | null;
  subjectArea: string | null;
  documentType: DocumentType;
  pageCount: number;
  chapterMap: ChapterMapEntry[];
  detectedTopics: string[];
  detectedNotation: string[];
  hasWorkedExamples: boolean;
  hasExercises: boolean;
  hasProofs: boolean;
  hasAlgorithms: boolean;
  hasHandwrittenAnnotations: boolean;
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

function inferDocumentType(text: string): DocumentType {
  const lower = text.toLowerCase();
  const prob =
    /\b(problem\s+sheet|homework\s*\d|assignment\s*\d|due\s+date)\b/i.test(lower) && /\b(exercise|question)\s*\d+/i.test(lower);
  const past = /\b(final\s+exam|past\s+paper|semester\s+\d|minutes\s+allowed|total\s+marks)\b/i.test(lower);
  const sol =
    /\b(solutions?|model\s+answers?|mark\s+scheme|answer\s+key)\b/i.test(lower) &&
    /\b(solution|proof|sketch)\s*\d|\bthus\b|\btherefore\b/i.test(lower);
  let hits = 0;
  if (prob) hits += 1;
  if (past) hits += 1;
  if (sol) hits += 1;
  if (hits >= 2) return "mixed";
  if (prob) return "problem_sheet";
  if (past) return "past_paper";
  if (sol) return "solutions";
  if (/\b(lecture|chapter|section\s+\d)\b/i.test(lower)) return "lecture_notes";
  return "unknown";
}

function inferSubjectArea(text: string): string | null {
  const lower = text.slice(0, 120_000).toLowerCase();
  const scores: Array<[string, number]> = [
    ["Time series analysis", /\b(time\s+series|autocovariance|autocorrelation|arima|sarima|arma|stationar|white\s+noise)\b/i.test(lower) ? 3 : 0],
    ["Monte Carlo / simulation", /\b(monte\s*carlo|importance\s+sampling|\bmcmc\b|markov\s+chain\s+monte)\b/i.test(lower) ? 3 : 0],
    ["Spatial statistics", /\b(kriging|semivariogram|variogram|geostat)\b/i.test(lower) ? 3 : 0],
    ["Probability & stochastic processes", /\b(stochastic\s+process|probability\s+space|sigma\s*algebra)\b/i.test(lower) ? 2 : 0],
  ];
  const best = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] >= 2 ? best[0] : null;
}

function inferTitleFromFirstPages(text: string): string | null {
  const before = text.split(/\[Page\s+5\]/i)[0] ?? text;
  const lines = before
    .split("\n")
    .map((l) => sanitiseExtractedText(l).trim())
    .filter(Boolean);

  const skip = (l: string) =>
    /^\[Page\b/i.test(l) ||
    /^(department|faculty|school)\s+of\b/i.test(l) ||
    (/^(imperial|university|college)\b/i.test(l) && l.length < 100);

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

  const major = sections.filter((s) => /^\d+$/.test(s.sectionNumber) || /^Chapter\s+/i.test(s.title));
  const use = major.length ? major : sections.filter((s) => !s.sectionNumber.includes(".") || s.sectionNumber.split(".").length <= 2);

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
export function detectSourceContamination(generatedBlobLower: string, sourceLower: string): string[] {
  const issues: string[] = [];
  const candidates = [
    "importance sampling",
    "self-normalised importance",
    "snis",
    "effective sample size",
    "monte carlo integration",
    "markov chain monte carlo",
    "mcmc",
    "detailed balance",
    "metropolis-hastings",
    "simple kriging",
    "ordinary kriging",
  ];

  for (const term of candidates) {
    if (generatedBlobLower.includes(term) && !sourceLower.includes(term)) {
      issues.push(`Generated content mentions “${term}” but the uploaded source does not — possible hallucination or stale template.`);
    }
  }
  return issues;
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
  const chapterMap = buildChapterMapFromSections(sections, pageCount, combined);

  const lower = combined.toLowerCase();
  const hasWorkedExamples =
    /\bworked\s+example\b/i.test(combined) ||
    /(?:^|\n)\s*example\s*[:.-]/im.test(combined) ||
    /\bexample\s*\(\s*\w+/i.test(combined);
  const hasExercises =
    /\b(exercise|problem)\s+\d/i.test(combined) || /(?:^|\n)\s*(question|problem)\s*\d/im.test(combined);
  const hasProofs = /(?:^|\n)\s*proof\s*[.:]/im.test(combined) || /\bshow\s+that\b/i.test(combined);
  const hasAlgorithms = /\balgorithm\s+\d/i.test(combined) || /\bpseudocode\b/i.test(combined);

  const layers = splitDocumentTextLayers(combined);
  const hwRatio =
    layers.handwrittenText.length / Math.max(1, layers.printedText.length + layers.handwrittenText.length);
  const hasHandwrittenAnnotations = hwRatio > 0.02 || layers.handwrittenText.length > 400;

  const headingTopics = sections.map((s) => `${s.title}`.trim()).filter((t) => t.length >= 4);
  const topicSet = new Set<string>();
  for (const t of headingTopics) topicSet.add(t.slice(0, 120));
  const bodySnippet = combined.slice(0, 200_000).toLowerCase();
  for (const phrase of [
    "stationarity",
    "autocovariance",
    "autocorrelation",
    "white noise",
    "moving average",
    "autoregressive",
    "arma",
    "arch",
    "arima",
    "seasonal adjustment",
    "variance",
    "covariance",
  ]) {
    if (bodySnippet.includes(phrase)) topicSet.add(phrase);
  }
  const detectedTopics = [...topicSet].slice(0, 80);

  const notation: string[] = [];
  const notationHits = combined.match(/\\(?:Phi|Theta|mathbb|mathrm)\{[^}]+\}|𝜙|𝜃|∇|Σ|σ|μ|\bX_t\b|\bB\b(?=\s*\()/g) ?? [];
  for (const h of notationHits.slice(0, 40)) notation.push(h);

  const title = inferTitleFromFirstPages(combined);
  const subjectArea = inferSubjectArea(combined);
  const courseName = title ?? subjectArea;

  return {
    title,
    courseName,
    subjectArea,
    documentType: inferDocumentType(combined),
    pageCount,
    chapterMap,
    detectedTopics,
    detectedNotation: notation,
    hasWorkedExamples,
    hasExercises,
    hasProofs,
    hasAlgorithms,
    hasHandwrittenAnnotations,
  };
}

/** Merge section lists from multiple files (same as study pack). */
export function mergeSectionsForProfile(lists: ExtractedSectionHeading[][]): ExtractedSectionHeading[] {
  return mergeExtractedSectionHeadings(...lists);
}
