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
export type ExtractionPipelineMode = "local_rules_only" | "manual_json_import" | "openai_api" | "cheap_scan_then_verify";
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
  fullText: string;
  pages?: ParsedPage[];
  sections?: ParsedSection[];
  diagnostics: ParseDiagnostics;
};

export type StudyFile = {
  id: string;
  name: string;
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
  statement: string;
  proof?: string;
  proofRequired?: boolean;
  sourceFile: string;
  sourceLocation?: string;
  pageNumber?: number;
  section?: string;
  theoremNumber?: string;
  tags: string[];
  importance: RevisionImportance;
  classificationConfidence?: ClassificationConfidence;
  guidanceReason?: string;
  guidanceEvidence?: string[];
  uncertaintyNote?: string;
  questionPrompt: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
  warnings?: string[];
  latestRating?: ReviewRating;
  reviewCount?: number;
  dueAt?: string;
  lastReviewedAt?: string;
};

export type ReviewSession = { id: string; itemId: string; rating: ReviewRating; reviewedAt: string; };
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
