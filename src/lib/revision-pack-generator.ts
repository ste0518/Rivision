import { inferStudyFileRole } from "@/lib/course-files";
import {
  buildHeuristicStudentRevisionPack,
  CORE_IDEA_PLACEHOLDER,
  extractExampleAndExerciseItemsForDebug,
} from "@/lib/local-study-pack-extraction";
import { cardFromDefinition, cardFromFormula, cardFromMethod, cardFromProof } from "@/lib/pack-to-card";
import type { GeneratedDefinitionItem, GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";
import type { RevisionItem } from "@/lib/types";
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
  pages?: Array<{ pageNumber: number; text: string }>;
};

const KEYWORDS = /\b(definition|theorem|proof|show that|derive|formula|proposition|lemma|example|question|problem)\b/gi;

function hashFingerprint(files: PackSourceFile[]) {
  return files.map((f) => `${f.role}:${f.name}`).sort().join("|");
}

function combinedText(files: PackSourceFile[]) {
  return files.map((f) => f.parsedText ?? "").join("\n\n");
}

/** Builds the structured student Study Pack using local heuristics (labelled blocks, sections, formulas). */
/** One active-recall card per study-pack item (definitions, formulas, proofs, methods) when the pack is non-empty. */
export function buildRevisionItemsFromStudentPack(pack: GeneratedRevisionPack): RevisionItem[] {
  const out: RevisionItem[] = [];
  for (const d of pack.definitions) {
    if (CORE_IDEA_PLACEHOLDER.test(d.term)) continue;
    out.push(cardFromDefinition(d));
  }
  for (const f of pack.formulas) out.push(cardFromFormula(f));
  for (const p of pack.proofs) out.push(cardFromProof(p));
  for (const m of pack.methods) out.push(cardFromMethod(m));
  return out;
}

export function countTypedPackItems(pack: GeneratedRevisionPack): number {
  return (
    pack.definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term)).length +
    pack.formulas.length +
    pack.proofs.length +
    pack.methods.length
  );
}

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

  const { exercises: parsedExercises } = extractExampleAndExerciseItemsForDebug(
    files.map((f) => ({ id: f.id, name: f.name, role: f.role, parsedText: f.parsedText })),
  );

  const text = combinedText(files);
  const keywordHits = text.match(KEYWORDS);
  const keywordSummary = keywordHits
    ? `${new Set(keywordHits.map((k) => k.toLowerCase())).size} conceptual markers detected across uploads.`
    : "";

  return {
    ...pack,
    examAnchoredExercises: parsedExercises.map((e) => ({
      formalLabel: e.formalLabel,
      body: e.body,
      highPriority: e.highPriority,
    })),
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
    pages: file.parsedDocument?.pages?.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
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

function normaliseQuestionKey(q: string) {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9? ]/g, "")
    .trim()
    .slice(0, 120);
}

export function generateQuickPracticeQuestions(pack: GeneratedRevisionPack, count = 18): GeneratedPracticeQuestion[] {
  return generateGenericQuickPracticeQuestions(pack, count);
}

function generateGenericQuickPracticeQuestions(pack: GeneratedRevisionPack, count: number): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const seen = new Map<string, number>();
  const topicFallback =
    pack.courseMapChapters?.[0]?.title ?? pack.courseMap[0]?.title ?? pack.examOverview.courseName ?? "Course material";
  const pushQ = (question: string, expectedAnswer: string, topic: string, sourceBasis: string, difficulty: GeneratedPracticeQuestion["difficulty"], hints: string[]) => {
    const k = normaliseQuestionKey(question);
    if (k && (seen.get(k) ?? 0) >= 1) return;
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
    out.push({ id: createId("pq"), question, expectedAnswer, topic, difficulty, sourceBasis, hints });
  };

  for (const d of pack.definitions) {
    if (out.length >= count) break;
    pushQ(
      `State the definition of “${d.term}” in exam form (one short paragraph).`,
      d.definition.slice(0, 800),
      topicFallback,
      d.sourceFile ?? d.source ?? "definitions",
      "easy",
      ["Be precise", "Include conditions if any"],
    );
  }

  for (const f of pack.formulas) {
    if (out.length >= count) break;
    pushQ(
      `Write ${f.name} and identify each symbol; when does it apply?`,
      `${f.latex}\n\n${f.whenToUse}`.slice(0, 900),
      topicFallback,
      f.sourceFile ?? "formulas",
      "medium",
      ["Units / supports", "Regularity conditions"],
    );
  }

  for (const p of pack.proofs) {
    if (out.length >= count) break;
    pushQ(
      `Give the proof outline for ${p.proofName ?? p.name} — main identities only.`,
      `${p.proofSkeleton.slice(0, 700)}\n\nCommon pitfall: ${p.commonMistake}`.slice(0, 1000),
      topicFallback,
      p.sourceFile ?? "proofs",
      "hard",
      ["Assumptions first", "Then the key expectation/variance step"],
    );
  }

  for (const d of pack.derivations ?? []) {
    if (out.length >= count) break;
    pushQ(
      `Walk through the worked derivation: ${d.title.slice(0, 120)} — main steps only.`,
      `${d.summary}\n${(d.steps ?? []).slice(0, 6).join("\n")}`.slice(0, 1000),
      topicFallback,
      d.sourceFile ?? "derivations",
      "hard",
      ["Follow the algebra chain", "State conditions when assumptions appear"],
    );
  }

  let i = 0;
  while (out.length < count && i < count * 4) {
    const d = pack.definitions[i % Math.max(1, pack.definitions.length)] ?? EMPTY_DEF_FALLBACK;
    pushQ(
      `Recall exam bullet: “${d.term}”.`,
      d.definition.slice(0, 600),
      topicFallback,
      d.sourceFile ?? "study pack",
      i % 2 === 0 ? "easy" : "medium",
      ["Timed recall"],
    );
    i += 1;
  }

  return out.slice(0, count);
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
