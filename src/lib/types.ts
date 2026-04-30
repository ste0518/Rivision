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
  | "other";
export type RevisionImportance = "must_know" | "partial" | "not_required" | "unknown";
export type Importance = RevisionImportance;
export type ReviewRating = "again" | "hard" | "good" | "easy";

export type StudyFile = { id: string; name: string; mimeType: string; size: number; uploadedAt: string; content: string; };
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
  section?: string;
  theoremNumber?: string;
  tags: string[];
  importance: RevisionImportance;
  guidanceReason?: string;
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
    reason: string;
  }>;
  suspiciousItems: Array<{
    itemId: string;
    issue: string;
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
  "other",
];
export const importances: RevisionImportance[] = ["must_know", "partial", "not_required", "unknown"];
