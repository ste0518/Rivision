import { buildRevisionPack, emptyExamPriorityMap } from "@/lib/course-priority";
import { buildRevisionItemsFromStudentPack, buildStudentRevisionPackFromApiItems, generateQuickPracticeQuestions, generateStudentRevisionPack, type PackSourceFile } from "@/lib/revision-pack-generator";
import type { ExamPackJobResult, ExtractionMode } from "@/lib/jobs/types";
import type { ExtractionVerificationReport, RevisionItem } from "@/lib/types";
import type { runLlmExtractionPipeline } from "@/lib/llm/pipeline";

type PipelineResult = Awaited<ReturnType<typeof runLlmExtractionPipeline>>;

export function mergeChunkPipelineResults(input: {
  jobId: string;
  mode: ExtractionMode;
  sourceFiles: PackSourceFile[];
  chunkResults: PipelineResult[];
}): ExamPackJobResult {
  const items = dedupeItems(input.chunkResults.flatMap((result) => result.items));
  const needsReviewItems = dedupeItems(input.chunkResults.flatMap((result) => result.needsReviewItems));
  const rejectedItems = input.chunkResults.flatMap((result) => result.rejectedItems);
  const embeddedItems = input.chunkResults.flatMap((result) => result.embeddedItems);
  const examPriorityMap = input.chunkResults[0]?.examPriorityMap ?? emptyExamPriorityMap();
  const revisionPack = buildRevisionPack({ keptItems: items, needsReviewItems, rejectedItems, examPriorityMap });
  const basePack = generateStudentRevisionPack({
    files: input.sourceFiles,
    settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
  });
  const pack = buildStudentRevisionPackFromApiItems(basePack, [...items, ...needsReviewItems]);
  const generatedCards = buildRevisionItemsFromStudentPack(pack);
  const finalItems = generatedCards.length > 0 ? generatedCards : items;
  const verification = mergeVerification(input.chunkResults.map((result) => result.verification));

  return {
    jobId: input.jobId,
    generatedAt: new Date().toISOString(),
    mode: input.mode,
    pack,
    practiceQuestions: generateQuickPracticeQuestions(pack, input.mode === "fast" ? 10 : 18),
    extraction: {
      items: finalItems,
      needsReviewItems,
      rejectedItems,
      embeddedItems,
      courseStructureMap: input.chunkResults[0]?.courseStructureMap ?? { chapters: [], sections: [], topicGraph: [] },
      courseKnowledgeMap: input.chunkResults[0]?.courseKnowledgeMap ?? { courseType: "unknown", topics: [], formulas: [], proofExpectations: [], methodTemplates: [], commonMistakes: [] },
      examPriorityMap,
      revisionPack,
      curationReport: input.chunkResults[0]?.curationReport ?? { keptCount: items.length, needsReviewCount: needsReviewItems.length, rejectedCount: rejectedItems.length, embeddedCount: embeddedItems.length, totalCandidates: items.length + needsReviewItems.length + rejectedItems.length, notes: [] },
      verification,
    },
  };
}

function dedupeItems<T extends RevisionItem>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.conceptName || item.title}:${item.statement}`.toLowerCase().replace(/\s+/g, " ").slice(0, 220);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeVerification(reports: ExtractionVerificationReport[]): ExtractionVerificationReport {
  return {
    missingCandidates: reports.flatMap((report) => report.missingCandidates ?? []).slice(0, 80),
    suspiciousItems: reports.flatMap((report) => report.suspiciousItems ?? []).slice(0, 80),
    guidanceAmbiguities: reports.flatMap((report) => report.guidanceAmbiguities ?? []).slice(0, 80),
    overallCompleteness: reports.some((report) => report.overallCompleteness === "low") ? "medium" : "high",
    notes: reports.map((report) => report.notes).filter(Boolean).join("\n"),
  };
}
