/**
 * Document-generic validation for locally generated study packs.
 */

import type { DocumentProfile } from "@/lib/document-profile";
import { detectSourceContamination } from "@/lib/document-profile";
import type { GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";

export type GenericAcceptanceTests = {
  hasDocumentProfile: boolean;
  hasChapterMap: boolean;
  hasDefinitionsForMainTopics: boolean;
  hasFormulasFromFormulaDenseSections: boolean;
  hasWorkedExamplesIfPresent: boolean;
  hasExercisesIfPresent: boolean;
  hasProofsIfPresent: boolean;
  noSourceContamination: boolean;
  noDuplicateQuizQuestions: boolean;
  noOverlongBlocks: boolean;
  noBibliographyLeakage: boolean;
  noBadMathTokensInStudyPack: boolean;
};

export type GenericStudyPackValidation = {
  ok: boolean;
  criticalQualityFailure: boolean;
  acceptanceTests: GenericAcceptanceTests;
  sourceContamination: string[];
  recommendations: string[];
  generatedItemStatsByChapter: Record<string, { definitions: number; formulas: number; proofs: number }>;
};

function normaliseQuizKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9? ]/g, "")
    .trim()
    .slice(0, 140);
}

function collectPackBlob(pack: GeneratedRevisionPack): string {
  const parts: string[] = [
    pack.examOverview.summary,
    pack.examOverview.courseName ?? "",
    pack.examOverview.likelyExamStructure,
    ...pack.definitions.flatMap((d) => [d.term, d.definition]),
    ...pack.formulas.flatMap((f) => [f.name, f.latex, f.whenToUse]),
    ...pack.proofs.flatMap((p) => [p.name, p.statement, p.proofSkeleton]),
    ...pack.methods.flatMap((m) => [m.problemType, ...m.steps]),
    ...(pack.cramSheet?.trapBullets ?? []),
    ...(pack.cramSheet?.formulaBullets ?? []),
  ];
  if (pack.derivations?.length) {
    for (const d of pack.derivations) parts.push(d.title, d.summary, d.steps?.join("\n") ?? "");
  }
  if (pack.proofsAndDerivations?.length) {
    for (const d of pack.proofsAndDerivations) parts.push(d.title, d.summary, d.steps?.join("\n") ?? "");
  }
  return parts.join("\n").toLowerCase();
}

function adaptiveMinimums(pageCount: number): { minDefs: number; minForms: number } {
  if (pageCount < 15) return { minDefs: 8, minForms: 8 };
  if (pageCount <= 50) return { minDefs: 15, minForms: 15 };
  return { minDefs: 25, minForms: 25 };
}

/** Assign stats bucket using {@link DocumentProfile.chapterMap} page spans when available. */
function statsByChapter(pack: GeneratedRevisionPack): Record<string, { definitions: number; formulas: number; proofs: number }> {
  const map = pack.documentProfile?.chapterMap ?? [];
  const resolveKey = (page?: number | null, section?: string | null) => {
    if (page != null && map.length) {
      const hit = map.find((ch) => page >= ch.startPage && page <= ch.endPage);
      if (hit) return hit.chapterLabel || hit.chapterTitle || "chapter";
    }
    const sec = section ?? "";
    const titles =
      pack.courseMapChapters?.map((c) => c.chapter) ??
      pack.courseMap.map((t) => t.title);
    const bySection = titles.find((c) => sec.includes(c.replace(/^Chapter\s+/i, "").slice(0, 24)));
    return bySection ?? titles[0] ?? "document";
  };

  const out: Record<string, { definitions: number; formulas: number; proofs: number }> = {};
  const ensure = (k: string) => {
    out[k] ??= { definitions: 0, formulas: 0, proofs: 0 };
    return out[k]!;
  };

  for (const d of pack.definitions) ensure(resolveKey(d.sourcePage, d.sourceSection)).definitions += 1;
  for (const f of pack.formulas) ensure(resolveKey(f.sourcePage, f.sourceSection)).formulas += 1;
  for (const p of pack.proofs) ensure(resolveKey(p.sourcePage, p.sourceSection)).proofs += 1;

  if (Object.keys(out).length === 0) {
    const k = map[0]?.chapterLabel ?? map[0]?.chapterTitle ?? "document";
    out[k] = {
      definitions: pack.definitions.length,
      formulas: pack.formulas.length,
      proofs: pack.proofs.length,
    };
  }
  return out;
}

/** Extra acceptance checks for long mathematical lecture notes (generic thresholds, not one PDF). */
export function validateLongMathLectureNotes(pack: GeneratedRevisionPack, profile: DocumentProfile | null): { ok: boolean; issues: string[] } {
  if (!profile || profile.documentType !== "lecture_notes" || profile.pageCount <= 50) return { ok: true, issues: [] };

  const issues: string[] = [];
  if (profile.chapterMap.length < 2) issues.push("chapterMap has fewer than 2 chapters — segmentation may have missed Chapter banners.");

  const blocks = pack.sectionBlocks ?? [];
  const nonWhole = blocks.filter((b) => !/whole/i.test(b.sectionId));
  if (nonWhole.length < 10 && blocks.length < 10) issues.push("Fewer than 10 section blocks — numbered headings may not have been detected.");

  const diag = pack.extractionPipelineDiagnostics;
  const cand = diag?.formulaCandidateCount ?? 0;
  if (cand >= 20 && pack.formulas.length < 20) issues.push("Formula count is far below formulaCandidateCount — check OCR cleanup or line filtering.");

  const proofSignals = profile.proofLikeMarkersInSource || profile.hasProofs;
  const proofCand = diag?.proofCandidateCount ?? 0;
  const mergedProofs = (pack.proofsAndDerivations?.length ?? 0) + (pack.derivations?.length ?? 0);
  if (proofSignals && proofCand >= 5 && mergedProofs < 5) issues.push("Proof-like markers in source but merged proofs/derivations are sparse.");

  if (
    blocks.length === 1 &&
    /whole/i.test(blocks[0]?.sectionId ?? "") &&
    profile.pageCount > 40
  ) {
    issues.push("Single whole-document section block on a long PDF — headings likely not detected.");
  }

  return { ok: issues.length === 0, issues };
}

export function computeGenericAcceptanceTests(input: {
  pack: GeneratedRevisionPack;
  documentProfile: DocumentProfile | null;
  sourceTextLower: string;
  badMathTokenCount: number;
  duplicateQuizPrompts: string[];
  overlongBlocks: string[];
  bibliographyInPack: boolean;
  contaminationLines: string[];
  quiz?: GeneratedPracticeQuestion[];
}): GenericAcceptanceTests {
  const { pack, documentProfile, sourceTextLower, badMathTokenCount, duplicateQuizPrompts, overlongBlocks, bibliographyInPack, contaminationLines, quiz } =
    input;

  const pageCount = documentProfile?.pageCount ?? 1;
  const { minDefs, minForms } = adaptiveMinimums(pageCount);
  const topics = documentProfile?.detectedTopics ?? [];
  const topicHits = topics.filter((t) =>
    pack.definitions.some((d) => d.term.toLowerCase().includes(t.toLowerCase()) || d.definition.toLowerCase().includes(t.toLowerCase())),
  ).length;

  const formulaDense =
    /\b(where|defined\s+as|given\s+by|follows)\b/i.test(sourceTextLower) ||
    (sourceTextLower.match(/[=∑∫]/g)?.length ?? 0) > pageCount * 2;

  const defsFloor = topics.length ? Math.min(minDefs, Math.max(8, Math.floor(topics.length * 0.35))) : Math.min(minDefs, 12);
  const defsOk = pack.definitions.length >= defsFloor || (topics.length > 0 && topicHits >= Math.min(4, topics.length));

  const formsOk =
    !formulaDense ?
      pack.formulas.length >= 1
    : pack.formulas.length >= Math.min(minForms, 12) || pack.formulas.length >= Math.max(8, Math.floor(pageCount / 5));

  const examplesExpected = documentProfile?.hasWorkedExamples ?? false;
  const exercisesExpected = documentProfile?.hasExercises ?? false;
  const proofsExpected = documentProfile?.proofLikeMarkersInSource ?? documentProfile?.hasProofs ?? false;

  const workedOk =
    !examplesExpected ||
    (pack.workedExamples?.length ?? 0) > 0 ||
    pack.courseMapChapters?.some((c) => c.workedExamples.length > 0) ||
    /\bworked\s+example\b/i.test(sourceTextLower);

  const exOk =
    !exercisesExpected ||
    (pack.extractedExercises?.length ?? 0) > 0 ||
    /\b(exercise|problem)\s+\d/i.test(sourceTextLower);

  const proofExtracted =
    pack.proofs.length + (pack.derivations?.length ?? 0) + (pack.proofsAndDerivations?.length ?? 0);

  const proofOk =
    !proofsExpected ||
    proofExtracted > 0 ||
    /\bproof\b/i.test(sourceTextLower);

  const dupes =
    quiz?.length ?
      (() => {
        const seen = new Map<string, number>();
        for (const q of quiz) {
          const k = normaliseQuizKey(q.question ?? "");
          if (k.length < 12) continue;
          seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        return [...seen.values()].some((n) => n > 1);
      })()
    : false;

  return {
    hasDocumentProfile: Boolean(documentProfile),
    hasChapterMap: Boolean(documentProfile?.chapterMap?.length || pack.courseMapChapters?.length),
    hasDefinitionsForMainTopics: defsOk,
    hasFormulasFromFormulaDenseSections: formsOk,
    hasWorkedExamplesIfPresent: workedOk,
    hasExercisesIfPresent: exOk,
    hasProofsIfPresent: proofOk,
    noSourceContamination: contaminationLines.length === 0,
    noDuplicateQuizQuestions: duplicateQuizPrompts.length === 0 && !dupes,
    noOverlongBlocks: overlongBlocks.length === 0,
    noBibliographyLeakage: !bibliographyInPack,
    noBadMathTokensInStudyPack: badMathTokenCount === 0,
  };
}

export function validateGenericStudyPack(pack: GeneratedRevisionPack, documentProfile: DocumentProfile | null, sourceText: string): GenericStudyPackValidation {
  const sourceLower = sourceText.toLowerCase();
  const blob = collectPackBlob(pack);
  const contamination = detectSourceContamination(blob, sourceLower);
  const longNotes = validateLongMathLectureNotes(pack, documentProfile);

  const recommendations: string[] = [];
  const pageCount = documentProfile?.pageCount ?? 1;
  const { minDefs, minForms } = adaptiveMinimums(pageCount);

  if (pack.definitions.length < minDefs && pack.definitions.length < pageCount / 4) {
    recommendations.push(`Consider extracting more definitions — only ${pack.definitions.length} found for ~${pageCount} pages (adaptive target ≥ ${minDefs} when present).`);
  }
  if (pack.formulas.length < minForms && sourceLower.includes("=")) {
    recommendations.push(`Formula coverage looks low (${pack.formulas.length}) for document length — check PDF text extraction and segmentation.`);
  }
  for (const issue of longNotes.issues) {
    if (!recommendations.includes(issue)) recommendations.push(issue);
  }

  const stats = statsByChapter(pack);

  const acceptanceTests = computeGenericAcceptanceTests({
    pack,
    documentProfile,
    sourceTextLower: sourceLower,
    badMathTokenCount: 0,
    duplicateQuizPrompts: [],
    overlongBlocks: [],
    bibliographyInPack: /\bBIBLIOGRAPHY\b/i.test(blob),
    contaminationLines: [...contamination],
    quiz: undefined,
  });

  const ok =
    acceptanceTests.noSourceContamination &&
    acceptanceTests.noBibliographyLeakage &&
    acceptanceTests.hasDefinitionsForMainTopics &&
    acceptanceTests.hasFormulasFromFormulaDenseSections &&
    longNotes.ok;

  const criticalQualityFailure =
    contamination.some((c) => /importance sampling|snis|mcmc|detailed balance/i.test(c)) ||
    (pageCount > 50 && pack.formulas.length < 3 && /\d+\.\d+/.test(sourceText)) ||
    !longNotes.ok;

  return {
    ok: ok && !criticalQualityFailure,
    criticalQualityFailure,
    acceptanceTests,
    sourceContamination: [...contamination],
    recommendations,
    generatedItemStatsByChapter: stats,
  };
}
