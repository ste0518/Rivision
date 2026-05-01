export type RevisionItemType =
  | "definition"
  | "theorem"
  | "lemma"
  | "proposition"
  | "corollary"
  | "formula"
  | "proof"
  | "algorithm"
  | "example"
  | "remark"
  | "assumption"
  | "property"
  | "other";
export type RevisionImportance = "must_know" | "partial" | "not_required" | "unknown";
export type ClassificationConfidence = "high" | "medium" | "low";
export type ExtractionPipelineMode = "ai_key_revision_analysis" | "local_rules_only" | "manual_json_import" | "openai_api" | "cheap_scan_then_verify";
export type StandaloneValue = "high" | "medium" | "low";
export type StudyFileRole =
  | "lecture_notes"
  | "exam_guidance"
  | "past_paper"
  | "problem_sheet"
  | "solution_sheet"
  | "formula_sheet"
  | "mark_scheme"
  | "other";
export type PriorityLabel = "very_high" | "high" | "medium" | "low" | "unknown";
export type RevisionPackCategory =
  | "mustKnowDefinitions"
  | "theoremStatements"
  | "proofsToKnow"
  | "formulasToKnow"
  | "methodsAndTemplates"
  | "conceptualDistinctions"
  | "modelsToKnow"
  | "conditionsAndEquivalences"
  | "testStatisticsAndDiagnostics"
  | "workedExamplePatterns"
  | "needsReview"
  | "rejected";
export type CardPurpose =
  | "definition_recall"
  | "model_definition"
  | "condition_recall"
  | "theorem_statement"
  | "proof_recall"
  | "formula_recall"
  | "method_steps"
  | "test_statistic"
  | "conceptual_distinction"
  | "application_condition"
  | "calculation_template"
  | "worked_example_pattern"
  | "background_context"
  | "needs_review";
export type CurationStatus = "kept" | "needs_review";
export type CurationDecision = "keep" | "needs_review" | "reject" | "embed_in_parent";
export type RejectionCategory =
  | "bibliography_or_reference"
  | "ordinary_explanatory_text"
  | "formula_not_standalone"
  | "intermediate_proof_step"
  | "duplicate"
  | "too_broad"
  | "not_examinable"
  | "background_only"
  | "low_value"
  | "parse_noise";
export type RevisionCandidateKind =
  | "explicit_definition"
  | "implicit_definition"
  | "model_definition"
  | "theorem_statement"
  | "property"
  | "condition"
  | "formula"
  | "method"
  | "method_steps"
  | "worked_example"
  | "calculation_template"
  | "conceptual_distinction"
  | "test_statistic"
  | "summary_table"
  | "warning_or_exam_trap"
  | "background_context"
  | "ordinary_text"
  | "parse_noise";
export type MathNormalizationProfile =
  | "generic"
  | "time_series"
  | "spatial_statistics"
  | "financial_math"
  | "monte_carlo_sampling"
  | "auto";
export type CourseType =
  | "monte_carlo_sampling"
  | "time_series"
  | "spatial_statistics"
  | "financial_math"
  | "statistics"
  | "probability"
  | "linear_algebra"
  | "calculus"
  | "machine_learning"
  | "generic_math"
  | "unknown";
export type CourseTopicType =
  | "definition"
  | "model"
  | "condition"
  | "formula"
  | "method"
  | "test"
  | "conceptual_distinction"
  | "worked_example"
  | "background";
export type CourseFormulaRole =
  | "definition"
  | "model_equation"
  | "estimator"
  | "test_statistic"
  | "condition"
  | "intermediate_derivation";
export type Importance = RevisionImportance;
export type ReviewRating = "again" | "hard" | "good" | "easy";

export type ParsedPage = {
  pageNumber: number;
  text: string;
  charCount: number;
  visualHeavy?: boolean;
  imageObjectCount?: number;
  textQuality?: "high" | "medium" | "low";
  warnings?: string[];
};

export type ParsedSection = {
  sectionTitle: string;
  sectionNumber?: string;
  startOffset: number;
  endOffset: number;
  text: string;
};

export type ParseDiagnostics = {
  success: boolean;
  charCount: number;
  pageCount?: number;
  warnings: string[];
  errors: string[];
  likelyScannedPdf?: boolean;
  extractionQuality: "high" | "medium" | "low" | "failed";
};

export type ParsedDocument = {
  sourceFile: string;
  fileType: "pdf" | "docx" | "txt" | "md" | "unknown";
  role?: StudyFileRole;
  fullText: string;
  pages?: ParsedPage[];
  sections?: ParsedSection[];
  diagnostics: ParseDiagnostics;
};

export type RevisionCandidateLabel =
  | "Definition"
  | "Theorem"
  | "Lemma"
  | "Proposition"
  | "Corollary"
  | "Remark"
  | "Example"
  | "Question"
  | "Proof"
  | "Formula"
  | "Assumption"
  | "Property"
  | "Algorithm"
  | "Other";

export type RevisionCandidate = {
  id: string;
  label: RevisionCandidateLabel;
  candidateKind?: RevisionCandidateKind;
  conceptName?: string;
  number?: string;
  title?: string;
  rawText: string;
  statement?: string;
  proof?: string;
  sourceFile: string;
  pageNumber?: number;
  sourceLocation?: string;
  startOffset: number;
  endOffset: number;
  extractionWarning?: string;
  section?: string;
};

export type CandidateRevisionBlock = RevisionCandidate & { type: RevisionItemType };

export interface CandidateRelevanceScore {
  candidateId: string;
  examRelevance: 0 | 1 | 2 | 3 | 4 | 5;
  standaloneFlashcardValue: 0 | 1 | 2 | 3 | 4 | 5;
  conceptualCentrality: 0 | 1 | 2 | 3 | 4 | 5;
  guidanceSupport: 0 | 1 | 2 | 3 | 4 | 5;
  formulaImportance: 0 | 1 | 2 | 3 | 4 | 5;
  proofRequirement: 0 | 1 | 2 | 3 | 4 | 5;
  parseQuality: "high" | "medium" | "low";
  latexQuality: "high" | "medium" | "low";
  decision: CurationDecision;
  redundancyRisk: 0 | 1 | 2 | 3 | 4 | 5;
  keepDecision: "keep" | "embed_in_parent" | "reject" | "needs_review";
  reason: string;
  evidence: string[];
}

export type CandidateScore = Omit<CandidateRelevanceScore, "redundancyRisk" | "keepDecision">;

export interface FormulaPolicySummary {
  standaloneFormulaRule: string;
  keepStandaloneWhen: string[];
  embedOrRejectWhen: string[];
  guidanceEvidence: string[];
}

export interface ProofPolicySummary {
  proofCardRule: string;
  proofRequiredWhen: string[];
  proofOptionalWhen: string[];
  guidanceEvidence: string[];
}

export interface CourseTopic {
  name: string;
  aliases?: string[];
  section?: string;
  sectionNumber?: string;
  relatedItems: string[];
  importance: "core" | "supporting" | "background" | "unknown";
  evidence: string[];
  sourceLocations?: SourceLocation[];
  type?: CourseTopicType;
  likelyExamUse:
    | "definition_recall"
    | "theorem_statement"
    | "proof"
    | "calculation"
    | "derivation"
    | "conceptual_explanation"
    | "model_interpretation"
    | "mixed"
    | "not_likely";
}

export interface CourseSection {
  number?: string;
  sectionNumber?: string;
  title: string;
  sourceFile: string;
  pageStart?: number;
  pageEnd?: number;
  summary: string;
  detectedImportance?: "core" | "supporting" | "background" | "unknown";
  likelyImportance: "core" | "supporting" | "background" | "unknown";
}

export interface SourceLocation {
  sourceFile: string;
  fileRole: StudyFileRole;
  pageNumber?: number;
  section?: string;
  excerpt?: string;
}

export interface CourseChapter {
  number?: string;
  title: string;
  pageStart?: number;
  pageEnd?: number;
  sections: CourseSection[];
}

export interface CourseModelFamily {
  name: string;
  notation?: string;
  definition?: string;
  assumptions?: string[];
  keyProperties?: string[];
  relatedFormulas?: string[];
  sourceLocations: SourceLocation[];
}

export interface CourseMethod {
  name: string;
  purpose: string;
  steps: string[];
  sourceLocations: SourceLocation[];
}

export interface CourseFormula {
  name: string;
  formulaLatex: string;
  role: CourseFormulaRole;
  standaloneValue: StandaloneValue;
  sourceLocations: SourceLocation[];
}

export interface CourseTest {
  name: string;
  hypotheses?: string[];
  statisticLatex?: string;
  decisionRule?: string;
  assumptions?: string[];
  sourceLocations: SourceLocation[];
}

export interface WorkedExamplePattern {
  name: string;
  problemType: string;
  requiredSteps: string[];
  relatedTopics: string[];
  sourceLocations: SourceLocation[];
}

export interface CourseMap {
  courseTitle?: string;
  courseType: CourseType;
  chapters: CourseChapter[];
  topics: CourseTopic[];
  modelFamilies: CourseModelFamily[];
  methods: CourseMethod[];
  formulas: CourseFormula[];
  tests: CourseTest[];
  workedExamples: WorkedExamplePattern[];
  parseWarnings: string[];
}

export interface CourseStructureMap {
  sections: CourseSection[];
  topics: CourseTopic[];
  detectedItems: RevisionCandidate[];
}

export interface RequiredSection {
  sectionNumber?: string;
  sectionTitle?: string;
  requirement:
    | "must_know"
    | "statement_only"
    | "proof_required"
    | "proof_not_required"
    | "understand_only"
    | "not_required"
    | "unknown";
  evidence: string[];
}

export interface CourseKnowledgeMap {
  coreTopics: CourseTopic[];
  requiredSections: RequiredSection[];
  formulaPolicy: FormulaPolicySummary;
  proofPolicy: ProofPolicySummary;
}

export interface EvidenceSignal {
  sourceFile: string;
  sourceRole: StudyFileRole;
  pageNumber?: number;
  excerpt: string;
  explanation: string;
}

export interface ExamTopicPriority {
  topicName: string;
  sectionNumbers?: string[];
  priorityScore?: number;
  priorityLabel?: PriorityLabel;
  priority: PriorityLabel;
  evidence: EvidenceSignal[];
  likelyAssessmentModes?: CardPurpose[];
  likelyAssessmentMode:
    | "definition_recall"
    | "theorem_statement"
    | "proof"
    | "calculation"
    | "derivation"
    | "conceptual_explanation"
    | "model_interpretation"
    | "mixed";
  reason?: string;
}

export interface RecurringQuestionType {
  name: string;
  description: string;
  relatedTopics: string[];
  sourceLocations?: SourceLocation[];
  evidence: EvidenceSignal[];
  cardPurposesSuggested: CardPurpose[];
  suggestedCardPurposes?: CardPurpose[];
  priorityBoost?: number;
}

export interface TopicFrequency {
  topicName: string;
  count: number;
  sourceBreakdown: Record<StudyFileRole, number>;
  examples: SourceLocation[];
}

export interface RequiredProofSignal {
  theoremOrResultName: string;
  evidence: SourceLocation[];
  priorityBoost: number;
}

export interface CalculationSignal {
  methodName: string;
  evidence: SourceLocation[];
  requiredSteps: string[];
  priorityBoost: number;
}

export interface FormulaRecallSignal {
  formulaName: string;
  evidence: SourceLocation[];
  priorityBoost: number;
}

export interface ConceptualSignal {
  distinctionName: string;
  evidence: SourceLocation[];
  priorityBoost: number;
}

export interface AssessmentMap {
  recurringQuestionTypes: RecurringQuestionType[];
  topicFrequency: TopicFrequency[];
  proofSignals: RequiredProofSignal[];
  calculationSignals: CalculationSignal[];
  formulaRecallSignals: FormulaRecallSignal[];
  conceptualSignals: ConceptualSignal[];
}

export interface RequiredItemSignal {
  name: string;
  itemType: RevisionItemType;
  priority: PriorityLabel;
  evidence: EvidenceSignal[];
}

export interface CalculationTemplateSignal {
  name: string;
  relatedTopics: string[];
  requiredSteps: string[];
  evidence: EvidenceSignal[];
}

export interface ConceptualDistinctionSignal {
  name: string;
  conceptsCompared: string[];
  evidence: EvidenceSignal[];
}

export interface ExamPriorityMap {
  topics: ExamTopicPriority[];
  formulas?: ExamFormulaPriority[];
  methods?: ExamMethodPriority[];
  proofs?: ExamProofPriority[];
  conceptualDistinctionsPriority?: ExamConceptPriority[];
  recurringQuestionTypes: RecurringQuestionType[];
  requiredDefinitions: RequiredItemSignal[];
  requiredTheorems: RequiredItemSignal[];
  requiredProofs: RequiredItemSignal[];
  requiredFormulas: RequiredItemSignal[];
  calculationTemplates: CalculationTemplateSignal[];
  conceptualDistinctions: ConceptualDistinctionSignal[];
  notes: string[];
}

export interface ExamFormulaPriority {
  formulaName: string;
  priorityScore: number;
  priorityLabel: PriorityLabel;
  evidence: SourceLocation[];
  reason: string;
}

export interface ExamMethodPriority {
  methodName: string;
  priorityScore: number;
  priorityLabel: PriorityLabel;
  evidence: SourceLocation[];
  likelyAssessmentModes: CardPurpose[];
  reason: string;
}

export interface ExamProofPriority {
  theoremOrResultName: string;
  priorityScore: number;
  priorityLabel: PriorityLabel;
  evidence: SourceLocation[];
  reason: string;
}

export interface ExamConceptPriority {
  distinctionName: string;
  priorityScore: number;
  priorityLabel: PriorityLabel;
  evidence: SourceLocation[];
  reason: string;
}

export interface CurationReport {
  totalCandidates: number;
  keptCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  embeddedCount: number;
  formulaCandidates: number;
  formulaKeptCount: number;
  formulaRejectedCount: number;
  mainTopics: string[];
  weakParsingWarnings: string[];
  pipelineStages?: Array<{
    name: string;
    status: "complete" | "warning" | "error";
    detail: string;
  }>;
  courseType?: CourseType;
  packCompletenessScore?: number;
  candidateCoverageScore?: number;
  latexQualityScore?: number;
  assessmentEvidenceCoverage?: number;
  notes: string[];
}

export type StudyFile = {
  id: string;
  name: string;
  role: StudyFileRole;
  mimeType: string;
  size: number;
  uploadedAt: string;
  content: string;
  blob?: Blob;
  parsedDocument?: ParsedDocument;
};
export type GuidanceFile = StudyFile & { kind: "guidance"; };

export type RevisionItem = {
  id: string;
  type: RevisionItemType;
  candidateKind?: RevisionCandidateKind;
  title: string;
  conceptName?: string;
  displayTitle?: string;
  cardFront: string;
  taskPrompt?: string;
  statement: string;
  statementLatex?: string;
  originalRawText?: string;
  proof?: string;
  proofLatex?: string;
  proofRequired?: boolean;
  sourceFile: string;
  sourceLocation?: string;
  pageNumber?: number;
  section?: string;
  theoremNumber?: string;
  tags: string[];
  importance: RevisionImportance;
  cardPurpose: CardPurpose;
  curationStatus?: CurationStatus;
  classificationConfidence?: ClassificationConfidence;
  guidanceReason?: string;
  guidanceEvidence?: string[];
  uncertaintyNote?: string;
  extractionWarning?: string;
  questionPrompt: string;
  answer: string;
  answerLatex?: string;
  standaloneValue?: StandaloneValue;
  curationDecision?: CurationDecision;
  curationReason?: string;
  parentItemId?: string;
  embeddedFormulas?: string[];
  latexQuality?: "high" | "medium" | "low";
  relevanceReason?: string;
  relevanceScore?: CandidateRelevanceScore;
  priorityScore: number;
  priorityLabel: PriorityLabel;
  evidenceSignals: EvidenceSignal[];
  whyThisCardMatters: string;
  revisionPackCategory?: RevisionPackCategory;
  deletedAt?: string;
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
  warnings?: string[];
  mathNormalizationProfile?: MathNormalizationProfile;
  latestRating?: ReviewRating;
  reviewCount?: number;
  dueAt?: string;
  lastReviewedAt?: string;
};

export interface LatexQualityReport {
  score: "high" | "medium" | "low";
  issues: string[];
}

export interface RejectedRevisionItem {
  id: string;
  originalCandidateId?: string;
  originalItem?: RevisionItem;
  title: string;
  type: RevisionItemType;
  rawText?: string;
  rejectionReason: string;
  rejectionCategory: RejectionCategory;
  confidence: ClassificationConfidence;
  sourceLocation?: string;
}

export interface EmbeddedRevisionItem {
  id: string;
  parentItemId: string;
  content: string;
  reason: string;
  sourceLocation?: string;
}

export interface CuratedRevisionResult {
  keptItems: RevisionItem[];
  needsReviewItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  courseMap?: CourseMap;
  courseStructureMap: CourseStructureMap;
  courseKnowledgeMap: CourseKnowledgeMap;
  assessmentMap?: AssessmentMap;
  examPriorityMap: ExamPriorityMap;
  revisionPack: RevisionPack;
  curationReport: CurationReport;
}

export type CuratedDeckResult = CuratedRevisionResult;

export type ReviewSession = { id: string; itemId: string; rating: ReviewRating; reviewedAt: string; };
export interface RevisionPack {
  overview: string;
  courseType?: CourseType;
  topPriorityTopics?: ExamTopicPriority[];
  topTopics: ExamTopicPriority[];
  coreDefinitions?: RevisionItem[];
  mustKnowDefinitions: RevisionItem[];
  modelsToKnow?: RevisionItem[];
  conditionsAndEquivalences?: RevisionItem[];
  keyFormulas?: RevisionItem[];
  theoremStatements: RevisionItem[];
  testStatisticsAndDiagnostics?: RevisionItem[];
  proofsToKnow: RevisionItem[];
  proofCards?: RevisionItem[];
  formulasToKnow: RevisionItem[];
  methodsAndTemplates: RevisionItem[];
  conceptualDistinctions: RevisionItem[];
  workedExamplePatterns?: RevisionItem[];
  needsReview: RevisionItem[];
  rejected: RejectedRevisionItem[];
  embedded?: EmbeddedRevisionItem[];
}

export type ExtractionVerificationReport = {
  missingCandidates: Array<{
    title: string;
    type: RevisionItemType;
    sourceLocation?: string;
    pageNumber?: number;
    reason: string;
  }>;
  suspiciousItems: Array<{
    itemId: string;
    issue: string;
  }>;
  guidanceAmbiguities: Array<{
    guidanceText: string;
    affectedSectionsOrTopics: string[];
    interpretation: string;
    confidence: ClassificationConfidence;
  }>;
  overallCompleteness: "high" | "medium" | "low";
  notes: string;
};

export const revisionItemTypes: RevisionItemType[] = [
  "definition",
  "theorem",
  "lemma",
  "proposition",
  "corollary",
  "formula",
  "proof",
  "algorithm",
  "example",
  "remark",
  "assumption",
  "property",
  "other",
];
export const importances: RevisionImportance[] = ["must_know", "partial", "not_required", "unknown"];
export const studyFileRoles: StudyFileRole[] = ["lecture_notes", "exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "formula_sheet", "mark_scheme", "other"];
export const priorityLabels: PriorityLabel[] = ["very_high", "high", "medium", "low", "unknown"];
export const revisionPackCategories: RevisionPackCategory[] = ["mustKnowDefinitions", "theoremStatements", "proofsToKnow", "formulasToKnow", "methodsAndTemplates", "conceptualDistinctions", "modelsToKnow", "conditionsAndEquivalences", "testStatisticsAndDiagnostics", "workedExamplePatterns", "needsReview", "rejected"];
export const cardPurposes: CardPurpose[] = [
  "definition_recall",
  "model_definition",
  "condition_recall",
  "theorem_statement",
  "proof_recall",
  "formula_recall",
  "method_steps",
  "test_statistic",
  "conceptual_distinction",
  "application_condition",
  "calculation_template",
  "worked_example_pattern",
  "background_context",
  "needs_review",
];
