/**
 * Student-facing structured revision pack (exam overview, topics, sections).
 * Distinct from {@link RevisionPack} in `types.ts`, which bundles {@link RevisionItem} cards.
 */

export type TopicImportance = "high" | "medium" | "low";

export type DefinitionImportance = "must_know" | "high" | "medium" | "low";

export type MathStatus = "ok" | "needs_check" | "broken";

/** Alias for documentation — main structured output of `generateStudentRevisionPack`. */
export type StudentRevisionPack = GeneratedRevisionPack;

export interface ExamOverviewSection {
  courseName?: string;
  summary: string;
  likelyExamStructure: string;
  highPriorityTopics: string[];
}

export interface GeneratedCourseTopic {
  id: string;
  title: string;
  sourceFileNames: string[];
  importance: TopicImportance;
  evidenceReason: string;
}

export interface GeneratedDefinitionItem {
  id: string;
  term: string;
  definition: string;
  source: string;
  importance: DefinitionImportance;
}

export interface GeneratedFormulaItem {
  id: string;
  name: string;
  latex: string;
  whenToUse: string;
  source: string;
  mathStatus: MathStatus;
}

export interface GeneratedProofItem {
  id: string;
  name: string;
  statement: string;
  proofSkeleton: string;
  commonMistake: string;
  source?: string;
}

export interface GeneratedMethodTemplate {
  id: string;
  problemType: string;
  steps: string[];
  triggerWords: string[];
  relatedPracticeType: string;
}

export interface GeneratedPastPaperPattern {
  id: string;
  title: string;
  evidence: string;
  likelyExamStyle: string;
  suggestedPracticeQuestion: string;
}

export interface GeneratedPracticeQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
  topic: string;
  difficulty: "easy" | "medium" | "hard";
  sourceBasis: string;
  hints: string[];
}

export interface GeneratedCommonMistake {
  id: string;
  mistake: string;
  whyItHappens: string;
  howToAvoid: string;
}

export interface GeneratedCramSheet {
  definitionBullets: string[];
  formulaBullets: string[];
  proofSkeletonBullets: string[];
  trapBullets: string[];
}

export interface GeneratedRevisionPack {
  generatedAt: string;
  examOverview: ExamOverviewSection;
  courseMap: GeneratedCourseTopic[];
  definitions: GeneratedDefinitionItem[];
  formulas: GeneratedFormulaItem[];
  proofs: GeneratedProofItem[];
  methods: GeneratedMethodTemplate[];
  pastPaperPatterns: GeneratedPastPaperPattern[];
  commonMistakes: GeneratedCommonMistake[];
  cramSheet: GeneratedCramSheet;
}

export type PracticeSessionQuestion = GeneratedPracticeQuestion & {
  mode: "quick_recall" | "exam_style" | "weak_topic";
};

/** Public aliases matching product vocabulary (portable to API later). */
export type CourseTopic = GeneratedCourseTopic;
export type DefinitionItem = GeneratedDefinitionItem;
export type FormulaItem = GeneratedFormulaItem;
export type ProofItem = GeneratedProofItem;
export type MethodTemplate = GeneratedMethodTemplate;
export type PastPaperPattern = GeneratedPastPaperPattern;
export type PracticeQuestion = GeneratedPracticeQuestion;
export type CommonMistakeItem = GeneratedCommonMistake;
export type CramSheet = GeneratedCramSheet;
