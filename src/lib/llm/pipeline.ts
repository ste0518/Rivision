import { OpenAiResponsesProvider } from "@/lib/llm/openai-provider";
import type { LlmPipelineSettings } from "@/lib/llm/provider";
import { defaultLlmPipelineSettings } from "@/lib/llm/provider";
import { buildRevisionPack, emptyExamPriorityMap } from "@/lib/course-priority";
import type { CourseKnowledgeMap, CourseStructureMap, CurationReport, EmbeddedRevisionItem, ExamPriorityMap, ExtractionVerificationReport, ParsedDocument, RejectedRevisionItem, RevisionItem, RevisionPack } from "@/lib/types";

export async function runLlmExtractionPipeline(input: {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  pastPaperDocuments?: ParsedDocument[];
  problemSheetDocuments?: ParsedDocument[];
  solutionDocuments?: ParsedDocument[];
  settings?: Partial<LlmPipelineSettings>;
}): Promise<{
  items: RevisionItem[];
  needsReviewItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  courseStructureMap: CourseStructureMap;
  courseKnowledgeMap: CourseKnowledgeMap;
  examPriorityMap: ExamPriorityMap;
  revisionPack: RevisionPack;
  curationReport: CurationReport;
  verification: ExtractionVerificationReport;
}> {
  const settings = { ...defaultLlmPipelineSettings, ...input.settings };
  const primary = new OpenAiResponsesProvider({ model: settings.primaryModel });

  if (settings.mode === "cheap_scan_then_verify") {
    const cheap = new OpenAiResponsesProvider({ model: settings.cheapModel });
    await cheap.curateRevisionDeck({
      notesDocuments: input.notesDocuments,
      guidanceDocuments: input.guidanceDocuments,
      pastPaperDocuments: input.pastPaperDocuments ?? [],
      problemSheetDocuments: input.problemSheetDocuments ?? [],
      solutionDocuments: input.solutionDocuments ?? [],
      pipelineMode: settings.mode,
    });
  }

  const curated = await primary.curateRevisionDeck({
    notesDocuments: input.notesDocuments,
    guidanceDocuments: input.guidanceDocuments,
    pastPaperDocuments: input.pastPaperDocuments ?? [],
    problemSheetDocuments: input.problemSheetDocuments ?? [],
    solutionDocuments: input.solutionDocuments ?? [],
    pipelineMode: settings.mode,
  });

  const verification = await primary.verifyExtractionCompleteness({
    notesDocuments: input.notesDocuments,
    guidanceDocuments: input.guidanceDocuments,
    extractedItems: [...curated.keptItems, ...curated.needsReviewItems],
  });

  return {
    items: curated.keptItems,
    needsReviewItems: curated.needsReviewItems,
    rejectedItems: curated.rejectedItems,
    embeddedItems: curated.embeddedItems,
    courseStructureMap: curated.courseStructureMap,
    courseKnowledgeMap: curated.courseKnowledgeMap,
    examPriorityMap: curated.examPriorityMap ?? emptyExamPriorityMap(),
    revisionPack: curated.revisionPack ?? buildRevisionPack({ keptItems: curated.keptItems, needsReviewItems: curated.needsReviewItems, rejectedItems: curated.rejectedItems, examPriorityMap: curated.examPriorityMap ?? emptyExamPriorityMap() }),
    curationReport: curated.curationReport,
    verification,
  };
}
