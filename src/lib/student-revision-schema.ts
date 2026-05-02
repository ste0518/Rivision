/**
 * Student-facing structured revision pack (exam overview, topics, sections).
 * Distinct from {@link RevisionPack} in `types.ts`, which bundles {@link RevisionItem} cards.
 */

import type { DocumentProfile } from "@/lib/document-profile";
import type { SectionBlock } from "@/lib/section-blocks";

export type TopicImportance = "high" | "medium" | "low";

export type DefinitionImportance = "must_know" | "high" | "medium" | "low";

export type MathStatus = "ok" | "needs_check" | "broken";

/** Structured study-pack entry kinds for labelled lecture notes. */
export type StudyPackEntryKind =
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "remark"
  | "example"
  | "exercise"
  | "algorithm";

/** Alias for documentation — main structured output of `generateStudentRevisionPack`. */
export type StudentRevisionPack = GeneratedRevisionPack;

export interface ExamOverviewSection {
  courseName?: string;
  summary: string;
  likelyExamStructure: string;
  highPriorityTopics: string[];
  /** Shown when active recall cards come from a fallback path while typed pack items are empty. */
  reviewCardsWarning?: string;
}

export interface GeneratedCourseTopic {
  id: string;
  title: string;
  sourceFileNames: string[];
  importance: TopicImportance;
  evidenceReason: string;
}

/** Rich course map for long lecture notes (one row per major chapter/section). */
export interface CourseMapChapterEntry {
  chapter: string;
  title: string;
  coreTopics: string[];
  mustKnowDefinitions: string[];
  mustKnowFormulas: string[];
  workedExamples: string[];
  examRisk: "low" | "medium" | "high";
}

export interface DebugExtractedExampleExercise {
  id: string;
  kind: "example" | "exercise";
  title: string;
  body: string;
  sourceFile: string;
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceExcerpt: string;
  groundingConfidence: number;
}

/** Source grounding for every generated study-pack artefact. */
export type SourceGrounding = {
  sourceFile: string;
  sourcePage: number | null;
  sourceSection: string | null;
  sourceExcerpt: string;
  /** 0–1 confidence that the excerpt supports the item. */
  groundingConfidence: number;
};

export interface GeneratedDefinitionItem {
  id: string;
  term: string;
  definition: string;
  /** @deprecated Prefer {@link sourceFile}; retained for persisted packs. */
  source: string;
  importance: DefinitionImportance;
  /** Formal numbering, e.g. "Definition 4.1". */
  formalLabel?: string;
  /** Explicit Definition N.M vs heuristic conceptual entries from revision concepts. */
  definitionKind?: "formal" | "conceptual";
  /** Semantic kind from notes (definition vs theorem, etc.). */
  itemKind?: StudyPackEntryKind;
  sourceFile?: string;
  sourcePage?: number;
  sourceSection?: string;
  /** Same as formalLabel when from labelled extraction. */
  sourceLabel?: string;
  sourceExcerpt?: string;
  mathStatus?: MathStatus;
  grounding?: SourceGrounding;
}

export interface GeneratedFormulaItem {
  id: string;
  name: string;
  latex: string;
  /** Raw equation line from PDF text (before aggressive LaTeX wrapping). */
  formulaPlain?: string;
  whenToUse: string;
  /** @deprecated Prefer {@link sourceFile}. */
  source: string;
  mathStatus: MathStatus;
  sourceFile?: string;
  sourcePage?: number;
  sourceSection?: string;
  sourceLabel?: string;
  sourceExcerpt?: string;
  grounding?: SourceGrounding;
}

export type StudyPackProofImportance = "must_know" | "useful" | "optional";

export interface GeneratedProofItem {
  id: string;
  name: string;
  /** Short heading for cram sheets / lists. */
  proofName?: string;
  statement: string;
  /** Structured steps for revision (split from the Proof block). */
  proofSteps?: string[];
  proofSkeleton: string;
  commonMistake: string;
  importance?: StudyPackProofImportance;
  /** @deprecated Prefer {@link sourceFile}. */
  source?: string;
  sourceFile?: string;
  sourcePage?: number;
  sourceSection?: string;
  sourceLabel?: string;
  sourceExcerpt?: string;
  grounding?: SourceGrounding;
}

/** Worked derivation or long “show that” block (distinct from formal Proof environment). */
export interface GeneratedDerivationItem {
  id: string;
  title: string;
  summary: string;
  steps?: string[];
  sourceFile?: string;
  sourcePage?: number | null;
  sourceSection?: string | null;
  sourceExcerpt: string;
  groundingConfidence: number;
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
  /** Snapshot profiling for the active upload (local-first). */
  documentProfile?: DocumentProfile;
  /** Structural segmentation used for extraction QA. */
  sectionBlocks?: SectionBlock[];
  courseMap: GeneratedCourseTopic[];
  /** Chapter-level summaries for long notes (optional; complements {@link courseMap}). */
  courseMapChapters?: CourseMapChapterEntry[];
  definitions: GeneratedDefinitionItem[];
  formulas: GeneratedFormulaItem[];
  proofs: GeneratedProofItem[];
  /** Informal derivations / multi-step worked chains not labelled “Proof”. */
  derivations?: GeneratedDerivationItem[];
  methods: GeneratedMethodTemplate[];
  pastPaperPatterns: GeneratedPastPaperPattern[];
  commonMistakes: GeneratedCommonMistake[];
  cramSheet: GeneratedCramSheet;
  /** Parsed exercise blocks for quiz prioritisation (not shown as a separate tab). */
  examAnchoredExercises?: Array<{ formalLabel: string; body: string; highPriority?: boolean }>;
  /** Examples extracted with headings beyond “Example N.M”. */
  workedExamples?: DebugExtractedExampleExercise[];
  /** Normalised exercise/problem blocks. */
  extractedExercises?: DebugExtractedExampleExercise[];
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
