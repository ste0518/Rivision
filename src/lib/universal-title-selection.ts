/**
 * Document title: front matter → early pages → first top-level heading → file fallback.
 * Later section headings must not replace an earlier valid title.
 */

import type { FrontMatter } from "@/lib/front-matter";
import type { HeadingCandidate } from "@/lib/heading-detection";

export type EarlyTitleInference = {
  title: string | null;
  courseName: string | null;
  confidence: number;
  sourcePage: number | null;
};

export type UniversalTitleSelection = {
  documentTitle: string | null;
  courseName: string | null;
  chapterLabel: string | null;
  chapterTitle: string | null;
  titleSourcePage: number | null;
  titleConfidence: number;
  titleSelectionReason: string;
  /** Early title was available but a much later heading could have wrongly replaced it (blocked — gate uses this). */
  suppressedLaterHeadingForTitle: boolean;
};

function trimTitle(s: string | null | undefined, max = 160) {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 6) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * A: explicit front matter. A2: strong early-page inference before any late heading.
 * B: first top-level (chapter) heading when compatible with early title.
 * C: file stem.
 */
export function selectUniversalDocumentTitle(input: {
  frontMatter: FrontMatter;
  earlyTitle: EarlyTitleInference;
  headingCandidates: HeadingCandidate[];
  fileNameStem: string | null;
}): UniversalTitleSelection {
  const { frontMatter, earlyTitle, headingCandidates, fileNameStem } = input;

  const fmTitle = trimTitle(frontMatter.documentTitle ?? frontMatter.title);
  if (fmTitle) {
    return {
      documentTitle: fmTitle,
      courseName: trimTitle(frontMatter.courseName) ?? fmTitle,
      chapterLabel: frontMatter.chapterLabel,
      chapterTitle: frontMatter.chapterTitle ? trimTitle(frontMatter.chapterTitle) : null,
      titleSourcePage: frontMatter.titleSourcePage,
      titleConfidence: Math.min(0.95, frontMatter.titleConfidence ?? 0.62),
      titleSelectionReason: "explicit_front_matter_title",
      suppressedLaterHeadingForTitle: false,
    };
  }

  const sorted = [...headingCandidates].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex || a.text.localeCompare(b.text),
  );
  const firstChapterHeading = sorted.find((h) => h.headingType === "chapter");

  const early = trimTitle(earlyTitle.title);
  const ep = earlyTitle.sourcePage;
  const earlyUsable = Boolean(early && earlyTitle.confidence >= 0.48 && ep != null && ep <= 14);

  let suppressedLaterHeadingForTitle = false;
  if (earlyUsable && firstChapterHeading) {
    const late =
      firstChapterHeading.pageNumber > (ep ?? 0) + 24 &&
      !/^Chapter\s*\d+/i.test(firstChapterHeading.text.trim());
    if (late) suppressedLaterHeadingForTitle = true;
  }

  if (earlyUsable && early) {
    return {
      documentTitle: early,
      courseName: trimTitle(frontMatter.courseName) ?? early,
      chapterLabel: frontMatter.chapterLabel,
      chapterTitle: frontMatter.chapterTitle ? trimTitle(frontMatter.chapterTitle) : null,
      titleSourcePage: ep,
      titleConfidence: Math.min(0.9, earlyTitle.confidence),
      titleSelectionReason: "early_page_title_inference",
      suppressedLaterHeadingForTitle,
    };
  }

  if (firstChapterHeading) {
    const ht = firstChapterHeading.text.replace(/\s+/g, " ").trim().slice(0, 160);
    if (ht.length >= 6) {
      return {
        documentTitle: ht,
        courseName: trimTitle(frontMatter.courseName) ?? ht,
        chapterLabel: frontMatter.chapterLabel ?? firstChapterHeading.text.match(/^Chapter\s*(\d+)/i)?.[1] ?? null,
        chapterTitle: frontMatter.chapterTitle ? trimTitle(frontMatter.chapterTitle) : null,
        titleSourcePage: firstChapterHeading.pageNumber,
        titleConfidence: Math.min(0.88, 0.48 + firstChapterHeading.confidence * 0.38),
        titleSelectionReason: "first_top_level_heading_candidate",
        suppressedLaterHeadingForTitle: false,
      };
    }
  }

  if (early) {
    return {
      documentTitle: early,
      courseName: trimTitle(frontMatter.courseName) ?? early,
      chapterLabel: frontMatter.chapterLabel,
      chapterTitle: frontMatter.chapterTitle ? trimTitle(frontMatter.chapterTitle) : null,
      titleSourcePage: ep,
      titleConfidence: Math.min(0.85, earlyTitle.confidence),
      titleSelectionReason: "early_page_title_inference_weak",
      suppressedLaterHeadingForTitle: false,
    };
  }

  const stem = fileNameStem?.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const fb = stem && stem.length >= 4 && stem.length < 120 ? stem : null;
  return {
    documentTitle: fb,
    courseName: fb,
    chapterLabel: frontMatter.chapterLabel,
    chapterTitle: frontMatter.chapterTitle ? trimTitle(frontMatter.chapterTitle) : null,
    titleSourcePage: null,
    titleConfidence: fb ? 0.28 : 0.12,
    titleSelectionReason: fb ? "document_file_fallback" : "no_reliable_title",
    suppressedLaterHeadingForTitle: false,
  };
}
