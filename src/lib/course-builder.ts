import { buildExamPriorityMap as buildLegacyExamPriorityMap, buildRevisionPack as buildLegacyRevisionPack, priorityLabelFromScore } from "@/lib/course-priority";
import { curateRevisionDeck } from "@/lib/curation";
import { attachProofsToPreviousTheorem, segmentRevisionCandidates } from "@/lib/segmentation";
import { convertCommonMathToLatex, validateLatexQuality } from "@/lib/revision-item-utils";
import type {
  AssessmentMap,
  CardPurpose,
  CourseFormula,
  CourseMap,
  CourseMethod,
  CourseModelFamily,
  CourseTest,
  CourseTopic,
  CourseTopicType,
  CourseType,
  CuratedDeckResult,
  ExamPriorityMap,
  ExamTopicPriority,
  ParsedDocument,
  PriorityLabel,
  RevisionCandidateKind,
  RevisionItem,
  SourceLocation,
  StudyFileRole,
  WorkedExamplePattern,
} from "@/lib/types";
import { createId } from "@/lib/utils";

export type CoursePackBuilderInput = {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  pastPaperDocuments?: ParsedDocument[];
  problemSheetDocuments?: ParsedDocument[];
  solutionDocuments?: ParsedDocument[];
  markSchemeDocuments?: ParsedDocument[];
};

type CandidateBlock = ReturnType<typeof segmentRevisionCandidates>[number];

const studyFileRoles: StudyFileRole[] = ["lecture_notes", "exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "formula_sheet", "mark_scheme", "other"];

const roleBoost: Record<StudyFileRole, number> = {
  lecture_notes: 0,
  exam_guidance: 20,
  past_paper: 30,
  problem_sheet: 20,
  solution_sheet: 15,
  formula_sheet: 10,
  mark_scheme: 25,
  other: 0,
};

const timeSeriesTopics: Array<{
  name: string;
  aliases: string[];
  type: CourseTopicType;
  kind: RevisionCandidateKind;
  purpose: CardPurpose;
}> = [
  topic("Strict stationarity", ["strict stationarity", "complete/strong/strict stationarity"], "definition", "implicit_definition", "definition_recall"),
  topic("Second-order stationarity", ["second-order stationarity", "weak stationarity", "covariance stationarity", "second-order/weak/covariance"], "definition", "implicit_definition", "definition_recall"),
  topic("Autocovariance sequence", ["autocovariance sequence", "acvs", "autocovariance"], "formula", "formula", "formula_recall"),
  topic("Autocorrelation sequence", ["autocorrelation sequence", "acf", "autocorrelation"], "formula", "formula", "formula_recall"),
  topic("Positive semidefinite ACVS", ["positive semidefinite acvs", "positive semi-definite acvs", "positive semidefinite autocovariance"], "condition", "condition", "condition_recall"),
  topic("Toeplitz covariance matrix", ["toeplitz covariance matrix", "toeplitz"], "formula", "formula", "formula_recall"),
  topic("Gaussian process", ["gaussian process", "gaussian stationarity"], "model", "model_definition", "model_definition"),
  topic("White noise process", ["white noise process", "white noise"], "model", "model_definition", "model_definition"),
  topic("MA(q) process", ["ma(q)", "moving average process"], "model", "model_definition", "model_definition"),
  topic("MA(1) ACF", ["ma(1) acf", "ma(1) autocorrelation"], "formula", "formula", "formula_recall"),
  topic("AR(p) process", ["ar(p)", "autoregressive process"], "model", "model_definition", "model_definition"),
  topic("AR(1) GLP form and ACF", ["ar(1)", "glp form", "ar(1) acf"], "model", "model_definition", "model_definition"),
  topic("ARMA(p,q)", ["arma(p,q)", "arma"], "model", "model_definition", "model_definition"),
  topic("ARCH(p)", ["arch(p)", "arch"], "model", "model_definition", "model_definition"),
  topic("Trend removal", ["trend removal", "remove trend", "detrend"], "method", "method_steps", "method_steps"),
  topic("Seasonal differencing", ["seasonal differencing", "seasonal difference"], "method", "method_steps", "method_steps"),
  topic("ARIMA(p,d,q)", ["arima(p,d,q)", "arima"], "model", "model_definition", "model_definition"),
  topic("General Linear Process", ["general linear process", "glp"], "model", "model_definition", "model_definition"),
  topic("Stationarity root condition", ["stationarity condition", "roots outside the unit circle"], "condition", "condition", "condition_recall"),
  topic("Invertibility root condition", ["invertibility condition", "roots outside the unit circle"], "condition", "condition", "condition_recall"),
  topic("ARMA(1,1) autocovariance worked example", ["arma(1,1)", "autocovariance worked example"], "worked_example", "worked_example", "worked_example_pattern"),
  topic("Spectral representation theorem", ["spectral representation theorem"], "definition", "theorem_statement", "proof_recall"),
  topic("Integrated spectrum", ["integrated spectrum"], "formula", "formula", "formula_recall"),
  topic("Spectral density function", ["spectral density function", "spectral density"], "formula", "formula", "formula_recall"),
  topic("Periodogram", ["periodogram"], "formula", "formula", "formula_recall"),
  topic("Direct spectral estimator", ["direct spectral estimator", "spectral estimator"], "method", "method_steps", "method_steps"),
  topic("Tapering trade-off", ["tapering", "tapering trade-off"], "conceptual_distinction", "conceptual_distinction", "conceptual_distinction"),
  topic("AR model fitting", ["ar model fitting", "fit ar model", "parametric ar model"], "method", "method_steps", "method_steps"),
  topic("Residual analysis", ["residual analysis", "residual diagnostics"], "method", "method_steps", "method_steps"),
  topic("Ljung-Box test", ["ljung-box", "ljung box"], "test", "test_statistic", "test_statistic"),
  topic("Forecasting", ["forecasting", "forecast"], "method", "method_steps", "method_steps"),
];

const spatialTopicSeeds = [
  topic("Random field", ["random field"], "model", "implicit_definition", "definition_recall"),
  topic("Gaussian random field", ["gaussian random field"], "model", "model_definition", "model_definition"),
  topic("Weak stationarity", ["weak stationarity", "weakly stationary"], "condition", "condition", "condition_recall"),
  topic("Strict stationarity", ["strict stationarity", "strictly stationary"], "condition", "condition", "condition_recall"),
  topic("Intrinsic stationarity", ["intrinsic stationarity", "intrinsically stationary"], "condition", "condition", "condition_recall"),
  topic("Semivariogram", ["semivariogram", "semi-variogram", "variogram"], "formula", "formula", "formula_recall"),
  topic("Isotropy", ["isotropy", "isotropic"], "condition", "condition", "condition_recall"),
  topic("Anisotropy", ["anisotropy", "anisotropic", "geometric anisotropy", "zonal anisotropy"], "condition", "condition", "condition_recall"),
  topic("Kriging", ["kriging", "simple kriging", "ordinary kriging"], "method", "method_steps", "calculation_template"),
  topic("Point process", ["point process", "poisson process"], "model", "model_definition", "model_definition"),
  topic("SAR", ["sar", "simultaneous autoregressive"], "model", "model_definition", "model_definition"),
  topic("CAR", ["car", "conditional autoregressive"], "model", "model_definition", "model_definition"),
  topic("MRF", ["mrf", "markov random field"], "model", "model_definition", "model_definition"),
];

export function parseDocuments(input: CoursePackBuilderInput): ParsedDocument[] {
  return [
    ...withRole(input.notesDocuments, "lecture_notes"),
    ...withRole(input.guidanceDocuments, "exam_guidance"),
    ...withRole(input.pastPaperDocuments ?? [], "past_paper"),
    ...withRole(input.problemSheetDocuments ?? [], "problem_sheet"),
    ...withRole(input.solutionDocuments ?? [], "solution_sheet"),
    ...withRole(input.markSchemeDocuments ?? [], "mark_scheme"),
  ].map(withVisualDiagnostics);
}

export function detectCourseType(parsedDocuments: ParsedDocument[]): CourseType {
  const text = parsedDocuments.map((doc) => `${doc.sourceFile}\n${doc.fullText.slice(0, 20000)}`).join("\n").toLowerCase();
  const scores: Record<CourseType, number> = {
    time_series: scoreTerms(text, ["time series", "stationary process", "autocovariance", "autocorrelation", "ar(p)", "ma(q)", "arma", "arima", "arch", "spectral density", "periodogram", "ljung-box", "forecasting"]),
    spatial_statistics: scoreTerms(text, ["spatial statistics", "random field", "semivariogram", "variogram", "kriging", "isotropy", "anisotropy", "point process", "sar", "car", "mrf"]),
    financial_math: scoreTerms(text, ["black-scholes", "option", "portfolio", "martingale", "volatility", "arbitrage"]),
    statistics: scoreTerms(text, ["estimator", "hypothesis test", "confidence interval", "likelihood", "regression"]),
    probability: scoreTerms(text, ["random variable", "expectation", "martingale", "markov chain", "distribution"]),
    linear_algebra: scoreTerms(text, ["matrix", "eigenvalue", "vector space", "linear transformation"]),
    calculus: scoreTerms(text, ["derivative", "integral", "series", "differentiation"]),
    machine_learning: scoreTerms(text, ["machine learning", "neural network", "classifier", "loss function", "gradient descent"]),
    generic_math: scoreTerms(text, ["theorem", "definition", "lemma", "proof"]),
    unknown: 0,
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] as [CourseType, number] | undefined;
  return best && best[1] >= 2 ? best[0] : "unknown";
}

export function extractRawCandidates(parsedDocuments: ParsedDocument[], courseType = detectCourseType(parsedDocuments)): CandidateBlock[] {
  const sourceDocuments = parsedDocuments.filter((doc) => doc.role !== "exam_guidance" && doc.role !== "past_paper" && doc.role !== "problem_sheet" && doc.role !== "solution_sheet" && doc.role !== "mark_scheme");
  const base = attachProofsToPreviousTheorem(segmentRevisionCandidates(sourceDocuments.length ? sourceDocuments : parsedDocuments));
  const enriched = courseType === "time_series" ? enrichTimeSeriesCandidates(sourceDocuments.length ? sourceDocuments : parsedDocuments, base) : base;
  return dedupeCandidates(enriched);
}

export function buildCourseMap(parsedDocuments: ParsedDocument[], courseType = detectCourseType(parsedDocuments), candidates = extractRawCandidates(parsedDocuments, courseType)): CourseMap {
  const sourceDocs = parsedDocuments.filter((doc) => (doc.role ?? "lecture_notes") === "lecture_notes" || doc.role === "formula_sheet" || doc.role === "other");
  const parseWarnings = parsedDocuments.flatMap((doc) => doc.diagnostics.warnings.map((warning) => `${doc.sourceFile}: ${warning}`));
  const chapters = sourceDocs.flatMap((doc) => buildChapters(doc));
  const sourceLocationsByTopic = new Map<string, SourceLocation[]>();
  const topicSeeds = courseType === "time_series"
    ? timeSeriesTopics
    : courseType === "spatial_statistics"
      ? spatialTopicSeeds
      : candidates.slice(0, 60).map((candidate) => topic(candidate.conceptName || candidate.title || "Topic", [candidate.conceptName || candidate.title || ""], "definition", candidate.candidateKind ?? "implicit_definition", "definition_recall"));

  for (const seed of topicSeeds) {
    const locations = findTopicLocations(parsedDocuments, [seed.name, ...seed.aliases]);
    if (locations.length) sourceLocationsByTopic.set(seed.name, locations);
  }

  const topics: CourseTopic[] = topicSeeds
    .filter((seed) => sourceLocationsByTopic.has(seed.name) || candidates.some((candidate) => textIncludesAny(candidate.rawText, [seed.name, ...seed.aliases])))
    .map((seed) => ({
      name: seed.name,
      aliases: seed.aliases,
      section: sourceLocationsByTopic.get(seed.name)?.[0]?.section,
      sectionNumber: sourceLocationsByTopic.get(seed.name)?.[0]?.section,
      relatedItems: candidates.filter((candidate) => textIncludesAny(candidate.rawText, [seed.name, ...seed.aliases])).map((candidate) => candidate.id),
      importance: seed.type === "background" ? "background" : seed.type === "model" || seed.type === "condition" || seed.type === "test" ? "core" : "supporting",
      evidence: (sourceLocationsByTopic.get(seed.name) ?? []).map((location) => location.excerpt ?? location.sourceFile).slice(0, 5),
      sourceLocations: sourceLocationsByTopic.get(seed.name) ?? [],
      type: seed.type,
      likelyExamUse: purposeToLegacyExamUse(seed.purpose),
    }));

  return {
    courseTitle: inferCourseTitle(parsedDocuments, courseType),
    courseType,
    chapters,
    topics,
    modelFamilies: buildModelFamilies(courseType, topics),
    methods: buildMethods(courseType, topics),
    formulas: buildFormulas(courseType, topics),
    tests: buildTests(courseType, topics),
    workedExamples: buildWorkedExamples(courseType, topics),
    parseWarnings,
  };
}

export function buildAssessmentMap(parsedDocuments: ParsedDocument[], courseMap: CourseMap): AssessmentMap {
  const assessmentDocs = parsedDocuments.filter((doc) => ["exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "mark_scheme"].includes(doc.role ?? "other"));
  const topicFrequency = courseMap.topics.map((topicValue) => {
    const sourceBreakdown = emptyRoleCounts();
    const examples: SourceLocation[] = [];
    for (const doc of assessmentDocs) {
      const role = doc.role ?? "other";
      const matches = splitSentences(doc.fullText).filter((sentence) => textIncludesAny(sentence, [topicValue.name, ...(topicValue.aliases ?? [])])).slice(0, 4);
      sourceBreakdown[role] += matches.length;
      examples.push(...matches.map((sentence) => locationFromExcerpt(doc, sentence)));
    }
    return { topicName: topicValue.name, count: Object.values(sourceBreakdown).reduce((sum, count) => sum + count, 0), sourceBreakdown, examples };
  }).filter((entry) => entry.count > 0);

  const questionSignals = assessmentDocs.flatMap((doc) => splitSentences(doc.fullText).map((sentence) => ({ doc, sentence })));
  return {
    recurringQuestionTypes: buildRecurringQuestionTypesFromSentences(questionSignals, courseMap),
    topicFrequency,
    proofSignals: questionSignals
      .filter(({ sentence }) => /\b(prove|show that|derive)\b/i.test(sentence))
      .map(({ doc, sentence }) => ({ theoremOrResultName: inferSignalName(sentence, courseMap), evidence: [locationFromExcerpt(doc, sentence)], priorityBoost: roleBoost[doc.role ?? "other"] + 10 })),
    calculationSignals: questionSignals
      .filter(({ sentence }) => /\b(calculate|compute|determine|estimate|forecast|fit|show whether|test)\b/i.test(sentence))
      .map(({ doc, sentence }) => ({ methodName: inferSignalName(sentence, courseMap), evidence: [locationFromExcerpt(doc, sentence)], requiredSteps: inferRequiredSteps(sentence), priorityBoost: roleBoost[doc.role ?? "other"] + 5 })),
    formulaRecallSignals: questionSignals
      .filter(({ sentence }) => /\b(formula|statistic|equation|write down|state)\b/i.test(sentence))
      .map(({ doc, sentence }) => ({ formulaName: inferSignalName(sentence, courseMap), evidence: [locationFromExcerpt(doc, sentence)], priorityBoost: roleBoost[doc.role ?? "other"] })),
    conceptualSignals: questionSignals
      .filter(({ sentence }) => /\b(compare|distinguish|explain the difference|versus|vs\.?|interpret)\b/i.test(sentence))
      .map(({ doc, sentence }) => ({ distinctionName: inferSignalName(sentence, courseMap), evidence: [locationFromExcerpt(doc, sentence)], priorityBoost: roleBoost[doc.role ?? "other"] })),
  };
}

export async function buildExamPriorityMap(parsedDocuments: ParsedDocument[], courseMap: CourseMap, assessmentMap: AssessmentMap): Promise<ExamPriorityMap> {
  const legacy = await buildLegacyExamPriorityMap({
    notesDocuments: parsedDocuments.filter((doc) => doc.role === "lecture_notes" || doc.role === "formula_sheet" || doc.role === "other"),
    guidanceDocuments: parsedDocuments.filter((doc) => doc.role === "exam_guidance"),
    pastPaperDocuments: parsedDocuments.filter((doc) => doc.role === "past_paper"),
    problemSheetDocuments: parsedDocuments.filter((doc) => doc.role === "problem_sheet"),
    solutionDocuments: parsedDocuments.filter((doc) => doc.role === "solution_sheet" || doc.role === "mark_scheme"),
  });

  const topicPriorities: ExamTopicPriority[] = courseMap.topics.map((topicValue) => {
    const frequency = assessmentMap.topicFrequency.find((entry) => entry.topicName === topicValue.name);
    const score = scoreTopicPriority(topicValue, frequency);
    const priorityLabel = priorityLabelFromScore(score);
    return {
      topicName: topicValue.name,
      sectionNumbers: topicValue.sectionNumber ? [topicValue.sectionNumber] : undefined,
      priorityScore: score,
      priorityLabel,
      priority: priorityLabel,
      evidence: (frequency?.examples ?? topicValue.sourceLocations ?? []).map(sourceToEvidence),
      likelyAssessmentModes: purposesForTopic(topicValue),
      likelyAssessmentMode: purposeToLegacyExamUse(purposesForTopic(topicValue)[0] ?? "definition_recall"),
      reason: reasonForPriority(topicValue, frequency, score),
    };
  });

  const mergedTopics = mergePriorityTopics(topicPriorities, legacy.topics);
  return {
    ...legacy,
    topics: mergedTopics,
    formulas: courseMap.formulas.map((formula) => priorityFromCourseEntity(formula.name, formula.sourceLocations, formula.standaloneValue === "low" ? -15 : 10)),
    methods: courseMap.methods.map((method) => ({
      methodName: method.name,
      priorityScore: Math.min(100, 45 + evidenceBoost(method.sourceLocations)),
      priorityLabel: priorityLabelFromScore(Math.min(100, 45 + evidenceBoost(method.sourceLocations))),
      evidence: method.sourceLocations,
      likelyAssessmentModes: ["method_steps", "calculation_template"],
      reason: "Method/template detected in course map and boosted by assessment evidence.",
    })),
    proofs: assessmentMap.proofSignals.map((signal) => ({
      theoremOrResultName: signal.theoremOrResultName,
      priorityScore: Math.min(100, 45 + signal.priorityBoost),
      priorityLabel: priorityLabelFromScore(Math.min(100, 45 + signal.priorityBoost)),
      evidence: signal.evidence,
      reason: "Assessment wording asks for proof, derivation, or show-that work.",
    })),
    conceptualDistinctionsPriority: assessmentMap.conceptualSignals.map((signal) => ({
      distinctionName: signal.distinctionName,
      priorityScore: Math.min(100, 45 + signal.priorityBoost),
      priorityLabel: priorityLabelFromScore(Math.min(100, 45 + signal.priorityBoost)),
      evidence: signal.evidence,
      reason: "Assessment wording asks for explanation, comparison, or interpretation.",
    })),
    notes: [
      ...legacy.notes,
      courseMap.courseType === "time_series" ? "Time-series profile expands headings, model equations, conditions, diagnostics, and forecasting into raw candidates before curation." : `Detected course type: ${courseMap.courseType}.`,
    ],
  };
}

export function curateRevisionPack(curated: CuratedDeckResult, courseMap: CourseMap, assessmentMap: AssessmentMap, examPriorityMap: ExamPriorityMap): CuratedDeckResult {
  const revisionPack = buildLegacyRevisionPack({
    keptItems: curated.keptItems,
    needsReviewItems: curated.needsReviewItems,
    rejectedItems: curated.rejectedItems,
    examPriorityMap,
  });
  const active = curated.keptItems.filter((item) => (item.curationDecision ?? "keep") === "keep");
  return {
    ...curated,
    courseMap,
    assessmentMap,
    examPriorityMap,
    revisionPack: {
      ...revisionPack,
      courseType: courseMap.courseType,
      topPriorityTopics: examPriorityMap.topics.slice(0, 12),
      coreDefinitions: revisionPack.mustKnowDefinitions,
      modelsToKnow: active.filter((item) => item.cardPurpose === "model_definition" || item.candidateKind === "model_definition"),
      conditionsAndEquivalences: active.filter((item) => item.cardPurpose === "condition_recall" || item.candidateKind === "condition" || item.cardPurpose === "application_condition"),
      keyFormulas: revisionPack.formulasToKnow,
      testStatisticsAndDiagnostics: active.filter((item) => item.cardPurpose === "test_statistic" || item.candidateKind === "test_statistic"),
      proofCards: revisionPack.proofsToKnow,
      workedExamplePatterns: active.filter((item) => item.cardPurpose === "worked_example_pattern" || item.cardPurpose === "calculation_template" || item.candidateKind === "worked_example"),
      embedded: curated.embeddedItems,
    },
    curationReport: {
      ...curated.curationReport,
      courseType: courseMap.courseType,
      packCompletenessScore: packCompletenessScore(curated, courseMap),
      candidateCoverageScore: candidateCoverageScore(curated, courseMap),
      latexQualityScore: latexQualityScore([...curated.keptItems, ...curated.needsReviewItems]),
      assessmentEvidenceCoverage: assessmentEvidenceCoverage(assessmentMap, courseMap),
      pipelineStages: buildPipelineStages(parsedPageCountFromCourseMap(courseMap), curated.curationReport.totalCandidates, curated.keptItems.length, curated.needsReviewItems.length, courseMap, assessmentMap, [...curated.keptItems, ...curated.needsReviewItems]),
      weakParsingWarnings: [
        ...curated.curationReport.weakParsingWarnings,
        ...courseMap.parseWarnings,
        ...(parsedPageCountFromCourseMap(courseMap) > 50 && curated.curationReport.totalCandidates < 40 ? ["Under-extraction warning: parsed pages > 50 but raw candidates < 40."] : []),
      ],
    },
  };
}

export function generateFlashcardsFromRevisionPack(revisionPack: CuratedDeckResult["revisionPack"]): RevisionItem[] {
  return [
    ...(revisionPack.coreDefinitions ?? revisionPack.mustKnowDefinitions),
    ...(revisionPack.modelsToKnow ?? []),
    ...(revisionPack.conditionsAndEquivalences ?? []),
    ...(revisionPack.keyFormulas ?? revisionPack.formulasToKnow),
    ...revisionPack.methodsAndTemplates,
    ...(revisionPack.testStatisticsAndDiagnostics ?? []),
    ...revisionPack.conceptualDistinctions,
    ...(revisionPack.workedExamplePatterns ?? []),
    ...(revisionPack.proofCards ?? revisionPack.proofsToKnow),
  ];
}

export function validateLatexAndContentQuality(items: RevisionItem[], courseType: CourseType): RevisionItem[] {
  const profile = courseType === "time_series" || courseType === "spatial_statistics" || courseType === "financial_math" ? courseType : "generic";
  return items.map((item) => {
    const statementLatex = convertCommonMathToLatex(item.statementLatex || item.statement, profile, `${item.cardFront} ${item.statement}`);
    const answerLatex = convertCommonMathToLatex(item.answerLatex || item.answer, profile, `${item.cardFront} ${item.answer}`);
    const proofLatex = item.proof ? convertCommonMathToLatex(item.proofLatex || item.proof, profile, `${item.cardFront} ${item.proof}`) : undefined;
    const quality = validateLatexQuality({ ...item, statementLatex, answerLatex, proofLatex });
    return {
      ...item,
      statementLatex,
      answerLatex,
      proofLatex,
      latexQuality: quality.score,
      mathNormalizationProfile: profile,
      warnings: Array.from(new Set([...(item.warnings ?? []), ...quality.issues])),
    };
  });
}

export function saveResult(result: CuratedDeckResult): CuratedDeckResult {
  return result;
}

export async function runCoursePackBuilder(input: CoursePackBuilderInput): Promise<CuratedDeckResult> {
  const parsedDocuments = parseDocuments(input);
  const courseType = detectCourseType(parsedDocuments);
  const rawCandidates = extractRawCandidates(parsedDocuments, courseType);
  const courseMap = buildCourseMap(parsedDocuments, courseType, rawCandidates);
  const assessmentMap = buildAssessmentMap(parsedDocuments, courseMap);
  const examPriorityMap = await buildExamPriorityMap(parsedDocuments, courseMap, assessmentMap);
  const curated = await curateRevisionDeck({
    candidates: rawCandidates,
    guidanceDocuments: parsedDocuments.filter((doc) => doc.role === "exam_guidance"),
    parsedNotes: parsedDocuments.filter((doc) => doc.role === "lecture_notes" || doc.role === "formula_sheet" || doc.role === "other"),
    pastPaperDocuments: parsedDocuments.filter((doc) => doc.role === "past_paper"),
    problemSheetDocuments: parsedDocuments.filter((doc) => doc.role === "problem_sheet"),
    solutionDocuments: parsedDocuments.filter((doc) => doc.role === "solution_sheet" || doc.role === "mark_scheme"),
    examPriorityMap,
  });
  const qualityItems = validateLatexAndContentQuality(curated.keptItems, courseType);
  const qualityNeedsReview = validateLatexAndContentQuality(curated.needsReviewItems, courseType);
  return saveResult(curateRevisionPack({ ...curated, keptItems: qualityItems, needsReviewItems: qualityNeedsReview }, courseMap, assessmentMap, examPriorityMap));
}

function topic(name: string, aliases: string[], typeValue: CourseTopicType, kind: RevisionCandidateKind, purpose: CardPurpose) {
  return { name, aliases: aliases.map((alias) => alias.toLowerCase()), type: typeValue, kind, purpose };
}

function withRole(documents: ParsedDocument[], role: StudyFileRole) {
  return documents.map((document) => ({ ...document, role: document.role ?? role }));
}

function withVisualDiagnostics(document: ParsedDocument): ParsedDocument {
  const pages = document.pages?.map((page) => {
    const visualHeavy = Boolean(page.visualHeavy || page.imageObjectCount && page.imageObjectCount >= 3 || page.charCount < 120 && document.fileType === "pdf");
    const warnings = visualHeavy ? Array.from(new Set([...(page.warnings ?? []), "This page contains diagrams/handwritten annotations; text extraction may miss content."])) : page.warnings;
    return { ...page, visualHeavy, textQuality: page.textQuality ?? (page.charCount < 120 ? "low" : page.charCount < 300 ? "medium" : "high"), warnings };
  });
  const pageWarnings = pages?.flatMap((page) => page.warnings?.map((warning) => `Page ${page.pageNumber}: ${warning}`) ?? []) ?? [];
  return {
    ...document,
    pages,
    diagnostics: { ...document.diagnostics, warnings: Array.from(new Set([...document.diagnostics.warnings, ...pageWarnings])) },
  };
}

function scoreTerms(text: string, terms: string[]) {
  return terms.reduce((score, termValue) => score + (text.includes(termValue) ? 1 : 0), 0);
}

function enrichTimeSeriesCandidates(documents: ParsedDocument[], base: CandidateBlock[]): CandidateBlock[] {
  const output = [...base];
  const existing = new Set(base.map((candidate) => `${candidate.sourceFile}|${candidate.pageNumber ?? ""}|${candidate.conceptName ?? candidate.title ?? ""}`.toLowerCase()));
  for (const document of documents) {
    const chunks = document.pages?.length ? document.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })) : [{ pageNumber: undefined, text: document.fullText }];
    for (const chunk of chunks) {
      for (const seed of timeSeriesTopics) {
        if (!textIncludesAny(chunk.text, [seed.name, ...seed.aliases])) continue;
        const key = `${document.sourceFile}|${chunk.pageNumber ?? ""}|${seed.name}`.toLowerCase();
        if (existing.has(key)) continue;
        existing.add(key);
        output.push(candidateFromTopic(document, chunk.text, chunk.pageNumber, seed.name, seed.type, seed.kind));
      }
    }
  }
  const pageCount = documents.reduce((sum, doc) => sum + (doc.pages?.length ?? doc.diagnostics.pageCount ?? 0), 0);
  if (pageCount > 50 && output.length < 80) {
    for (const document of documents) {
      for (const page of document.pages ?? []) {
        if (output.length >= 80) break;
        if (page.text.trim().length < 80) continue;
        output.push(candidateFromTopic(document, page.text, page.pageNumber, `Page ${page.pageNumber} course material`, "background", "background_context"));
      }
    }
  }
  return output;
}

function candidateFromTopic(document: ParsedDocument, text: string, pageNumber: number | undefined, name: string, typeValue: CourseTopicType, kind: RevisionCandidateKind): CandidateBlock {
  const statement = excerptAround(text, name);
  const revisionType = typeValue === "formula" ? "formula" : typeValue === "method" || typeValue === "test" ? "algorithm" : typeValue === "worked_example" ? "example" : typeValue === "condition" ? "property" : typeValue === "background" ? "other" : "definition";
  return {
    id: createId("candidate"),
    label: revisionType === "formula" ? "Formula" : revisionType === "algorithm" ? "Algorithm" : revisionType === "example" ? "Example" : revisionType === "property" ? "Property" : revisionType === "definition" ? "Definition" : "Other",
    type: revisionType,
    candidateKind: kind,
    conceptName: name,
    title: name,
    rawText: statement,
    statement,
    sourceFile: document.sourceFile,
    pageNumber,
    sourceLocation: pageNumber ? `${name}, page ${pageNumber}` : name,
    section: sectionForPage(document, pageNumber),
    startOffset: Math.max(0, document.fullText.indexOf(statement.slice(0, 40))),
    endOffset: Math.max(0, document.fullText.indexOf(statement.slice(0, 40))) + statement.length,
  };
}

function dedupeCandidates(candidates: CandidateBlock[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.sourceFile}|${candidate.pageNumber ?? ""}|${candidate.conceptName ?? candidate.title ?? ""}|${candidate.statement?.slice(0, 100) ?? candidate.rawText.slice(0, 100)}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildChapters(document: ParsedDocument): CourseMap["chapters"] {
  const sections = document.sections?.length
    ? document.sections.map((section) => ({
      number: section.sectionNumber,
      sectionNumber: section.sectionNumber,
      title: section.sectionTitle,
      sourceFile: document.sourceFile,
      pageStart: pageAtOffset(document, section.startOffset),
      pageEnd: pageAtOffset(document, section.endOffset),
      summary: section.text.slice(0, 260).replace(/\s+/g, " ").trim(),
      detectedImportance: "unknown" as const,
      likelyImportance: "unknown" as const,
    }))
    : inferSectionsFromText(document);
  if (!sections.length) {
    return [{ title: document.sourceFile, pageStart: document.pages?.[0]?.pageNumber, pageEnd: document.pages?.at(-1)?.pageNumber, sections: [] }];
  }
  const byChapter = new Map<string, CourseMap["chapters"][number]>();
  for (const section of sections) {
    const chapterNumber = section.sectionNumber?.split(".")[0];
    const key = chapterNumber ?? section.title;
    const existing = byChapter.get(key);
    const title = chapterNumber ? `Chapter ${chapterNumber}` : section.title;
    if (!existing) {
      byChapter.set(key, { number: chapterNumber, title, pageStart: section.pageStart, pageEnd: section.pageEnd, sections: [section] });
    } else {
      existing.pageStart = Math.min(existing.pageStart ?? section.pageStart ?? 0, section.pageStart ?? existing.pageStart ?? 0) || undefined;
      existing.pageEnd = Math.max(existing.pageEnd ?? section.pageEnd ?? 0, section.pageEnd ?? existing.pageEnd ?? 0) || undefined;
      existing.sections.push(section);
    }
  }
  return Array.from(byChapter.values());
}

function inferSectionsFromText(document: ParsedDocument): CourseMap["chapters"][number]["sections"] {
  const sections: CourseMap["chapters"][number]["sections"] = [];
  const regex = /(?:^|\n)(\d+(?:\.\d+){0,3})\s+([A-Z][^\n]{3,120})(?=\n)/g;
  for (const match of document.fullText.matchAll(regex)) {
    const start = match.index ?? 0;
    sections.push({
      number: match[1],
      sectionNumber: match[1],
      title: match[2].trim(),
      sourceFile: document.sourceFile,
      pageStart: pageAtOffset(document, start),
      summary: excerptAround(document.fullText.slice(start, start + 900), match[2]),
      detectedImportance: "unknown",
      likelyImportance: "unknown",
    });
  }
  return sections.slice(0, 80);
}

function inferCourseTitle(documents: ParsedDocument[], courseType: CourseType) {
  const firstLines = documents.flatMap((doc) => doc.fullText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 8));
  const title = firstLines.find((line) => line.length >= 8 && line.length <= 90 && /(time series|spatial|statistics|probability|calculus|algebra|machine learning)/i.test(line));
  if (title) return title;
  return courseType === "time_series" ? "Time Series Analysis" : courseType.replace(/_/g, " ");
}

function buildModelFamilies(courseType: CourseType, topics: CourseTopic[]): CourseModelFamily[] {
  return topics.filter((topicValue) => topicValue.type === "model").map((topicValue) => ({
    name: topicValue.name,
    notation: notationForTopic(topicValue.name),
    definition: topicValue.evidence[0],
    assumptions: topicValue.name.includes("AR") ? ["Stationarity depends on root conditions."] : undefined,
    keyProperties: topicValue.name.includes("MA") ? ["Finite autocovariance support."] : undefined,
    relatedFormulas: [],
    sourceLocations: topicValue.sourceLocations ?? [],
  }));
}

function buildMethods(courseType: CourseType, topics: CourseTopic[]): CourseMethod[] {
  return topics.filter((topicValue) => topicValue.type === "method").map((topicValue) => ({
    name: topicValue.name,
    purpose: topicValue.name.includes("Forecast") ? "Generate future predictions from a fitted time-series model." : "Repeatable course calculation or modelling procedure.",
    steps: defaultMethodSteps(topicValue.name),
    sourceLocations: topicValue.sourceLocations ?? [],
  }));
}

function buildFormulas(courseType: CourseType, topics: CourseTopic[]): CourseFormula[] {
  return topics.filter((topicValue) => topicValue.type === "formula" || topicValue.type === "condition").map((topicValue) => ({
    name: topicValue.name,
    formulaLatex: convertCommonMathToLatex(topicValue.evidence[0] ?? topicValue.name, courseType === "time_series" ? "time_series" : "auto", topicValue.name),
    role: topicValue.type === "condition" ? "condition" : topicValue.name.toLowerCase().includes("statistic") ? "test_statistic" : "definition",
    standaloneValue: topicValue.importance === "core" ? "high" : "medium",
    sourceLocations: topicValue.sourceLocations ?? [],
  }));
}

function buildTests(courseType: CourseType, topics: CourseTopic[]): CourseTest[] {
  return topics.filter((topicValue) => topicValue.type === "test").map((topicValue) => ({
    name: topicValue.name,
    hypotheses: topicValue.name.toLowerCase().includes("ljung") ? ["Residuals are uncorrelated up to the tested lags.", "Residual autocorrelation remains."] : undefined,
    statisticLatex: topicValue.name.toLowerCase().includes("ljung") ? "\\(Q=n(n+2)\\sum_{k=1}^h \\hat\\rho_k^2/(n-k)\\)" : undefined,
    decisionRule: "Compare the statistic with the stated reference distribution or p-value threshold.",
    assumptions: ["Use after fitting the relevant model."],
    sourceLocations: topicValue.sourceLocations ?? [],
  }));
}

function buildWorkedExamples(courseType: CourseType, topics: CourseTopic[]): WorkedExamplePattern[] {
  return topics.filter((topicValue) => topicValue.type === "worked_example").map((topicValue) => ({
    name: topicValue.name,
    problemType: "Repeatable worked example pattern",
    requiredSteps: defaultMethodSteps(topicValue.name),
    relatedTopics: topicValue.aliases ?? [],
    sourceLocations: topicValue.sourceLocations ?? [],
  }));
}

function findTopicLocations(documents: ParsedDocument[], aliases: string[]): SourceLocation[] {
  const locations: SourceLocation[] = [];
  for (const doc of documents) {
    const chunks = doc.pages?.length ? doc.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })) : [{ pageNumber: undefined, text: doc.fullText }];
    for (const chunk of chunks) {
      if (!textIncludesAny(chunk.text, aliases)) continue;
      locations.push(locationFromExcerpt(doc, excerptAround(chunk.text, aliases[0]), chunk.pageNumber));
    }
  }
  return locations.slice(0, 8);
}

function buildRecurringQuestionTypesFromSentences(signals: Array<{ doc: ParsedDocument; sentence: string }>, courseMap: CourseMap) {
  const patterns: Array<{ name: string; regex: RegExp; purposes: CardPurpose[]; boost: number }> = [
    { name: "State or define", regex: /\b(state|define|give the definition)\b/i, purposes: ["definition_recall"], boost: 10 },
    { name: "Model setup", regex: /\b(write down|specify|model|fit)\b/i, purposes: ["model_definition", "method_steps"], boost: 12 },
    { name: "Condition check", regex: /\b(condition|determine whether|stationary|invertible|valid)\b/i, purposes: ["condition_recall"], boost: 12 },
    { name: "Calculate or forecast", regex: /\b(calculate|compute|estimate|forecast)\b/i, purposes: ["calculation_template", "method_steps"], boost: 14 },
    { name: "Test or diagnose", regex: /\b(test|diagnostic|hypotheses|statistic)\b/i, purposes: ["test_statistic"], boost: 14 },
    { name: "Explain or compare", regex: /\b(explain|interpret|compare|distinguish)\b/i, purposes: ["conceptual_distinction"], boost: 8 },
  ];
  return patterns.flatMap((patternValue) => {
    const matches = signals.filter(({ sentence }) => patternValue.regex.test(sentence)).slice(0, 8);
    if (!matches.length) return [];
    return [{
      name: patternValue.name,
      description: `${patternValue.name} appears in assessment or guidance wording.`,
      relatedTopics: relatedTopicsForSentences(matches.map((match) => match.sentence), courseMap),
      sourceLocations: matches.map(({ doc, sentence }) => locationFromExcerpt(doc, sentence)),
      evidence: matches.map(({ doc, sentence }) => sourceToEvidence(locationFromExcerpt(doc, sentence))),
      cardPurposesSuggested: patternValue.purposes,
      suggestedCardPurposes: patternValue.purposes,
      priorityBoost: patternValue.boost + Math.max(...matches.map(({ doc }) => roleBoost[doc.role ?? "other"]), 0),
    }];
  });
}

function scoreTopicPriority(topicValue: CourseTopic, frequency: AssessmentMap["topicFrequency"][number] | undefined) {
  let score = 0;
  const breakdown = frequency?.sourceBreakdown;
  if ((breakdown?.past_paper ?? 0) > 0) score += 30;
  if ((breakdown?.problem_sheet ?? 0) > 0) score += 20;
  if ((breakdown?.exam_guidance ?? 0) > 0) score += 20;
  if ((breakdown?.solution_sheet ?? 0) > 0 || (breakdown?.mark_scheme ?? 0) > 0) score += 15;
  if (topicValue.importance === "core" || topicValue.type === "model" || topicValue.type === "condition" || topicValue.type === "test") score += 15;
  if (topicValue.type === "background") score -= 20;
  if (!frequency && topicValue.importance === "supporting") score += 25;
  if (topicValue.type === "formula") score -= 5;
  return Math.max(0, Math.min(100, score));
}

function priorityFromCourseEntity(name: string, evidence: SourceLocation[], adjustment: number) {
  const score = Math.max(0, Math.min(100, 45 + evidenceBoost(evidence) + adjustment));
  return {
    formulaName: name,
    priorityScore: score,
    priorityLabel: priorityLabelFromScore(score),
    evidence,
    reason: "Formula detected in course map and scored using assessment/source evidence.",
  };
}

function mergePriorityTopics(primary: ExamTopicPriority[], legacy: ExamTopicPriority[]) {
  const byName = new Map<string, ExamTopicPriority>();
  for (const topicValue of [...primary, ...legacy]) {
    const key = topicValue.topicName.toLowerCase();
    const current = byName.get(key);
    if (!current || (topicValue.priorityScore ?? labelScore(topicValue.priority)) > (current.priorityScore ?? labelScore(current.priority))) {
      byName.set(key, {
        ...topicValue,
        priorityScore: topicValue.priorityScore ?? labelScore(topicValue.priority),
        priorityLabel: topicValue.priorityLabel ?? topicValue.priority,
      });
    }
  }
  return Array.from(byName.values()).sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0));
}

function buildPipelineStages(pageCount: number, rawCandidates: number, kept: number, needsReview: number, courseMap: CourseMap, assessmentMap: AssessmentMap, items: RevisionItem[]) {
  const lowLatex = items.filter((item) => item.latexQuality === "low" || item.warnings?.some((warning) => warning.includes("LaTeX") || warning.includes("symbol artefacts"))).length;
  return [
    { name: "Parsed documents", status: courseMap.parseWarnings.length ? "warning" as const : "complete" as const, detail: `${pageCount || "Unknown"} parsed page(s).` },
    { name: "Course type detection", status: courseMap.courseType === "unknown" ? "warning" as const : "complete" as const, detail: `Detected ${courseMap.courseType}.` },
    { name: "Course map", status: courseMap.topics.length ? "complete" as const : "warning" as const, detail: `${courseMap.topics.length} topic(s), ${courseMap.modelFamilies.length} model family item(s).` },
    { name: "Raw candidates", status: pageCount > 50 && rawCandidates < 40 ? "warning" as const : "complete" as const, detail: `${rawCandidates} raw candidate(s).` },
    { name: "Assessment map", status: assessmentMap.topicFrequency.length ? "complete" as const : "warning" as const, detail: assessmentMap.topicFrequency.length ? `${assessmentMap.topicFrequency.length} assessed topic signal(s).` : "No past papers/problem sheets/guidance signals found." },
    { name: "Priority map", status: "complete" as const, detail: "Assessment evidence and course centrality scored." },
    { name: "Revision pack", status: kept + needsReview >= 20 || pageCount <= 50 ? "complete" as const : "warning" as const, detail: `${kept} kept and ${needsReview} needing review.` },
    { name: "Flashcards", status: kept < 20 && pageCount > 50 ? "warning" as const : "complete" as const, detail: `${kept} high-priority active card(s).` },
    { name: "Quality warnings", status: lowLatex ? "warning" as const : "complete" as const, detail: lowLatex ? `${lowLatex} low LaTeX quality card(s).` : "No low LaTeX quality cards detected." },
  ];
}

function packCompletenessScore(curated: CuratedDeckResult, courseMap: CourseMap) {
  const categories = [
    curated.revisionPack?.mustKnowDefinitions?.length || curated.keptItems.some((item) => item.type === "definition"),
    curated.revisionPack?.modelsToKnow?.length || curated.keptItems.some((item) => item.cardPurpose === "model_definition"),
    curated.revisionPack?.conditionsAndEquivalences?.length || curated.keptItems.some((item) => item.cardPurpose === "condition_recall" || item.cardPurpose === "application_condition"),
    curated.revisionPack?.formulasToKnow?.length || curated.keptItems.some((item) => item.type === "formula"),
    curated.revisionPack?.methodsAndTemplates?.length || curated.keptItems.some((item) => item.cardPurpose === "method_steps" || item.cardPurpose === "calculation_template"),
    curated.revisionPack?.testStatisticsAndDiagnostics?.length || curated.keptItems.some((item) => item.cardPurpose === "test_statistic"),
    curated.revisionPack?.workedExamplePatterns?.length || curated.keptItems.some((item) => item.cardPurpose === "worked_example_pattern"),
  ].filter(Boolean).length;
  const expected = courseMap.courseType === "time_series" ? 7 : 5;
  return Math.round(Math.min(100, (categories / expected) * 100));
}

function candidateCoverageScore(curated: CuratedDeckResult, courseMap: CourseMap) {
  if (!courseMap.topics.length) return 0;
  const covered = courseMap.topics.filter((topicValue) => curated.keptItems.some((item) => textIncludesAny(`${item.cardFront} ${item.title} ${item.statement}`, [topicValue.name, ...(topicValue.aliases ?? [])]))).length;
  return Math.round((covered / courseMap.topics.length) * 100);
}

function latexQualityScore(items: RevisionItem[]) {
  if (!items.length) return 0;
  const score = items.reduce((sum, item) => sum + (item.latexQuality === "low" ? 25 : item.latexQuality === "medium" ? 70 : 100), 0);
  return Math.round(score / items.length);
}

function assessmentEvidenceCoverage(assessmentMap: AssessmentMap, courseMap: CourseMap) {
  if (!courseMap.topics.length) return 0;
  return Math.round((assessmentMap.topicFrequency.length / courseMap.topics.length) * 100);
}

function parsedPageCountFromCourseMap(courseMap: CourseMap) {
  const pageNumbers = courseMap.chapters.flatMap((chapter) => [chapter.pageStart, chapter.pageEnd, ...chapter.sections.flatMap((section) => [section.pageStart, section.pageEnd])]).filter((value): value is number => typeof value === "number");
  if (!pageNumbers.length) return 0;
  return Math.max(...pageNumbers);
}

function sourceToEvidence(location: SourceLocation) {
  return {
    sourceFile: location.sourceFile,
    sourceRole: location.fileRole,
    pageNumber: location.pageNumber,
    excerpt: location.excerpt ?? "",
    explanation: `${location.fileRole.replace(/_/g, " ")} evidence.`,
  };
}

function locationFromExcerpt(document: ParsedDocument, excerpt: string, pageNumber?: number): SourceLocation {
  return {
    sourceFile: document.sourceFile,
    fileRole: document.role ?? "other",
    pageNumber: pageNumber ?? document.pages?.find((page) => page.text.includes(excerpt.slice(0, 80)))?.pageNumber,
    section: sectionForPage(document, pageNumber),
    excerpt: excerpt.replace(/\s+/g, " ").trim().slice(0, 420),
  };
}

function sectionForPage(document: ParsedDocument, pageNumber: number | undefined) {
  if (!pageNumber) return undefined;
  const page = document.pages?.find((candidate) => candidate.pageNumber === pageNumber);
  if (!page) return undefined;
  const heading = page.text.split("\n").map((line) => line.trim()).find((line) => /^\d+(?:\.\d+)*\s+\S/.test(line));
  return heading;
}

function pageAtOffset(document: ParsedDocument, offset: number) {
  let pageNumber: number | undefined;
  for (const match of document.fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

function textIncludesAny(text: string, aliases: string[]) {
  const lower = text.toLowerCase();
  return aliases.some((alias) => alias && lower.includes(alias.toLowerCase()));
}

function excerptAround(text: string, term: string) {
  const lower = text.toLowerCase();
  const index = Math.max(0, lower.indexOf(term.toLowerCase()));
  const start = Math.max(0, index - 160);
  return text.slice(start, Math.min(text.length, start + 700)).replace(/\s+/g, " ").trim();
}

function splitSentences(text: string) {
  return text.replace(/\r\n/g, "\n").split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.replace(/\s+/g, " ").trim()).filter((sentence) => sentence.length >= 12 && sentence.length <= 700);
}

function emptyRoleCounts(): Record<StudyFileRole, number> {
  return Object.fromEntries(studyFileRoles.map((role) => [role, 0])) as Record<StudyFileRole, number>;
}

function inferSignalName(sentence: string, courseMap: CourseMap) {
  return courseMap.topics.find((topicValue) => textIncludesAny(sentence, [topicValue.name, ...(topicValue.aliases ?? [])]))?.name ?? sentence.slice(0, 80);
}

function inferRequiredSteps(sentence: string) {
  const lower = sentence.toLowerCase();
  if (lower.includes("forecast")) return ["Identify fitted model", "Condition on observed data", "Compute forecast", "Report forecast uncertainty"];
  if (lower.includes("stationary") || lower.includes("invertible")) return ["Write the characteristic polynomial", "Find/check roots", "Compare with the unit circle", "State the conclusion"];
  if (lower.includes("ljung") || lower.includes("test")) return ["State hypotheses", "Compute the test statistic", "Compare with reference distribution or p-value", "Conclude in context"];
  return ["Identify the relevant model or formula", "Substitute given quantities", "Carry out the calculation", "Interpret the result"];
}

function relatedTopicsForSentences(sentences: string[], courseMap: CourseMap) {
  const related = courseMap.topics.filter((topicValue) => sentences.some((sentence) => textIncludesAny(sentence, [topicValue.name, ...(topicValue.aliases ?? [])]))).map((topicValue) => topicValue.name);
  return Array.from(new Set(related)).slice(0, 8);
}

function purposesForTopic(topicValue: CourseTopic): CardPurpose[] {
  if (topicValue.type === "model") return ["model_definition"];
  if (topicValue.type === "condition") return ["condition_recall"];
  if (topicValue.type === "formula") return ["formula_recall"];
  if (topicValue.type === "method") return ["method_steps", "calculation_template"];
  if (topicValue.type === "test") return ["test_statistic"];
  if (topicValue.type === "conceptual_distinction") return ["conceptual_distinction"];
  if (topicValue.type === "worked_example") return ["worked_example_pattern", "calculation_template"];
  return ["definition_recall"];
}

function purposeToLegacyExamUse(purpose: CardPurpose | undefined): ExamTopicPriority["likelyAssessmentMode"] {
  if (purpose === "proof_recall") return "proof";
  if (purpose === "formula_recall" || purpose === "calculation_template" || purpose === "method_steps" || purpose === "test_statistic") return "calculation";
  if (purpose === "conceptual_distinction") return "conceptual_explanation";
  if (purpose === "model_definition") return "model_interpretation";
  return "definition_recall";
}

function reasonForPriority(topicValue: CourseTopic, frequency: AssessmentMap["topicFrequency"][number] | undefined, score: number) {
  if (!frequency) return score >= 45 ? "Core lecture-note topic without assessment evidence." : "Lecture-note only priority.";
  const roles = Object.entries(frequency.sourceBreakdown).filter(([, count]) => count > 0).map(([role]) => role.replace(/_/g, " "));
  return `Evidence from ${roles.join(", ")}; scored with course centrality and assessment frequency.`;
}

function evidenceBoost(evidence: SourceLocation[]) {
  return Math.min(45, evidence.reduce((sum, location) => sum + roleBoost[location.fileRole], 0));
}

function labelScore(label: PriorityLabel) {
  return { very_high: 85, high: 70, medium: 50, low: 25, unknown: 0 }[label];
}

function notationForTopic(name: string) {
  if (name.includes("ARMA")) return "\\(\\operatorname{ARMA}(p,q)\\)";
  if (name.includes("ARIMA")) return "\\(\\operatorname{ARIMA}(p,d,q)\\)";
  if (name.includes("AR")) return "\\(\\operatorname{AR}(p)\\)";
  if (name.includes("MA")) return "\\(\\operatorname{MA}(q)\\)";
  if (name.includes("ARCH")) return "\\(\\operatorname{ARCH}(p)\\)";
  return undefined;
}

function defaultMethodSteps(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("forecast")) return ["Specify the model", "Use information up to the forecast origin", "Compute conditional expectation", "State forecast error or uncertainty"];
  if (lower.includes("differencing") || lower.includes("trend")) return ["Inspect trend or seasonality", "Choose transformation/difference", "Check stationarity after transformation", "Fit a suitable model"];
  if (lower.includes("ljung")) return ["State hypotheses", "Compute autocorrelation residual statistic", "Compare with reference distribution", "Decide whether residual autocorrelation remains"];
  return ["Identify the target", "Choose the model/formula", "Carry out the calculation", "Interpret the answer"];
}

