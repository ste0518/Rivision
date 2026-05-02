import { inferStudyFileRole } from "@/lib/course-files";
import { buildHeuristicStudentRevisionPack } from "@/lib/local-study-pack-extraction";
import type { GeneratedDefinitionItem, GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";
import type { StudyFile, StudyFileRole } from "@/lib/types";
import { createId } from "@/lib/utils";

export type RevisionPackGeneratorSettings = {
  revisionStyle: "concise_exam" | "detailed_guide" | "flashcard_heavy" | "problem_heavy";
  aiStrictness: "conservative" | "balanced" | "broad";
};

export type PackSourceFile = {
  id: string;
  name: string;
  role: StudyFileRole;
  parsedText?: string;
};

const KEYWORDS = /\b(definition|theorem|proof|show that|derive|formula|proposition|lemma|example|question|problem)\b/gi;

function hashFingerprint(files: PackSourceFile[]) {
  return files.map((f) => `${f.role}:${f.name}`).sort().join("|");
}

function combinedText(files: PackSourceFile[]) {
  return files.map((f) => f.parsedText ?? "").join("\n\n");
}

/** Builds the structured student Study Pack using local heuristics (labelled blocks, sections, formulas). */
export function generateStudentRevisionPack(input: {
  files: PackSourceFile[];
  settings: RevisionPackGeneratorSettings;
}): GeneratedRevisionPack {
  const { files, settings } = input;
  const lectureParts = files.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const combinedLectureText =
    lectureParts.map((f) => f.parsedText ?? "").join("\n\n").trim() || combinedText(files);
  const hasPastEvidence = files.some((f) =>
    ["past_paper", "problem_sheet", "solution_sheet", "mark_scheme"].includes(f.role ?? ""),
  );

  const pack = buildHeuristicStudentRevisionPack({
    files,
    settings,
    combinedLectureText,
    hasPastEvidence,
  });

  const text = combinedText(files);
  const keywordHits = text.match(KEYWORDS);
  const keywordSummary = keywordHits
    ? `${new Set(keywordHits.map((k) => k.toLowerCase())).size} conceptual markers detected across uploads.`
    : "";

  return {
    ...pack,
    examOverview: {
      ...pack.examOverview,
      summary: [pack.examOverview.summary, keywordSummary].filter(Boolean).join(" "),
    },
  };
}

export function fileToPackSource(file: StudyFile): PackSourceFile {
  return {
    id: file.id,
    name: file.name,
    role: file.role ?? inferStudyFileRole(file.name),
    parsedText: file.content || file.parsedDocument?.fullText,
  };
}

export function buildFingerprint(files: PackSourceFile[]) {
  return hashFingerprint(files);
}

const EMPTY_DEF_FALLBACK: GeneratedDefinitionItem = {
  id: "placeholder-def",
  term: "your notes",
  definition: "Regenerate after uploading readable lecture text.",
  source: "study pack",
  importance: "medium",
};

export function generateQuickPracticeQuestions(pack: GeneratedRevisionPack, count = 5): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const defs = pack.definitions;
  const topics = pack.courseMap;
  const nTop = Math.max(1, topics.length);
  for (let i = 0; i < count; i += 1) {
    const d = defs.length ? defs[i % defs.length]! : EMPTY_DEF_FALLBACK;
    const t = topics[i % nTop];
    const basis = d.sourceFile ?? d.source;
    out.push({
      id: createId("pq"),
      question: `Recall precisely: what is ${d.term}?`,
      expectedAnswer: d.definition.slice(0, 600),
      topic: t?.title ?? "General",
      difficulty: i % 3 === 0 ? "easy" : "medium",
      sourceBasis: basis ?? "study pack",
      hints: ["State definition in one sentence", "Add one exam-style consequence"],
    });
  }
  return out;
}

export function generateExamStyleQuestions(pack: GeneratedRevisionPack, count = 4): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const patterns = pack.pastPaperPatterns;
  const nPat = Math.max(1, patterns.length);
  const nHi = Math.max(1, pack.examOverview.highPriorityTopics.length);
  for (let i = 0; i < count; i += 1) {
    const p = patterns[i % nPat]!;
    out.push({
      id: createId("pq"),
      question: `Exam-style (${p.title}): ${p.suggestedPracticeQuestion}`,
      expectedAnswer: "Award marks for: correct setup, main derivation/logic, interpretation, and assumptions stated.",
      topic: pack.examOverview.highPriorityTopics[i % nHi] ?? "Course",
      difficulty: "hard",
      sourceBasis: p.evidence,
      hints: ["Time-box to 15 minutes", "Write intermediate steps even if rough"],
    });
  }
  return out;
}

export function generateWeakTopicDrill(pack: GeneratedRevisionPack, count = 4): GeneratedPracticeQuestion[] {
  const weak = pack.courseMap.filter((t) => t.importance !== "high").slice(0, 6);
  const fallbackTitles = pack.examOverview.highPriorityTopics;
  const titles = weak.length ? weak.map((t) => t.title) : fallbackTitles;
  const nTit = Math.max(1, titles.length);
  const out: GeneratedPracticeQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const title = titles[i % nTit] ?? "Review topic";
    out.push({
      id: createId("pq"),
      question: `Drill: explain ${title} as if teaching a friend — include one pitfall.`,
      expectedAnswer: "Clear definition, one example, one common mistake avoided.",
      topic: title,
      difficulty: "medium",
      sourceBasis: "Derived from course map emphasis",
      hints: ["Speak aloud first", "Then write bullets"],
    });
  }
  return out;
}
