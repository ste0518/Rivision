import type {
  CalculationTemplateSignal,
  CardPurpose,
  ConceptualDistinctionSignal,
  CuratedRevisionResult,
  EvidenceSignal,
  ExamPriorityMap,
  ExamTopicPriority,
  ParsedDocument,
  PriorityLabel,
  RecurringQuestionType,
  RequiredItemSignal,
  RevisionItem,
  RevisionItemType,
  RevisionPack,
  StudyFileRole,
} from "@/lib/types";

type PriorityInput = {
  notesDocuments: ParsedDocument[];
  guidanceDocuments: ParsedDocument[];
  pastPaperDocuments: ParsedDocument[];
  problemSheetDocuments: ParsedDocument[];
  solutionDocuments: ParsedDocument[];
};

type TopicSeed = {
  name: string;
  aliases: string[];
  assessmentMode: ExamTopicPriority["likelyAssessmentMode"];
  cardPurposes: CardPurpose[];
};

type TopicAccumulator = TopicSeed & {
  weightedHits: number;
  evidence: EvidenceSignal[];
  sectionNumbers: Set<string>;
};

const roleWeight: Record<StudyFileRole, number> = {
  lecture_notes: 1,
  exam_guidance: 4,
  past_paper: 5,
  problem_sheet: 3,
  solution_sheet: 3,
  formula_sheet: 2,
  mark_scheme: 4,
  other: 1,
};

const topicSeeds: TopicSeed[] = [
  seed("Random field", ["random field", "stochastic process indexed"], "definition_recall", ["definition_recall"]),
  seed("Gaussian random field", ["gaussian random field", "grf"], "mixed", ["definition_recall", "calculation_template"]),
  seed("Random vector", ["random vector", "multivariate normal"], "definition_recall", ["definition_recall"]),
  seed("Stationarity", ["stationarity", "stationary", "strict stationarity", "weak stationarity", "intrinsic stationarity"], "conceptual_explanation", ["definition_recall", "conceptual_distinction"]),
  seed("Isotropy", ["isotropy", "isotropic", "anisotropy", "geometric anisotropy", "zonal anisotropy"], "conceptual_explanation", ["definition_recall", "conceptual_distinction"]),
  seed("Covariance validity", ["valid covariance", "covariance function", "positive semi-definite", "positive definite"], "theorem_statement", ["theorem_statement", "application_condition"]),
  seed("Semi-variogram", ["semi-variogram", "semivariogram", "variogram"], "mixed", ["definition_recall", "formula_recall"]),
  seed("Kriging", ["kriging", "simple kriging", "ordinary kriging", "blup"], "calculation", ["calculation_template", "formula_recall"]),
  seed("Point process", ["point process", "poisson process", "intensity function"], "model_interpretation", ["definition_recall", "calculation_template"]),
  seed("CAR/SAR models", ["car model", "sar model", "conditional autoregressive", "simultaneous autoregressive", "car", "sar"], "model_interpretation", ["definition_recall", "calculation_template"]),
  seed("Spectral density", ["spectral density", "bochner", "spectral measure"], "theorem_statement", ["definition_recall", "theorem_statement"]),
  seed("Matheron estimator", ["matheron", "smoothed matheron"], "calculation", ["calculation_template", "formula_recall"]),
  seed("Likelihood", ["likelihood", "log-likelihood", "maximum likelihood"], "calculation", ["calculation_template"]),
  seed("Hypothesis testing", ["hypothesis test", "test statistic", "confidence interval"], "calculation", ["calculation_template"]),
  seed("Matrix methods", ["matrix", "covariance matrix", "eigenvalue", "linear system"], "calculation", ["calculation_template"]),
];

export async function buildExamPriorityMap(input: PriorityInput): Promise<ExamPriorityMap> {
  const documents = [
    ...asRole(input.notesDocuments, "lecture_notes"),
    ...asRole(input.guidanceDocuments, "exam_guidance"),
    ...asRole(input.pastPaperDocuments, "past_paper"),
    ...asRole(input.problemSheetDocuments, "problem_sheet"),
    ...asRole(input.solutionDocuments, "solution_sheet"),
  ];

  const accumulators = new Map<string, TopicAccumulator>();
  for (const seedValue of [...topicSeeds, ...deriveTopicSeeds(input.notesDocuments)]) {
    accumulators.set(seedValue.name.toLowerCase(), { ...seedValue, weightedHits: 0, evidence: [], sectionNumbers: new Set() });
  }

  for (const document of documents) {
    const role = document.role ?? "other";
    const sentences = splitEvidenceSentences(document.fullText);
    for (const accumulator of accumulators.values()) {
      const matches = sentences.filter((sentence) => accumulator.aliases.some((alias) => containsPhrase(sentence, alias))).slice(0, 5);
      if (matches.length === 0) continue;
      accumulator.weightedHits += matches.length * roleWeight[role];
      accumulator.evidence.push(...matches.map((sentence) => evidenceFromSentence(document, role, sentence, explainRole(role, accumulator.name))));
      for (const section of document.sections ?? []) {
        if (accumulator.aliases.some((alias) => containsPhrase(section.text, alias)) && section.sectionNumber) {
          accumulator.sectionNumbers.add(section.sectionNumber);
        }
      }
    }
  }

  const topics = Array.from(accumulators.values())
    .filter((topic) => topic.weightedHits > 0)
    .map((topic) => ({
      topicName: topic.name,
      sectionNumbers: topic.sectionNumbers.size ? Array.from(topic.sectionNumbers) : undefined,
      priority: priorityFromWeightedHits(topic.weightedHits, topic.evidence),
      evidence: topic.evidence.slice(0, 6),
      likelyAssessmentMode: topic.assessmentMode,
    }))
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || b.evidence.length - a.evidence.length);

  const recurringQuestionTypes = buildRecurringQuestionTypes(documents, topics);
  const requiredDefinitions = buildRequiredItemSignals(documents, "definition", topics);
  const requiredTheorems = buildRequiredItemSignals(documents, "theorem", topics);
  const requiredProofs = buildRequiredItemSignals(documents, "proof", topics);
  const requiredFormulas = buildRequiredItemSignals(documents, "formula", topics);
  const calculationTemplates = buildCalculationTemplates(documents, topics);
  const conceptualDistinctions = buildConceptualDistinctions(documents, topics);

  return {
    topics,
    recurringQuestionTypes,
    requiredDefinitions,
    requiredTheorems,
    requiredProofs,
    requiredFormulas,
    calculationTemplates,
    conceptualDistinctions,
    notes: [
      "Priorities weight exam guidance, past papers, problem sheets, and solution sheets more heavily than lecture-note frequency.",
      "Lecture notes still supply core definitions and source wording, but assessment documents decide which cards enter normal review.",
    ],
  };
}

export function emptyExamPriorityMap(): ExamPriorityMap {
  return {
    topics: [],
    formulas: [],
    methods: [],
    proofs: [],
    conceptualDistinctionsPriority: [],
    recurringQuestionTypes: [],
    requiredDefinitions: [],
    requiredTheorems: [],
    requiredProofs: [],
    requiredFormulas: [],
    calculationTemplates: [],
    conceptualDistinctions: [],
    notes: [],
  };
}

export function buildRevisionPack(result: Pick<CuratedRevisionResult, "keptItems" | "needsReviewItems" | "rejectedItems" | "examPriorityMap">): RevisionPack {
  const active = result.keptItems.filter((item) => (item.curationDecision ?? "keep") === "keep");
  const definitions = active.filter((item) => item.type === "definition");
  const models = active.filter((item) => item.cardPurpose === "model_definition" || item.candidateKind === "model_definition");
  const conditions = active.filter((item) => item.cardPurpose === "condition_recall" || item.candidateKind === "condition" || item.cardPurpose === "application_condition");
  const theorems = active.filter((item) => ["theorem", "lemma", "proposition", "corollary"].includes(item.type));
  const proofs = active.filter((item) => item.type === "proof" || item.cardPurpose === "proof_recall");
  const formulas = active.filter((item) => item.type === "formula" || item.cardPurpose === "formula_recall");
  const methods = active.filter((item) => item.cardPurpose === "calculation_template" || item.cardPurpose === "method_steps" || item.type === "algorithm");
  const tests = active.filter((item) => item.cardPurpose === "test_statistic" || item.candidateKind === "test_statistic");
  const distinctions = active.filter((item) => item.cardPurpose === "conceptual_distinction");
  const workedExamples = active.filter((item) => item.cardPurpose === "worked_example_pattern" || item.candidateKind === "worked_example");
  const topTopics = result.examPriorityMap.topics.filter((topic) => topic.priority === "very_high" || topic.priority === "high").slice(0, 12);

  return {
    overview: topTopics.length
      ? `Revision pack prioritises ${topTopics.map((topic) => topic.topicName).join(", ")} based on guidance, past papers, problem sheets, and solutions.`
      : "Revision pack built from lecture-note structure with limited assessment evidence.",
    topTopics,
    topPriorityTopics: topTopics,
    coreDefinitions: definitions,
    mustKnowDefinitions: definitions,
    modelsToKnow: models,
    conditionsAndEquivalences: conditions,
    keyFormulas: formulas,
    theoremStatements: theorems,
    testStatisticsAndDiagnostics: tests,
    proofsToKnow: proofs,
    proofCards: proofs,
    formulasToKnow: formulas,
    methodsAndTemplates: methods,
    conceptualDistinctions: distinctions,
    workedExamplePatterns: workedExamples,
    needsReview: result.needsReviewItems,
    rejected: result.rejectedItems,
  };
}

export function revisionPackCategoryForItem(item: RevisionItem): RevisionItem["revisionPackCategory"] {
  if (item.curationDecision === "needs_review" || item.cardPurpose === "needs_review") return "needsReview";
  if (item.cardPurpose === "model_definition" || item.candidateKind === "model_definition") return "modelsToKnow";
  if (item.cardPurpose === "condition_recall" || item.candidateKind === "condition" || item.cardPurpose === "application_condition") return "conditionsAndEquivalences";
  if (item.cardPurpose === "test_statistic" || item.candidateKind === "test_statistic") return "testStatisticsAndDiagnostics";
  if (item.cardPurpose === "worked_example_pattern" || item.candidateKind === "worked_example") return "workedExamplePatterns";
  if (item.type === "definition") return "mustKnowDefinitions";
  if (["theorem", "lemma", "proposition", "corollary"].includes(item.type)) return "theoremStatements";
  if (item.type === "proof" || item.cardPurpose === "proof_recall") return "proofsToKnow";
  if (item.type === "formula" || item.cardPurpose === "formula_recall") return "formulasToKnow";
  if (item.cardPurpose === "calculation_template" || item.cardPurpose === "method_steps" || item.type === "algorithm") return "methodsAndTemplates";
  if (item.cardPurpose === "conceptual_distinction") return "conceptualDistinctions";
  return undefined;
}

export function priorityLabelFromScore(score: number): PriorityLabel {
  if (score >= 85) return "very_high";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

function seed(name: string, aliases: string[], assessmentMode: ExamTopicPriority["likelyAssessmentMode"], cardPurposes: CardPurpose[]): TopicSeed {
  return { name, aliases: [name.toLowerCase(), ...aliases.map((alias) => alias.toLowerCase())], assessmentMode, cardPurposes };
}

function asRole(documents: ParsedDocument[], role: StudyFileRole) {
  return documents.map((document) => ({ ...document, role: document.role ?? role }));
}

function deriveTopicSeeds(notesDocuments: ParsedDocument[]): TopicSeed[] {
  const names = new Set<string>();
  for (const document of notesDocuments) {
    for (const section of document.sections ?? []) {
      const title = section.sectionTitle.replace(/^(?:Chapter|Section)?\s*\d+(?:\.\d+)*\s*/i, "").trim();
      if (title.length >= 4 && title.length <= 60 && !/definition|theorem|proof/i.test(title)) names.add(title);
    }
  }
  return Array.from(names).slice(0, 30).map((name) => seed(name, [name], "mixed", ["definition_recall"]));
}

function splitEvidenceSentences(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 500);
}

function containsPhrase(text: string, phrase: string) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function evidenceFromSentence(document: ParsedDocument, role: StudyFileRole, sentence: string, explanation: string): EvidenceSignal {
  return {
    sourceFile: document.sourceFile,
    sourceRole: role,
    pageNumber: pageNumberForExcerpt(document, sentence),
    excerpt: sentence.slice(0, 360),
    explanation,
  };
}

function explainRole(role: StudyFileRole, topic: string) {
  if (role === "exam_guidance") return `Exam guidance mentions ${topic}.`;
  if (role === "past_paper") return `Past paper uses ${topic}, so it is an assessment pattern signal.`;
  if (role === "problem_sheet") return `Problem sheet practises ${topic}, so it is a skill signal.`;
  if (role === "solution_sheet") return `Solution sheet shows methods involving ${topic}.`;
  return `Lecture notes provide source material for ${topic}.`;
}

function pageNumberForExcerpt(document: ParsedDocument, excerpt: string) {
  return document.pages?.find((page) => page.text.includes(excerpt.slice(0, 80)))?.pageNumber;
}

function priorityFromWeightedHits(weightedHits: number, evidence: EvidenceSignal[]): PriorityLabel {
  const hasAssessment = evidence.some((item) => item.sourceRole === "past_paper" || item.sourceRole === "exam_guidance");
  if (weightedHits >= 16 && hasAssessment) return "very_high";
  if (weightedHits >= 10 || hasAssessment && weightedHits >= 6) return "high";
  if (weightedHits >= 4) return "medium";
  return "low";
}

function priorityRank(priority: PriorityLabel) {
  return { unknown: 0, low: 1, medium: 2, high: 3, very_high: 4 }[priority];
}

function buildRecurringQuestionTypes(documents: ParsedDocument[], topics: ExamTopicPriority[]): RecurringQuestionType[] {
  const assessmentSentences = documents
    .filter((document) => document.role === "past_paper" || document.role === "problem_sheet" || document.role === "exam_guidance")
    .flatMap((document) => splitEvidenceSentences(document.fullText).map((sentence) => ({ document, sentence })));
  const patterns = [
    { name: "State or define", regex: /\b(state|define|give the definition)\b/i, purposes: ["definition_recall"] as CardPurpose[] },
    { name: "Prove or show", regex: /\b(prove|show that|derive)\b/i, purposes: ["proof_recall", "theorem_statement"] as CardPurpose[] },
    { name: "Calculate or estimate", regex: /\b(calculate|compute|estimate|find)\b/i, purposes: ["calculation_template", "formula_recall"] as CardPurpose[] },
    { name: "Explain or interpret", regex: /\b(explain|interpret|compare|distinguish)\b/i, purposes: ["conceptual_distinction", "application_condition"] as CardPurpose[] },
  ];
  return patterns.flatMap((pattern) => {
    const matches = assessmentSentences.filter(({ sentence }) => pattern.regex.test(sentence)).slice(0, 6);
    if (matches.length === 0) return [];
    const relatedTopics = topics.filter((topic) => matches.some(({ sentence }) => containsPhrase(sentence, topic.topicName))).map((topic) => topic.topicName);
    return [{
      name: pattern.name,
      description: `${pattern.name} appears in assessment or guidance wording.`,
      relatedTopics: relatedTopics.length ? Array.from(new Set(relatedTopics)) : topics.slice(0, 3).map((topic) => topic.topicName),
      evidence: matches.map(({ document, sentence }) => evidenceFromSentence(document, document.role ?? "other", sentence, "Question wording indicates a recurring assessment mode.")),
      cardPurposesSuggested: pattern.purposes,
    }];
  });
}

function buildRequiredItemSignals(documents: ParsedDocument[], itemType: RevisionItemType, topics: ExamTopicPriority[]): RequiredItemSignal[] {
  const roleDocuments = documents.filter((document) => document.role !== "lecture_notes");
  const verbs = itemType === "proof"
    ? "(prove|proof|show that|derive)"
    : itemType === "formula"
      ? "(formula|equation|calculate|compute)"
      : itemType === "theorem"
        ? "(theorem|state|result)"
        : "(definition|define|state)";
  const signals = new Map<string, RequiredItemSignal>();
  for (const document of roleDocuments) {
    for (const sentence of splitEvidenceSentences(document.fullText)) {
      if (!new RegExp(verbs, "i").test(sentence)) continue;
      const topic = topics.find((candidate) => containsPhrase(sentence, candidate.topicName)) ?? topics[0];
      const name = topic?.topicName ?? sentence.slice(0, 60);
      const current = signals.get(name);
      const evidence = evidenceFromSentence(document, document.role ?? "other", sentence, `${itemType} is signalled by assessment wording.`);
      signals.set(name, {
        name,
        itemType,
        priority: strongerPriority(current?.priority, topic?.priority ?? "medium"),
        evidence: [...(current?.evidence ?? []), evidence].slice(0, 5),
      });
    }
  }
  return Array.from(signals.values());
}

function buildCalculationTemplates(documents: ParsedDocument[], topics: ExamTopicPriority[]): CalculationTemplateSignal[] {
  const calculationSentences = documents
    .filter((document) => document.role === "past_paper" || document.role === "problem_sheet" || document.role === "solution_sheet")
    .flatMap((document) => splitEvidenceSentences(document.fullText).map((sentence) => ({ document, sentence })))
    .filter(({ sentence }) => /\b(calculate|compute|estimate|derive|solve|predict|kriging|likelihood|valid)\b/i.test(sentence));
  const byTopic = new Map<string, CalculationTemplateSignal>();
  for (const topic of topics) {
    const matches = calculationSentences.filter(({ sentence }) => containsPhrase(sentence, topic.topicName)).slice(0, 4);
    if (matches.length === 0) continue;
    byTopic.set(topic.topicName, {
      name: `${topic.topicName} calculation template`,
      relatedTopics: [topic.topicName],
      requiredSteps: inferRequiredSteps(topic.topicName, matches.map((match) => match.sentence).join(" ")),
      evidence: matches.map(({ document, sentence }) => evidenceFromSentence(document, document.role ?? "other", sentence, "Assessment asks for a repeatable calculation or method.")),
    });
  }
  return Array.from(byTopic.values());
}

function buildConceptualDistinctions(documents: ParsedDocument[], topics: ExamTopicPriority[]): ConceptualDistinctionSignal[] {
  const sentences = documents
    .filter((document) => document.role !== "lecture_notes")
    .flatMap((document) => splitEvidenceSentences(document.fullText).map((sentence) => ({ document, sentence })))
    .filter(({ sentence }) => /\b(compare|distinguish|difference|versus|vs\.?|strict|weak|isotropic|anisotropic)\b/i.test(sentence));
  return sentences.slice(0, 8).map(({ document, sentence }) => {
    const related = topics.filter((topic) => containsPhrase(sentence, topic.topicName)).map((topic) => topic.topicName);
    return {
      name: related.length >= 2 ? `${related[0]} vs ${related[1]}` : sentence.slice(0, 70),
      conceptsCompared: related.length ? related : topics.slice(0, 2).map((topic) => topic.topicName),
      evidence: [evidenceFromSentence(document, document.role ?? "other", sentence, "Assessment wording asks for a conceptual distinction.")],
    } satisfies ConceptualDistinctionSignal;
  });
}

function inferRequiredSteps(topic: string, text: string) {
  const lower = `${topic} ${text}`.toLowerCase();
  if (lower.includes("kriging")) return ["Identify covariance/variogram model", "Assemble covariance matrix and vector", "Solve weights", "Compute predictor and uncertainty"];
  if (lower.includes("covariance") || lower.includes("positive")) return ["State required validity condition", "Check symmetry", "Check positive semi-definiteness"];
  if (lower.includes("likelihood")) return ["Write likelihood", "Simplify log-likelihood", "Differentiate or optimise", "Interpret estimator"];
  return ["Identify inputs", "Select the relevant formula or theorem", "Carry out calculation", "Interpret the result"];
}

function strongerPriority(current: PriorityLabel | undefined, next: PriorityLabel) {
  if (!current) return next;
  return priorityRank(next) > priorityRank(current) ? next : current;
}
