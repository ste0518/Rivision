/**
 * Build and validate chapter maps from TOC + heading candidates (page-aware).
 */

import type { ChapterMapEntry } from "@/lib/document-profile";
import type { HeadingCandidate } from "@/lib/heading-detection";
import type { TocEntry } from "@/lib/table-of-contents";

export type ChapterMapSource = "toc" | "heading_scan" | "manual_fallback" | "none";

export type ChapterRangeValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function validateChapterMap(map: ChapterMapEntry[], pageCount: number): ChapterRangeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!map.length) {
    return {
      ok: pageCount < 30,
      errors: pageCount >= 30 ? ["chapterMap has zero rows for a long document (segmentation failed)."] : [],
      warnings: [],
    };
  }

  const nonEmptyNote = "chapterMap is non-empty; following issues refer to page spans only.";

  let prevStart = 0;
  for (let i = 0; i < map.length; i += 1) {
    const ch = map[i]!;
    if (ch.startPage < 1 || ch.endPage > pageCount) {
      errors.push(`Chapter "${ch.chapterLabel}" has invalid range ${ch.startPage}–${ch.endPage} (pageCount=${pageCount}).`);
    }
    if (ch.startPage > ch.endPage) {
      errors.push(`Chapter "${ch.chapterLabel}" has startPage > endPage.`);
    }
    if (ch.startPage < prevStart && i > 0) {
      errors.push(`Chapter starts do not strictly increase at "${ch.chapterLabel}".`);
    }
    prevStart = ch.startPage;
  }

  const startsAtOne = map.filter((c) => c.startPage === 1).length;
  if (map.length >= 4 && startsAtOne / map.length > 0.55) {
    errors.push("Most chapters incorrectly start at page 1.");
  }

  if (map.length >= 2) {
    const last = map[map.length - 1]!;
    const span = last.endPage - last.startPage + 1;
    if (span >= pageCount * 0.88 && map.length >= 3) {
      warnings.push("One late chapter spans nearly the whole document — check TOC/heading merge.");
    }
  }

  if (errors.length) warnings.unshift(nonEmptyNote);

  return { ok: errors.length === 0, errors, warnings };
}

const CHAPTER_TITLE_MAX = 180;

/** Strip "Chapter N" prefix and avoid swallowing long body paragraphs into the chapter title. */
export function displayTitleFromChapterHeading(text: string): string {
  const m = text.match(/^Chapter\s*\d+(?:\.\d+)?\s*(.*)$/i);
  if (!m) {
    const s = text.replace(/\s+/g, " ").trim();
    return s.length > CHAPTER_TITLE_MAX ? `${s.slice(0, CHAPTER_TITLE_MAX - 1)}…` : s;
  }
  const rest = (m[1] ?? "").trim();
  const num = text.match(/^Chapter\s*(\d+)/i)?.[1] ?? "";
  if (!rest) return num ? `Chapter ${num}` : text.slice(0, CHAPTER_TITLE_MAX);
  if (rest.length > 95 || rest.split(/\s+/).length > 14) return num ? `Chapter ${num}` : rest.slice(0, 80);
  if ((rest.match(/=/g) ?? []).length >= 2 && rest.length > 40) return num ? `Chapter ${num}` : rest.slice(0, 80);
  const out = rest;
  return out.length > CHAPTER_TITLE_MAX ? `${out.slice(0, CHAPTER_TITLE_MAX - 1)}…` : out;
}

function explicitChapterKeywordHeadings(headings: HeadingCandidate[]): HeadingCandidate[] {
  return headings.filter((h) => h.headingType === "chapter" && /^Chapter\s*\d/i.test(h.text.trim()));
}

/**
 * Chapter boundaries from inline "Chapter N …" heading candidates (page order).
 * De-duplicates repeated detections of the same chapter number (first occurrence wins).
 */
export function buildChapterMapFromChapterMarkers(headings: HeadingCandidate[], pageCount: number): ChapterMapEntry[] {
  const markers = explicitChapterKeywordHeadings(headings).sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex,
  );
  const byNum = new Map<string, HeadingCandidate>();
  for (const m of markers) {
    const num = m.text.match(/^Chapter\s*(\d+)/i)?.[1];
    if (!num) continue;
    if (!byNum.has(num)) byNum.set(num, m);
  }
  const unique = [...byNum.values()].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex,
  );
  if (unique.length < 2) return [];

  const out: ChapterMapEntry[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    const cur = unique[i]!;
    const next = unique[i + 1];
    const label = cur.text.match(/^Chapter\s*(\d+)/i)?.[1] ?? `${i + 1}`;
    const chapterTitle = displayTitleFromChapterHeading(cur.text);
    const startPage = Math.min(pageCount, Math.max(1, cur.pageNumber));
    const endPage = next ?
      next.pageNumber > cur.pageNumber ?
        Math.min(pageCount, Math.max(startPage, next.pageNumber - 1))
      : Math.min(pageCount, Math.max(startPage, cur.pageNumber))
    : pageCount;
    out.push({
      chapterLabel: label,
      chapterTitle,
      chapterTitleNeedsReview: cur.text.replace(/\s+/g, " ").trim().length > CHAPTER_TITLE_MAX,
      startPage,
      endPage,
      sectionHeadings: [],
    });
  }
  return out.slice(0, 80);
}

function enrichChapterTitlesFromToc(map: ChapterMapEntry[], tocEntries: TocEntry[]): ChapterMapEntry[] {
  if (!tocEntries.length) return map;
  return map.map((ch) => {
    const labelNum = ch.chapterLabel.replace(/\D/g, "");
    const match = tocEntries.find((e) => {
      const el = e.label.replace(/\D/g, "");
      if (labelNum && el === labelNum) return true;
      const title = e.title.toLowerCase();
      return title.includes(`chapter ${ch.chapterLabel}`) || title.startsWith(`${ch.chapterLabel} `);
    });
    if (match && match.title.length >= 6 && match.title.length < 200) {
      return { ...ch, chapterTitle: match.title.replace(/\s+/g, " ").trim() };
    }
    return ch;
  });
}

function headingsToChapterMap(headings: HeadingCandidate[], pageCount: number): ChapterMapEntry[] {
  let use = headings.filter((h) => h.headingType === "chapter");
  if (use.length < 2) {
    const sections = headings.filter((h) => h.headingType === "section" || h.headingType === "subsection");
    if (sections.length >= 3) use = sections;
  }
  if (use.length < 2) return [];

  const sorted = [...new Map(use.map((h) => [`${h.pageNumber}|${h.lineIndex}|${h.text}`, h])).values()].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex,
  );

  const out: ChapterMapEntry[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    const labelMatch = cur.text.match(/^Chapter\s*(\d+)/i);
    const numMatch = cur.text.match(/^(\d+(?:\.\d+)*)/);
    const chapterLabel = labelMatch?.[1] ?? numMatch?.[1] ?? `H${i + 1}`;
    const chapterTitle =
      /^Chapter\s*\d/i.test(cur.text) ? displayTitleFromChapterHeading(cur.text) : cur.text.replace(/\s+/g, " ").trim().slice(0, 120);
    const startPage = Math.min(pageCount, Math.max(1, cur.pageNumber));
    const endPage = next ?
      next.pageNumber > cur.pageNumber ?
        Math.min(pageCount, Math.max(startPage, next.pageNumber - 1))
      : Math.min(pageCount, Math.max(startPage, cur.pageNumber))
    : pageCount;
    out.push({
      chapterLabel,
      chapterTitle,
      chapterTitleNeedsReview: cur.text.replace(/\s+/g, " ").trim().length > CHAPTER_TITLE_MAX,
      startPage,
      endPage,
      sectionHeadings: [],
    });
  }
  return out.slice(0, 80);
}

function tocEntriesToChapterMap(entries: TocEntry[], pageCount: number): ChapterMapEntry[] {
  const withPages = entries.filter((e) => e.startPage != null && e.startPage >= 1 && e.startPage <= pageCount);
  if (withPages.length < 2) return [];

  const sorted = [...withPages].sort((a, b) => (a.startPage ?? 0) - (b.startPage ?? 0));
  const out: ChapterMapEntry[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    const startPage = cur.startPage!;
    const endPage = next ? Math.min(pageCount, Math.max(startPage, next.startPage! - 1)) : pageCount;
    out.push({
      chapterLabel: cur.label || `${i + 1}`,
      chapterTitle: cur.title,
      startPage,
      endPage,
      sectionHeadings: [],
    });
  }
  return out;
}

export type BuildChapterMapInput = {
  tocEntries: TocEntry[];
  tocFound: boolean;
  headingCandidates: HeadingCandidate[];
  pageCount: number;
  preferToc: boolean;
};

/**
 * Prefer explicit "Chapter N" heading scans for page ranges when available; TOC supplies titles when possible.
 * Falls back to TOC-only or numbered-heading segmentation.
 */
export function buildChapterMap(input: BuildChapterMapInput): {
  chapterMap: ChapterMapEntry[];
  validation: ChapterRangeValidation;
  source: ChapterMapSource;
} {
  const { tocEntries, tocFound, headingCandidates, pageCount, preferToc } = input;

  let chapterMap: ChapterMapEntry[] = [];
  let source: ChapterMapSource = "none";

  const tocWithPages = tocEntries.filter((e) => e.startPage != null);
  const fromToc = tocFound && tocWithPages.length >= 2 ? tocEntriesToChapterMap(tocEntries, pageCount) : [];

  const fromChapterMarkers = buildChapterMapFromChapterMarkers(headingCandidates, pageCount);
  const markerValidation = validateChapterMap(fromChapterMarkers, pageCount);

  if (fromChapterMarkers.length >= 2 && markerValidation.ok) {
    chapterMap = enrichChapterTitlesFromToc(fromChapterMarkers, tocEntries);
    source = "heading_scan";
  } else if (fromChapterMarkers.length >= 2) {
    chapterMap = enrichChapterTitlesFromToc(fromChapterMarkers, tocEntries);
    source = "heading_scan";
  } else if (preferToc && fromToc.length >= 2) {
    chapterMap = fromToc;
    source = "toc";
  } else {
    const fromHead = headingsToChapterMap(headingCandidates, pageCount);
    if (fromHead.length >= 2) {
      chapterMap = fromHead;
      source = "heading_scan";
    } else if (!preferToc && fromToc.length >= 2) {
      chapterMap = fromToc;
      source = "toc";
    }
  }

  if (chapterMap.length > 0 && source === "none") {
    source = preferToc && fromToc.length >= 2 ? "toc" : "heading_scan";
  }

  if (chapterMap.length >= 2 && source === "heading_scan" && explicitChapterKeywordHeadings(headingCandidates).length === 0 && !tocFound) {
    source = "manual_fallback";
  }

  const validation = validateChapterMap(chapterMap, pageCount);
  return { chapterMap, validation, source };
}

export { validateChapterMap };
