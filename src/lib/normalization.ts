import { normaliseRevisionItem } from "@/lib/revision-item-utils";
import type {
  CardPurpose,
  ClassificationConfidence,
  CourseKnowledgeMap,
  CourseStructureMap,
  CuratedRevisionResult,
  CurationDecision,
  CurationReport,
  CurationStatus,
  EmbeddedRevisionItem,
  ExamPriorityMap,
  RejectedRevisionItem,
  RejectionCategory,
  RevisionImportance,
  RevisionItem,
  RevisionPack,
  RevisionItemType,
  PriorityLabel,
  RevisionPackCategory,
  StandaloneValue,
} from "@/lib/types";
import { buildRevisionPack, emptyExamPriorityMap, priorityLabelFromScore } from "@/lib/course-priority";
import { createId } from "@/lib/utils";

const revisionItemTypes: RevisionItemType[] = ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "assumption", "property", "other"];
const importances: RevisionImportance[] = ["must_know", "partial", "not_required", "unknown"];
const cardPurposes: CardPurpose[] = ["definition_recall", "model_definition", "condition_recall", "theorem_statement", "proof_recall", "formula_recall", "method_steps", "test_statistic", "conceptual_distinction", "application_condition", "calculation_template", "worked_example_pattern", "background_context", "needs_review"];
const decisions: CurationDecision[] = ["keep", "needs_review", "reject", "embed_in_parent"];
const statuses: CurationStatus[] = ["kept", "needs_review"];
const standaloneValues: StandaloneValue[] = ["high", "medium", "low"];
const confidenceValues: ClassificationConfidence[] = ["high", "medium", "low"];
const priorityLabels: PriorityLabel[] = ["very_high", "high", "medium", "low", "unknown"];
const revisionPackCategories: RevisionPackCategory[] = ["mustKnowDefinitions", "theoremStatements", "proofsToKnow", "formulasToKnow", "methodsAndTemplates", "conceptualDistinctions", "modelsToKnow", "conditionsAndEquivalences", "testStatisticsAndDiagnostics", "workedExamplePatterns", "needsReview", "rejected"];
const rejectionCategories: RejectionCategory[] = ["bibliography_or_reference", "ordinary_explanatory_text", "formula_not_standalone", "intermediate_proof_step", "duplicate", "too_broad", "not_examinable", "background_only", "low_value", "parse_noise"];

export function normalizeRevisionItem(raw: unknown): RevisionItem {
  const value = isRecord(raw) ? raw : {};
  const now = new Date().toISOString();
  const type = enumValue(value.type, revisionItemTypes, "other") ?? "other";
  const curationDecision = normalizeCurationDecision(value.curationDecision);
  const curationStatus = enumValue(value.curationStatus, statuses, curationDecision === "needs_review" ? "needs_review" : "kept");
  const statement = stringValue(value.statement) || stringValue(value.answer) || stringValue(value.originalRawText);
  const title = stringValue(value.title) || stringValue(value.displayTitle) || stringValue(value.conceptName) || defaultTitle(type);
  const cardFront = stringValue(value.cardFront) || stringValue(value.conceptName) || title;
  const answer = stringValue(value.answer) || statement || title;

  const priorityScore = clampScore(numberValue(value.priorityScore) ?? legacyPriorityScore(value));
  return normaliseRevisionItem({
    id: stringValue(value.id) || createId("card"),
    type,
    title,
    conceptName: optionalString(value.conceptName),
    displayTitle: optionalString(value.displayTitle) || title,
    cardFront,
    taskPrompt: optionalString(value.taskPrompt),
    statement: statement || answer,
    statementLatex: optionalString(value.statementLatex),
    originalRawText: optionalString(value.originalRawText) || statement || answer,
    proof: optionalString(value.proof),
    proofLatex: optionalString(value.proofLatex),
    proofRequired: typeof value.proofRequired === "boolean" ? value.proofRequired : undefined,
    sourceFile: stringValue(value.sourceFile) || "Unknown source",
    sourceLocation: optionalString(value.sourceLocation),
    pageNumber: numberValue(value.pageNumber),
    section: optionalString(value.section),
    theoremNumber: optionalString(value.theoremNumber),
    tags: stringArray(value.tags),
    importance: enumValue(value.importance, importances, "unknown"),
    cardPurpose: enumValue(value.cardPurpose, cardPurposes, fallbackCardPurpose(type, curationDecision)),
    curationStatus,
    classificationConfidence: enumValue(value.classificationConfidence, confidenceValues, undefined),
    guidanceReason: optionalString(value.guidanceReason),
    guidanceEvidence: stringArray(value.guidanceEvidence),
    uncertaintyNote: optionalString(value.uncertaintyNote),
    extractionWarning: optionalString(value.extractionWarning),
    questionPrompt: stringValue(value.questionPrompt) || fallbackQuestionPrompt(type, title),
    answer,
    answerLatex: optionalString(value.answerLatex),
    standaloneValue: enumValue(value.standaloneValue, standaloneValues, undefined),
    curationDecision,
    curationReason: optionalString(value.curationReason),
    parentItemId: optionalString(value.parentItemId),
    embeddedFormulas: stringArray(value.embeddedFormulas),
    latexQuality: enumValue(value.latexQuality, ["high", "medium", "low"] as const, undefined),
    relevanceReason: optionalString(value.relevanceReason),
    relevanceScore: isRecord(value.relevanceScore) ? value.relevanceScore as unknown as RevisionItem["relevanceScore"] : undefined,
    priorityScore,
    priorityLabel: enumValue(value.priorityLabel, priorityLabels, priorityLabelFromScore(priorityScore)),
    evidenceSignals: normalizeEvidenceSignals(value.evidenceSignals),
    whyThisCardMatters: stringValue(value.whyThisCardMatters) || stringValue(value.relevanceReason) || stringValue(value.curationReason) || "Legacy card without priority evidence.",
    revisionPackCategory: enumValue(value.revisionPackCategory, revisionPackCategories, undefined),
    deletedAt: optionalString(value.deletedAt),
    isDeleted: Boolean(value.isDeleted),
    createdAt: stringValue(value.createdAt) || now,
    updatedAt: stringValue(value.updatedAt) || now,
    warnings: stringArray(value.warnings),
    latestRating: enumValue(value.latestRating, ["again", "hard", "good", "easy"] as const, undefined),
    reviewCount: numberValue(value.reviewCount),
    dueAt: optionalString(value.dueAt),
    lastReviewedAt: optionalString(value.lastReviewedAt),
  });
}

export function migrateStoredCards(rawCards: unknown): RevisionItem[] {
  if (!Array.isArray(rawCards)) return [];
  return rawCards.flatMap((card) => {
    try {
      return [normalizeRevisionItem(card)];
    } catch {
      return [];
    }
  });
}

export function normalizeCuratedRevisionResult(raw: unknown): CuratedRevisionResult {
  const value = isRecord(raw) ? raw : {};
  const keptItems = migrateStoredCards(value.keptItems ?? value.items);
  const needsReviewItems = migrateStoredCards(value.needsReviewItems).map((item) => ({
    ...item,
    curationDecision: "needs_review" as const,
    curationStatus: "needs_review" as const,
  }));
  const rejectedItems = normalizeRejectedItems(value.rejectedItems);
  const embeddedItems = normalizeEmbeddedItems(value.embeddedItems);
  const examPriorityMap = normalizeExamPriorityMap(value.examPriorityMap);
  const revisionPack = normalizeRevisionPack(value.revisionPack, keptItems, needsReviewItems, rejectedItems, examPriorityMap);

  return {
    keptItems,
    needsReviewItems,
    rejectedItems,
    embeddedItems,
    courseStructureMap: normalizeCourseStructureMap(value.courseStructureMap),
    courseKnowledgeMap: normalizeCourseKnowledgeMap(value.courseKnowledgeMap),
    examPriorityMap,
    revisionPack,
    curationReport: normalizeCurationReport(value.curationReport, keptItems.length, needsReviewItems.length, rejectedItems.length, embeddedItems.length),
  };
}

export function emptyCuratedRevisionResult(): CuratedRevisionResult {
  return normalizeCuratedRevisionResult({});
}

function normalizeRejectedItems(raw: unknown): RejectedRevisionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    const originalItem = item.originalItem ? normalizeRevisionItem(item.originalItem) : undefined;
    return [{
      id: stringValue(item.id) || createId("rejected"),
      originalCandidateId: optionalString(item.originalCandidateId),
      originalItem,
      title: stringValue(item.title) || originalItem?.title || "Rejected item",
      type: enumValue(item.type, revisionItemTypes, "other"),
      rawText: optionalString(item.rawText),
      rejectionReason: stringValue(item.rejectionReason) || stringValue(item.reason) || "Rejected during curation.",
      rejectionCategory: enumValue(item.rejectionCategory, rejectionCategories, "low_value"),
      confidence: enumValue(item.confidence, confidenceValues, "medium"),
      sourceLocation: optionalString(item.sourceLocation),
    }];
  });
}

function normalizeEmbeddedItems(raw: unknown): EmbeddedRevisionItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      id: stringValue(item.id) || createId("embedded"),
      parentItemId: stringValue(item.parentItemId),
      content: stringValue(item.content),
      reason: stringValue(item.reason) || "Embedded into parent card.",
      sourceLocation: optionalString(item.sourceLocation),
    }];
  });
}

function normalizeCourseStructureMap(raw: unknown): CourseStructureMap {
  if (!isRecord(raw)) return { sections: [], topics: [], detectedItems: [] };
  return {
    sections: Array.isArray(raw.sections) ? raw.sections.flatMap((section) => isRecord(section) ? [{
      sectionNumber: optionalString(section.sectionNumber),
      title: stringValue(section.title) || "Untitled section",
      sourceFile: stringValue(section.sourceFile) || "Unknown source",
      pageStart: numberValue(section.pageStart),
      pageEnd: numberValue(section.pageEnd),
      summary: stringValue(section.summary),
      likelyImportance: enumValue(section.likelyImportance, ["core", "supporting", "background", "unknown"] as const, "unknown"),
    }] : []) : [],
    topics: Array.isArray(raw.topics) ? raw.topics.flatMap((topic) => isRecord(topic) ? [{
      name: stringValue(topic.name) || "Unknown topic",
      section: optionalString(topic.section),
      relatedItems: stringArray(topic.relatedItems),
      importance: enumValue(topic.importance, ["core", "supporting", "background", "unknown"] as const, "unknown"),
      evidence: stringArray(topic.evidence),
      likelyExamUse: enumValue(topic.likelyExamUse, ["definition_recall", "theorem_statement", "proof", "calculation", "derivation", "conceptual_explanation", "model_interpretation", "mixed", "not_likely"] as const, "not_likely"),
    }] : []) : [],
    detectedItems: [],
  };
}

function normalizeCourseKnowledgeMap(raw: unknown): CourseKnowledgeMap {
  const value = isRecord(raw) ? raw : {};
  const formulaPolicy = recordValue(value.formulaPolicy);
  const proofPolicy = recordValue(value.proofPolicy);
  return {
    coreTopics: normalizeCourseStructureMap({ topics: value.coreTopics }).topics,
    requiredSections: Array.isArray(value.requiredSections) ? value.requiredSections.flatMap((section) => isRecord(section) ? [{
      sectionNumber: optionalString(section.sectionNumber),
      sectionTitle: optionalString(section.sectionTitle),
      requirement: enumValue(section.requirement, ["must_know", "statement_only", "proof_required", "proof_not_required", "understand_only", "not_required", "unknown"] as const, "unknown"),
      evidence: stringArray(section.evidence),
    }] : []) : [],
    formulaPolicy: {
      standaloneFormulaRule: stringValue(formulaPolicy.standaloneFormulaRule) || "Only named, central, examinable formulas become standalone cards.",
      keepStandaloneWhen: stringArray(formulaPolicy.keepStandaloneWhen),
      embedOrRejectWhen: stringArray(formulaPolicy.embedOrRejectWhen),
      guidanceEvidence: stringArray(formulaPolicy.guidanceEvidence),
    },
    proofPolicy: {
      proofCardRule: stringValue(proofPolicy.proofCardRule) || "Create proof-recall cards only when guidance asks for proof or derivation.",
      proofRequiredWhen: stringArray(proofPolicy.proofRequiredWhen),
      proofOptionalWhen: stringArray(proofPolicy.proofOptionalWhen),
      guidanceEvidence: stringArray(proofPolicy.guidanceEvidence),
    },
  };
}

function normalizeCurationReport(raw: unknown, keptCount: number, needsReviewCount: number, rejectedCount: number, embeddedCount: number): CurationReport {
  const value = isRecord(raw) ? raw : {};
  return {
    totalCandidates: numberValue(value.totalCandidates) ?? keptCount + needsReviewCount + rejectedCount + embeddedCount,
    keptCount: numberValue(value.keptCount) ?? keptCount,
    needsReviewCount: numberValue(value.needsReviewCount) ?? needsReviewCount,
    rejectedCount: numberValue(value.rejectedCount) ?? rejectedCount,
    embeddedCount: numberValue(value.embeddedCount) ?? embeddedCount,
    formulaCandidates: numberValue(value.formulaCandidates) ?? 0,
    formulaKeptCount: numberValue(value.formulaKeptCount) ?? 0,
    formulaRejectedCount: numberValue(value.formulaRejectedCount) ?? 0,
    mainTopics: stringArray(value.mainTopics),
    weakParsingWarnings: stringArray(value.weakParsingWarnings),
    pipelineStages: Array.isArray(value.pipelineStages) ? value.pipelineStages.flatMap((stage) => isRecord(stage) ? [{
      name: stringValue(stage.name) || "Pipeline stage",
      status: enumValue(stage.status, ["complete", "warning", "error"] as const, "complete"),
      detail: stringValue(stage.detail),
    }] : []) : undefined,
    courseType: enumValue(value.courseType, ["time_series", "spatial_statistics", "financial_math", "statistics", "probability", "linear_algebra", "calculus", "machine_learning", "generic_math", "unknown"] as const, undefined),
    packCompletenessScore: numberValue(value.packCompletenessScore),
    candidateCoverageScore: numberValue(value.candidateCoverageScore),
    latexQualityScore: numberValue(value.latexQualityScore),
    assessmentEvidenceCoverage: numberValue(value.assessmentEvidenceCoverage),
    notes: stringArray(value.notes),
  };
}

function normalizeEvidenceSignals(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [{
      sourceFile: stringValue(item.sourceFile) || "Unknown source",
      sourceRole: enumValue(item.sourceRole, ["lecture_notes", "exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "formula_sheet", "mark_scheme", "other"] as const, "other"),
      pageNumber: numberValue(item.pageNumber),
      excerpt: stringValue(item.excerpt),
      explanation: stringValue(item.explanation),
    }];
  });
}

function normalizeExamPriorityMap(raw: unknown): ExamPriorityMap {
  if (!isRecord(raw)) return emptyExamPriorityMap();
  return {
    topics: Array.isArray(raw.topics) ? raw.topics.flatMap((topic) => isRecord(topic) ? [{
      topicName: stringValue(topic.topicName) || "Unknown topic",
      sectionNumbers: stringArray(topic.sectionNumbers),
      priorityScore: numberValue(topic.priorityScore),
      priorityLabel: enumValue(topic.priorityLabel, priorityLabels, undefined),
      priority: enumValue(topic.priority, priorityLabels, enumValue(topic.priorityLabel, priorityLabels, "unknown")),
      evidence: normalizeEvidenceSignals(topic.evidence),
      likelyAssessmentModes: stringArray(topic.likelyAssessmentModes).filter((purpose): purpose is CardPurpose => cardPurposes.includes(purpose as CardPurpose)),
      likelyAssessmentMode: enumValue(topic.likelyAssessmentMode, ["definition_recall", "theorem_statement", "proof", "calculation", "derivation", "conceptual_explanation", "model_interpretation", "mixed"] as const, "mixed"),
      reason: optionalString(topic.reason),
    }] : []) : [],
    recurringQuestionTypes: Array.isArray(raw.recurringQuestionTypes) ? raw.recurringQuestionTypes.flatMap((item) => isRecord(item) ? [{
      name: stringValue(item.name) || "Question type",
      description: stringValue(item.description),
      relatedTopics: stringArray(item.relatedTopics),
      evidence: normalizeEvidenceSignals(item.evidence),
      cardPurposesSuggested: stringArray(item.cardPurposesSuggested).filter((purpose): purpose is CardPurpose => cardPurposes.includes(purpose as CardPurpose)),
    }] : []) : [],
    requiredDefinitions: normalizeRequiredSignals(raw.requiredDefinitions),
    requiredTheorems: normalizeRequiredSignals(raw.requiredTheorems),
    requiredProofs: normalizeRequiredSignals(raw.requiredProofs),
    requiredFormulas: normalizeRequiredSignals(raw.requiredFormulas),
    calculationTemplates: Array.isArray(raw.calculationTemplates) ? raw.calculationTemplates.flatMap((item) => isRecord(item) ? [{
      name: stringValue(item.name) || "Calculation template",
      relatedTopics: stringArray(item.relatedTopics),
      requiredSteps: stringArray(item.requiredSteps),
      evidence: normalizeEvidenceSignals(item.evidence),
    }] : []) : [],
    conceptualDistinctions: Array.isArray(raw.conceptualDistinctions) ? raw.conceptualDistinctions.flatMap((item) => isRecord(item) ? [{
      name: stringValue(item.name) || "Conceptual distinction",
      conceptsCompared: stringArray(item.conceptsCompared),
      evidence: normalizeEvidenceSignals(item.evidence),
    }] : []) : [],
    notes: stringArray(raw.notes),
  };
}

function normalizeRequiredSignals(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => isRecord(item) ? [{
    name: stringValue(item.name) || "Required item",
    itemType: enumValue(item.itemType, revisionItemTypes, "other"),
    priority: enumValue(item.priority, priorityLabels, "unknown"),
    evidence: normalizeEvidenceSignals(item.evidence),
  }] : []);
}

function normalizeRevisionPack(raw: unknown, keptItems: RevisionItem[], needsReviewItems: RevisionItem[], rejectedItems: RejectedRevisionItem[], examPriorityMap: ExamPriorityMap): RevisionPack {
  if (!isRecord(raw)) return buildRevisionPack({ keptItems, needsReviewItems, rejectedItems, examPriorityMap });
  return {
    overview: stringValue(raw.overview) || "Revision pack.",
    courseType: enumValue(raw.courseType, ["time_series", "spatial_statistics", "financial_math", "statistics", "probability", "linear_algebra", "calculus", "machine_learning", "generic_math", "unknown"] as const, undefined),
    topPriorityTopics: normalizeExamPriorityMap({ topics: raw.topPriorityTopics }).topics,
    topTopics: normalizeExamPriorityMap({ topics: raw.topTopics }).topics,
    coreDefinitions: migrateStoredCards(raw.coreDefinitions),
    mustKnowDefinitions: migrateStoredCards(raw.mustKnowDefinitions),
    modelsToKnow: migrateStoredCards(raw.modelsToKnow),
    conditionsAndEquivalences: migrateStoredCards(raw.conditionsAndEquivalences),
    keyFormulas: migrateStoredCards(raw.keyFormulas),
    theoremStatements: migrateStoredCards(raw.theoremStatements),
    testStatisticsAndDiagnostics: migrateStoredCards(raw.testStatisticsAndDiagnostics),
    proofsToKnow: migrateStoredCards(raw.proofsToKnow),
    proofCards: migrateStoredCards(raw.proofCards),
    formulasToKnow: migrateStoredCards(raw.formulasToKnow),
    methodsAndTemplates: migrateStoredCards(raw.methodsAndTemplates),
    conceptualDistinctions: migrateStoredCards(raw.conceptualDistinctions),
    workedExamplePatterns: migrateStoredCards(raw.workedExamplePatterns),
    needsReview: migrateStoredCards(raw.needsReview),
    rejected: normalizeRejectedItems(raw.rejected),
    embedded: normalizeEmbeddedItems(raw.embedded),
  };
}

function legacyPriorityScore(value: Record<string, unknown>) {
  const relevanceScore = recordValue(value.relevanceScore);
  const examRelevance = numberValue(relevanceScore.examRelevance) ?? 0;
  const guidanceSupport = numberValue(relevanceScore.guidanceSupport) ?? 0;
  const standaloneValue = numberValue(relevanceScore.standaloneFlashcardValue) ?? 0;
  return Math.round((examRelevance * 9) + (guidanceSupport * 7) + (standaloneValue * 4));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeCurationDecision(value: unknown): CurationDecision {
  if (value === "kept") return "keep";
  return enumValue(value, decisions, "keep");
}

function fallbackCardPurpose(type: RevisionItemType, decision: CurationDecision): CardPurpose {
  if (decision === "needs_review") return "needs_review";
  if (type === "definition") return "definition_recall";
  if (type === "formula") return "formula_recall";
  if (type === "proof") return "proof_recall";
  if (["theorem", "lemma", "proposition", "corollary"].includes(type)) return "theorem_statement";
  if (type === "algorithm") return "method_steps";
  return "background_context";
}

function fallbackQuestionPrompt(type: RevisionItemType, title: string) {
  if (type === "definition") return `State ${title}.`;
  if (["theorem", "lemma", "proposition", "corollary"].includes(type)) return `State ${title}.`;
  return `Explain ${title}.`;
}

function defaultTitle(type: RevisionItemType) {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T;
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: undefined): T | undefined;
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T | undefined {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  const string = stringValue(value).trim();
  return string || undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
