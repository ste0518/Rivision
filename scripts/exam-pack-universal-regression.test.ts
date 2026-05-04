/**
 * Universal exam-pack pipeline invariants (fixtures only — no production course tokens).
 * Run: npx tsx scripts/exam-pack-universal-regression.test.ts
 */

import assert from "node:assert/strict";
import { buildChapterMap, validateChapterMap } from "../src/lib/chapter-map-builder";
import { extractRawExamPackCandidates } from "../src/lib/exam-pack-candidates";
import { detectHeadingsByPage } from "../src/lib/heading-detection";
import { buildHeuristicStudentRevisionPack } from "../src/lib/local-study-pack-extraction";
import {
  buildPageLineAnchorsFromMarkedText,
  buildPageRecordsFromParsedPages,
  pageRecordsToMarkedFullText,
  resolvePageLineAtOffset,
} from "../src/lib/page-records";
import { profileDocument } from "../src/lib/document-profile";
import { excerptGroundedInSource } from "../src/lib/source-grounding";
import {
  ALL_UNIVERSAL_FIXTURES,
  FIXTURE_LECTURE_CHAPTER_HEADINGS,
  FIXTURE_THEOREM_PROOF,
} from "../src/lib/test-fixtures/universal-exam-pack-fixtures";

function runFixtureStructural(caseId: string, pages: Array<{ pageNumber: number; text: string }>) {
  const marked = pageRecordsToMarkedFullText(`fixture-${caseId}`, buildPageRecordsFromParsedPages(pages));
  const profile = profileDocument({ cleanedPages: pages, combinedPrintedText: marked });
  const pr = buildPageRecordsFromParsedPages(pages, { fileName: `fixture-${caseId}` });
  const headings = detectHeadingsByPage(pr);
  const toc = profile.tocParseResult;
  const preferToc = (toc?.entries?.filter((e) => e.startPage != null).length ?? 0) >= 3;
  const built = buildChapterMap({
    tocEntries: toc?.entries ?? [],
    tocFound: toc?.found ?? false,
    headingCandidates: headings,
    pageCount: profile.pageCount,
    preferToc,
  });
  const raw = extractRawExamPackCandidates(`fixture-${caseId}`, pr);
  return { profile, headings, built, raw, marked };
}

function runPackInvariant(caseId: string, pages: Array<{ pageNumber: number; text: string }>) {
  const text = pages.map((p) => p.text).join("\n\n");
  const pack = buildHeuristicStudentRevisionPack({
    files: [{ id: "f1", name: `${caseId}.pdf`, role: "lecture_notes", pages }],
    settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
    combinedLectureText: text,
    hasPastEvidence: false,
  });
  return pack;
}

function main() {
  for (const fx of ALL_UNIVERSAL_FIXTURES) {
    const { profile, headings, built, raw } = runFixtureStructural(fx.id, fx.pages);
    assert.ok(headings.length >= fx.expectHeadingCountMin, `${fx.id}: headings ${headings.length} < ${fx.expectHeadingCountMin}`);
    if (built.chapterMap.length >= 2 && fx.expectChapterMapSourceNotNoneWhenMap) {
      assert.notEqual(built.source, "none", `${fx.id}: chapterMapSource should not be none when map exists`);
    }
    if (fx.expectFormulaCandidatesMin != null) {
      assert.ok(
        raw.formulaLineScanCount >= fx.expectFormulaCandidatesMin || raw.formulaCandidates.length >= Math.min(5, fx.expectFormulaCandidatesMin),
        `${fx.id}: formula candidates weak (scan ${raw.formulaLineScanCount}, rows ${raw.formulaCandidates.length})`,
      );
    }
    if (fx.expectProofCandidatesMin != null && fx.expectProofCandidatesMin > 0) {
      assert.ok(
        raw.proofCandidates.length >= fx.expectProofCandidatesMin,
        `${fx.id}: raw proof candidates ${raw.proofCandidates.length}`,
      );
    }
    if (built.chapterMap.length >= 2) {
      const v = validateChapterMap(built.chapterMap, profile.pageCount);
      assert.ok(!v.errors.some((e) => /zero rows|chapterMap is empty/i.test(e)), `${fx.id}: validation should not claim empty map`);
    }
    assert.ok(profile.detectedTopics.every((t) => !/\bthe same\b/i.test(t)), `${fx.id}: stop phrase in topics`);
    const fm = profile.frontMatter;
    if (fm?.title) {
      assert.ok(!/@/.test(fm.title), `${fx.id}: email in front-matter title`);
    }
  }

  const theoremSrc = FIXTURE_THEOREM_PROOF.pages.map((p) => p.text).join("\n").toLowerCase();
  assert.ok(excerptGroundedInSource("let x be fixed", theoremSrc));
  assert.ok(!excerptGroundedInSource("completely alien token xyzabc123notinsource", "short"), "weak excerpt not grounded");

  const pack = runPackInvariant("lecture_chapter_headings", FIXTURE_LECTURE_CHAPTER_HEADINGS.pages);
  const diag = pack.extractionPipelineDiagnostics;
  assert.ok(diag && diag.pageHeadingCandidateCount! > 0, "pack: page heading count");
  assert.ok((diag?.sectionBlockCount ?? 0) >= 2, "pack: section blocks");
  assert.ok(diag?.rawHeadingCandidates && diag.rawHeadingCandidates.length > 0, "pack: raw headings in debug");

  const tp = runPackInvariant("theorem_proof", FIXTURE_THEOREM_PROOF.pages);
  const tpDiag = tp.extractionPipelineDiagnostics;
  assert.ok((tpDiag?.proofCandidateCount ?? 0) >= 1, "theorem fixture: proof candidates in diagnostics");

  const markedSmall = pageRecordsToMarkedFullText("t", buildPageRecordsFromParsedPages([{ pageNumber: 1, text: "a\nb" }]));
  const anchors = buildPageLineAnchorsFromMarkedText(markedSmall);
  const hit = resolvePageLineAtOffset(anchors, 20);
  assert.ok(hit && hit.pageNumber >= 1, "page/line offset map resolves");

  console.log("exam-pack-universal-regression.test.ts: ok", ALL_UNIVERSAL_FIXTURES.length, "fixtures");
}

main();
