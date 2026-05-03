/**
 * Table of contents parsing for PDF-extracted text (dotted leaders, broken lines, page numbers).
 */

import { sanitiseExtractedText } from "@/lib/document-profile";
import type { ChapterMapEntry } from "@/lib/document-profile";

export type TocParseResult = {
  found: boolean;
  chapterMap: ChapterMapEntry[];
  headingCandidates: string[];
  warnings: string[];
  /** Raw lines that looked like TOC entries (for debug). */
  rawTocLines: string[];
};

const LEADERS = /(?:\.{2,}|…|(?:\s\.){3,}|\s{3,})\s*(\d{1,3})\s*$/;
const END_PAGE_LINE = /^\s*(\d{1,3})\s*$/;

function normaliseTocLine(line: string): string {
  return sanitiseExtractedText(line)
    .replace(/\uFFFE/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to join a title split across two lines: "2 Curves in R" + "3, Frenet frames" → "2 Curves in R 3, Frenet frames"
 * (heuristic: second line does not look like a new entry).
 */
function joinWrappedTocTitle(first: string, second: string): string | null {
  const t2 = second.trim();
  if (!t2) return null;
  if (/^\d{1,2}\s+(?![\d.])/.test(t2) && !LEADERS.test(t2) && !END_PAGE_LINE.test(t2)) return null;
  if (END_PAGE_LINE.test(t2)) return null;
  if (LEADERS.test(t2)) return null;
  if (t2.length < 3 || t2.length > 200) return null;
  return `${first} ${t2}`.replace(/\s+/g, " ");
}

type RawEntry = { label: string; title: string; page: number; raw: string };

/**
 * Parse "1 Some title ........ 3" and variants on early pages.
 */
export function parseTableOfContents(
  pages: Array<{ pageNumber: number; text: string }>,
  pageCount: number,
): TocParseResult {
  const warnings: string[] = [];
  const headingCandidates: string[] = [];
  const rawTocLines: string[] = [];

  if (!pages.length || pageCount < 2) {
    return { found: false, chapterMap: [], headingCandidates, warnings: ["No multi-page document"], rawTocLines };
  }

  const early = pages
    .filter((p) => p.pageNumber <= Math.min(5, pages.length))
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((p) => p.text)
    .join("\n\n");

  const text = sanitiseExtractedText(early.replace(/\r\n/g, "\n"));
  const lowerAll = text.toLowerCase();
  const tocWindowIdx =
    lowerAll.search(/\bcontents\b|\btable\s+of\s+contents\b/i) >= 0
      ? Math.max(0, lowerAll.search(/\bcontents\b|\btable\s+of\s+contents\b/i))
      : 0;
  const tocWindow = tocWindowIdx ? text.slice(tocWindowIdx, tocWindowIdx + 25_000) : text.slice(0, 25_000);

  const lines = tocWindow.split("\n").map((l) => normaliseTocLine(l)).filter((l) => l.length > 0);

  const rawEntries: RawEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    let line = lines[i] ?? "";
    if (/^contents$/i.test(line) || /^table of contents$/i.test(line)) {
      i += 1;
      continue;
    }
    if (!/^\d{1,2}\s+/.test(line) && !/^\d{1,2}\.\d+/.test(line)) {
      i += 1;
      continue;
    }

    if (i + 1 < lines.length) {
      const next = lines[i + 1] ?? "";
      const merged = joinWrappedTocTitle(line, next);
      if (merged) {
        line = merged;
        i += 1;
      }
    }

    rawTocLines.push(line);

    // "1 Title ... 3" on one line
    const m1 = line.match(
      /^\s*(\d{1,2}(?:\.\d+){0,2})\s+(.+?)(?:\s*(?:\.{2,}|…|(?:\s\.){3,}|\s{4,}))\s*(\d{1,3})\s*$/,
    );
    if (m1) {
      const label = m1[1] ?? "";
      const title = (m1[2] ?? "").replace(/\s+\./g, " ").replace(/\.+$/g, "").trim();
      const page = Number(m1[3]);
      if (label && title.length >= 3 && Number.isFinite(page) && page >= 1 && page <= pageCount) {
        rawEntries.push({ label, title, page, raw: line });
        headingCandidates.push(title);
        i += 1;
        continue;
      }
    }

    // "1 Title" only; page on same or next line
    const m2 = line.match(/^\s*(\d{1,2}(?:\.\d+){0,2})\s+(.+)$/);
    if (m2) {
      const label = m2[1] ?? "";
      let title = (m2[2] ?? "").trim();
      if (LEADERS.test(line)) {
        const pm = line.match(LEADERS);
        const page = Number(pm?.[1]);
        title = line
          .replace(LEADERS, "")
          .replace(/^\s*(\d{1,2}(?:\.\d+){0,2})\s+/, "")
          .replace(/\.+$/g, "")
          .trim();
        if (Number.isFinite(page) && page >= 1 && page <= pageCount && title.length >= 3) {
          rawEntries.push({ label, title, page, raw: line });
          headingCandidates.push(title);
          i += 1;
          continue;
        }
      }
      const nextLine = lines[i + 1] ?? "";
      const endPg = END_PAGE_LINE.test(nextLine) ? Number(nextLine.trim()) : undefined;
      if (endPg !== undefined && endPg >= 1 && endPg <= pageCount && title.length >= 3 && !/\d{3,}/.test(title)) {
        rawEntries.push({ label, title, page: endPg, raw: `${line} → ${nextLine}` });
        headingCandidates.push(title);
        i += 2;
        continue;
      }
    }

    i += 1;
  }

  // Prefer longest run of sequential numeric labels (1..N) on nearby pages
  const byLabel = new Map<string, RawEntry>();
  for (const e of rawEntries) {
    const major = e.label.split(".")[0] ?? e.label;
    if (!/^\d+$/.test(major)) continue;
    const prev = byLabel.get(major);
    if (!prev || e.title.length > prev.title.length) byLabel.set(major, e);
  }

  let seq: RawEntry[] = [...byLabel.values()].sort((a, b) => {
    const na = Number(a.label.split(".")[0]);
    const nb = Number(b.label.split(".")[0]);
    return na - nb;
  });

  if (seq.length < 3 && rawEntries.length >= 3) {
    seq = [...rawEntries].sort((a, b) => a.page - b.page || Number(a.label.split(".")[0]) - Number(b.label.split(".")[0]));
    const dedupe = new Map<string, RawEntry>();
    for (const e of seq) {
      const k = `${e.label}|${e.page}`;
      if (!dedupe.has(k)) dedupe.set(k, e);
    }
    seq = [...dedupe.values()];
  }

  if (seq.length < 2) {
    warnings.push("TOC heuristics found fewer than 2 usable entries — falling back to heading scan.");
    return { found: false, chapterMap: [], headingCandidates, warnings, rawTocLines };
  }

  const chapterMap: ChapterMapEntry[] = [];
  for (let j = 0; j < seq.length; j += 1) {
    const cur = seq[j]!;
    const next = seq[j + 1];
    const startPage = Math.min(Math.max(1, cur.page), pageCount);
    const endPage = next ? Math.min(pageCount, Math.max(startPage, next.page - 1)) : pageCount;
    chapterMap.push({
      chapterLabel: cur.label.split(".")[0] ?? cur.label,
      chapterTitle: cur.title.replace(/\s+\./g, " ").trim(),
      startPage,
      endPage,
      sectionHeadings: [],
    });
  }

  if (chapterMap.length && chapterMap[chapterMap.length - 1]!.endPage < pageCount) {
    chapterMap[chapterMap.length - 1]!.endPage = pageCount;
  }

  return {
    found: true,
    chapterMap,
    headingCandidates: [...new Set(headingCandidates)].slice(0, 80),
    warnings,
    rawTocLines: rawTocLines.slice(0, 120),
  };
}
