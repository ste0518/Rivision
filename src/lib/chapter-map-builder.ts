/**
 * Build and validate chapter maps from TOC + heading candidates (page-aware).
 */

import type { ChapterMapEntry } from "@/lib/document-profile";
import type { HeadingCandidate } from "@/lib/heading-detection";
import type { TocEntry } from "@/lib/table-of-contents";

export type ChapterRangeValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function validateChapterMap(map: ChapterMapEntry[], pageCount: number): ChapterRangeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!map.length) {
    return { ok: pageCount < 30, errors: pageCount >= 30 ? ["chapterMap empty for long document"] : [], warnings: [] };
  }

  let prevStart = 0;
  for (let i = 0; i < map.length; i += 1) {
    const ch = map[i]!;
    if (ch.startPage < 1 || ch.endPage > pageCount) {
      errors.push(`Chapter "${ch.chapterLabel}" has invalid range ${ch.startPage}–${ch.endPage} (pageCount=${pageCount}).`);
    }
    if (ch.startPage > ch.endPage) {
      errors.push(`Chapter "${ch.chapterLabel}" has startPage > endPage.`);
    }
    if (ch.startPage <= prevStart && i > 0) {
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

  return { ok: errors.length === 0, errors, warnings };
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
    const labelMatch = cur.text.match(/^Chapter\s+(\d+)/i);
    const numMatch = cur.text.match(/^(\d+(?:\.\d+)*)/);
    const chapterLabel = labelMatch?.[1] ?? numMatch?.[1] ?? `H${i + 1}`;
    const chapterTitle = cur.text.replace(/^Chapter\s+\d+\s*/i, "").trim() || cur.text;
    const startPage = Math.min(pageCount, Math.max(1, cur.pageNumber));
    const endPage = next ? Math.min(pageCount, Math.max(startPage, next.pageNumber - 1)) : pageCount;
    out.push({
      chapterLabel,
      chapterTitle,
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
 * Prefer TOC when entries have usable page numbers; otherwise chapter-style headings.
 */
export function buildChapterMap(input: BuildChapterMapInput): {
  chapterMap: ChapterMapEntry[];
  validation: ChapterRangeValidation;
  source: "toc" | "headings" | "none";
} {
  const { tocEntries, tocFound, headingCandidates, pageCount, preferToc } = input;

  let chapterMap: ChapterMapEntry[] = [];
  let source: "toc" | "headings" | "none" = "none";

  const tocWithPages = tocEntries.filter((e) => e.startPage != null);
  const fromToc = tocFound && preferToc && tocWithPages.length >= 2 ? tocEntriesToChapterMap(tocEntries, pageCount) : [];
  if (fromToc.length >= 2) {
    chapterMap = fromToc;
    source = "toc";
  } else {
    const fromHead = headingsToChapterMap(headingCandidates, pageCount);
    if (fromHead.length >= 2) {
      chapterMap = fromHead;
      source = "headings";
    }
  }

  const validation = validateChapterMap(chapterMap, pageCount);
  return { chapterMap, validation, source };
}

export { validateChapterMap };
