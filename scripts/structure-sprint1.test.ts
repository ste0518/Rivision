/**
 * Sprint 1 structure pipeline smoke tests (PageRecord → profile → headings → chapter map → section blocks).
 * Run: npx tsx scripts/structure-sprint1.test.ts
 */

import assert from "node:assert/strict";
import { buildChapterMap, displayTitleFromChapterHeading } from "../src/lib/chapter-map-builder";
import { profileDocument } from "../src/lib/document-profile";
import { inferTitleAndCourseFromEarlyPages } from "../src/lib/document-title";
import { detectHeadingsByPage } from "../src/lib/heading-detection";
import { buildPageRecordsFromParsedPages, pageRecordsToMarkedFullText } from "../src/lib/page-records";
import { buildSectionBlocksPageAware } from "../src/lib/section-blocks";

function syntheticLecturePages() {
  return [
    {
      pageNumber: 1,
      text: `
Department of Mathematics

Applied Stochastic Modelling
MATH 50012 — Spring Term

Lecture Notes
`,
    },
    {
      pageNumber: 2,
      text: `
Contents

1 Introduction .......... 3
`,
    },
    {
      pageNumber: 8,
      text: `
Chapter 6

Spectral inference

2.3.1 Periodogram smoothing

The periodogram is biased. We smooth using kernels.

Chapter 7

Multivariate series

3.1.2 VAR(p) models

Let Xt be a vector AR process.

Worked example: VAR(1) stationarity.

Proof.
Suppose the eigenvalues lie inside the unit circle.

4.2.1 Forecast error variance

The forecast error covariance is ...

`,
    },
  ];
}

function run() {
  const cleanedPages = syntheticLecturePages().map((p) => ({
    pageNumber: p.pageNumber,
    text: p.text.replace(/\r\n/g, "\n").trim(),
  }));

  const titleInfo = inferTitleAndCourseFromEarlyPages(cleanedPages);
  assert.ok(titleInfo.title, "title from early pages");
  assert.match(titleInfo.title ?? "", /Applied Stochastic|Stochastic Modelling/i);

  const pageRecords = buildPageRecordsFromParsedPages(cleanedPages);
  assert.ok(pageRecords[0]?.lineRecords.length, "LineRecords exist");

  const marked = pageRecordsToMarkedFullText("fixture-notes", pageRecords);
  const profile = profileDocument({ cleanedPages, combinedPrintedText: marked });
  assert.ok(profile.title?.includes("Applied") || profile.title?.includes("Stochastic"), "profile title not filename");

  const headings = detectHeadingsByPage(pageRecords);
  assert.ok(headings.length >= 4, `expected heading candidates, got ${headings.length}`);
  assert.ok(headings.some((h) => /Chapter\s*6/i.test(h.text)), "Chapter 6 heading");
  assert.ok(headings.some((h) => /Chapter\s*7/i.test(h.text)), "Chapter 7 heading");

  const tocResult = profile.tocParseResult;
  const preferToc = (tocResult?.entries?.filter((e) => e.startPage != null).length ?? 0) >= 3;
  const built = buildChapterMap({
    tocEntries: tocResult?.entries ?? [],
    tocFound: tocResult?.found ?? false,
    headingCandidates: headings,
    pageCount: profile.pageCount,
    preferToc,
  });

  assert.ok(built.chapterMap.length >= 2, "chapter map has at least 2 entries");
  assert.ok(built.source === "heading_scan" || built.source === "toc", `chapterMapSource=${built.source}`);
  const ch6 = built.chapterMap.find((c) => c.chapterLabel === "6");
  const ch7 = built.chapterMap.find((c) => c.chapterLabel === "7");
  assert.ok(ch6 && ch7, "Chapter 6 and 7 rows exist");
  assert.ok(
    ch7!.startPage >= ch6!.startPage,
    `Chapter 7 should not start before Chapter 6 (${ch6!.startPage} vs ${ch7!.startPage})`,
  );
  if (ch6!.endPage < profile.pageCount) {
    assert.ok(ch6!.endPage < ch7!.startPage || ch6!.startPage === ch7!.startPage, "chapter 6 ends before chapter 7 when on later pages");
  }

  const blocks = buildSectionBlocksPageAware(built.chapterMap, headings, pageRecords, "fixture");
  assert.ok(blocks.length >= 3, `expected multiple section blocks, got ${blocks.length}`);

  assert.equal(displayTitleFromChapterHeading("Chapter 7 Multivariate series"), "Multivariate series");
  const swallowed = displayTitleFromChapterHeading(
    "Chapter 6 The periodogram is biased and we need a very long explanation that continues",
  );
  assert.ok(swallowed.length < 90, "long body text should not become chapter title");

  console.log("structure-sprint1.test.ts: ok", {
    title: profile.title,
    headings: headings.length,
    chapterSource: built.source,
    chapters: built.chapterMap.length,
    blocks: blocks.length,
  });
}

run();
