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
  | "other";
export type PriorityLabel = "very_high" | "high" | "medium" | "low" | "unknown";
export type RevisionPackCategory =
  | "mustKnowDefinitions"
  | "theoremStatements"
  | "proofsToKnow"
  | "formulasToKnow"
  | "methodsAndTemplates"
  | "conceptualDistinctions"
  | "needsReview"
  | "rejected";
export type CardPurpose =
  | "definition_recall"
  | "theorem_statement"
  | "proof_recall"
  | "formula_recall"
  | "method_steps"
  | "conceptual_distinction"
  | "application_condition"
  | "calculation_template"
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
export type Importance = RevisionImportance;
export type ReviewRating = "again" | "hard" | "good" | "easy";

export type ParsedPage = {
  pageNumber: number;
  text: string;
  charCount: number;
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
  section?: string;
  relatedItems: string[];
  importance: "core" | "supporting" | "background" | "unknown";
  evidence: string[];
  likelyExamUse:
    | "definition_recall"
    | "theorem_statement"
    | "proof"
    | "calculation"
    | "derivation"
    | "conceptual_explanation"
    | "not_likely";
}

export interface CourseSection {
  sectionNumber?: string;
  title: string;
  sourceFile: string;
  pageStart?: number;
  pageEnd?: number;
  summary: string;
  likelyImportance: "core" | "supporting" | "background" | "unknown";
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
  priority: PriorityLabel;
  evidence: EvidenceSignal[];
  likelyAssessmentMode:
    | "definition_recall"
    | "theorem_statement"
    | "proof"
    | "calculation"
    | "derivation"
    | "conceptual_explanation"
    | "model_interpretation"
    | "mixed";
}

export interface RecurringQuestionType {
  name: string;
  description: string;
  relatedTopics: string[];
  evidence: EvidenceSignal[];
  cardPurposesSuggested: CardPurpose[];
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
  recurringQuestionTypes: RecurringQuestionType[];
  requiredDefinitions: RequiredItemSignal[];
  requiredTheorems: RequiredItemSignal[];
  requiredProofs: RequiredItemSignal[];
  requiredFormulas: RequiredItemSignal[];
  calculationTemplates: CalculationTemplateSignal[];
  conceptualDistinctions: ConceptualDistinctionSignal[];
  notes: string[];
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
  parsedDocument?: ParsedDocument;
};
export type GuidanceFile = StudyFile & { kind: "guidance"; };

export type RevisionItem = {
  id: string;
  type: RevisionItemType;
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
  courseStructureMap: CourseStructureMap;
  courseKnowledgeMap: CourseKnowledgeMap;
  examPriorityMap: ExamPriorityMap;
  revisionPack: RevisionPack;
  curationReport: CurationReport;
}

export type CuratedDeckResult = CuratedRevisionResult;

export type ReviewSession = { id: string; itemId: string; rating: ReviewRating; reviewedAt: string; };
export interface RevisionPack {
  overview: string;
  topTopics: ExamTopicPriority[];
  mustKnowDefinitions: RevisionItem[];
  theoremStatements: RevisionItem[];
  proofsToKnow: RevisionItem[];
  formulasToKnow: RevisionItem[];
  methodsAndTemplates: RevisionItem[];
  conceptualDistinctions: RevisionItem[];
  needsReview: RevisionItem[];
  rejected: RejectedRevisionItem[];
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
export const studyFileRoles: StudyFileRole[] = ["lecture_notes", "exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "formula_sheet", "other"];
export const priorityLabels: PriorityLabel[] = ["very_high", "high", "medium", "low", "unknown"];
export const revisionPackCategories: RevisionPackCategory[] = ["mustKnowDefinitions", "theoremStatements", "proofsToKnow", "formulasToKnow", "methodsAndTemplates", "conceptualDistinctions", "needsReview", "rejected"];
export const cardPurposes: CardPurpose[] = [
  "definition_recall",
  "theorem_statement",
  "proof_recall",
  "formula_recall",
  "method_steps",
  "conceptual_distinction",
  "application_condition",
  "calculation_template",
  "background_context",
  "needs_review",
];
