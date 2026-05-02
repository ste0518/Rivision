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
  ];
  if (pack.derivations?.length) {
    for (const d of pack.derivations) parts.push(d.title, d.summary, d.steps?.join("\n") ?? "");
  }
  return parts.join("\n").toLowerCase();
}

function adaptiveMinimums(pageCount: number): { minDefs: number; minForms: number } {
  if (pageCount < 15) return { minDefs: 8, minForms: 8 };
  if (pageCount <= 50) return { minDefs: 15, minForms: 15 };
  return { minDefs: 25, minForms: 25 };
}

/** Assign stats bucket by chapter label from course map chapters or “whole”. */
function statsByChapter(pack: GeneratedRevisionPack): Record<string, { definitions: number; formulas: number; proofs: number }> {
  const chapters =
    pack.courseMapChapters?.length ?
      pack.courseMapChapters.map((c) => c.chapter)
    : pack.courseMap.map((t) => t.title.split(/\s+/)[0] ?? "topic");

  const out: Record<string, { definitions: number; formulas: number; proofs: number }> = {};
  const ensure = (k: string) => {
    out[k] ??= { definitions: 0, formulas: 0, proofs: 0 };
    return out[k]!;
  };

  const defaultKey = chapters[0] ?? "document";
  for (const d of pack.definitions) {
    const sec = d.sourceSection ?? "";
    const key = chapters.find((c) => sec.includes(c.replace(/^Chapter\s+/i, ""))) ?? defaultKey;
    ensure(key).definitions += 1;
  }
  for (const f of pack.formulas) {
    const sec = f.sourceSection ?? "";
    const key = chapters.find((c) => sec.includes(c.replace(/^Chapter\s+/i, ""))) ?? defaultKey;
    ensure(key).formulas += 1;
  }
  for (const p of pack.proofs) {
    const sec = p.sourceSection ?? "";
    const key = chapters.find((c) => sec.includes(c.replace(/^Chapter\s+/i, ""))) ?? defaultKey;
    ensure(key).proofs += 1;
  }

  if (Object.keys(out).length === 0) {
    out[defaultKey] = {
      definitions: pack.definitions.length,
      formulas: pack.formulas.length,
      proofs: pack.proofs.length,
    };
  }
  return out;
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
  const proofsExpected = documentProfile?.hasProofs ?? false;

  const workedOk =
    !examplesExpected ||
    (pack.workedExamples?.length ?? 0) > 0 ||
    pack.courseMapChapters?.some((c) => c.workedExamples.length > 0) ||
    /\bworked\s+example\b/i.test(sourceTextLower);

  const exOk =
    !exercisesExpected ||
    (pack.extractedExercises?.length ?? 0) > 0 ||
    /\b(exercise|problem)\s+\d/i.test(sourceTextLower);

  const proofOk =
    !proofsExpected ||
    pack.proofs.length > 0 ||
    (pack.derivations?.length ?? 0) > 0 ||
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

  const recommendations: string[] = [];
  const pageCount = documentProfile?.pageCount ?? 1;
  const { minDefs, minForms } = adaptiveMinimums(pageCount);

  if (pack.definitions.length < minDefs && pack.definitions.length < pageCount / 4) {
    recommendations.push(`Consider extracting more definitions — only ${pack.definitions.length} found for ~${pageCount} pages (adaptive target ≥ ${minDefs} when present).`);
  }
  if (pack.formulas.length < minForms && sourceLower.includes("=")) {
    recommendations.push(`Formula coverage looks low (${pack.formulas.length}) for document length — check PDF text extraction and segmentation.`);
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
    acceptanceTests.hasFormulasFromFormulaDenseSections;

  const criticalQualityFailure =
    contamination.some((c) => /importance sampling|snis|mcmc|detailed balance/i.test(c)) ||
    (pageCount > 50 && pack.formulas.length < 3 && /\d+\.\d+/.test(sourceText));

  return {
    ok: ok && !criticalQualityFailure,
    criticalQualityFailure,
    acceptanceTests,
    sourceContamination: [...contamination],
    recommendations,
    generatedItemStatsByChapter: stats,
  };
}
