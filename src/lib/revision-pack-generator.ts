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
  const blob = `${pack.examOverview.summary}\n${pack.definitions.map((d) => d.term).join("\n")}\n${pack.formulas.map((f) => `${f.name} ${f.latex}`).join("\n")}`.toLowerCase();
  const mcIs =
    /\bmonte\s*carlo\b|\bimportance\s+sampling\b|\bself[-\s]?normali|\bsnis\b|\bess\b|\bmc\s+estimator\b/i.test(blob) ||
    pack.formulas.some((f) => /monte|importance|snis|ess|hat\\s*phi|phi\^N/i.test(`${f.name} ${f.latex}`));
  if (mcIs && count >= 16) return generateMonteCarloBalancedQuiz(pack, count);
  return generateGenericQuickPracticeQuestions(pack, count);
}

function generateGenericQuickPracticeQuestions(pack: GeneratedRevisionPack, count: number): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const seen = new Map<string, number>();
  const topicFallback = pack.courseMap[0]?.title ?? "Course material";
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

/** Exam-weighted bank for Monte Carlo / importance sampling chapters (definition + formula + proof + calculation mix). */
function generateMonteCarloBalancedQuiz(pack: GeneratedRevisionPack, total: number): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const seen = new Map<string, number>();
  const topic = pack.courseMap[0]?.title ?? "Monte Carlo integration";
  const push = (
    question: string,
    expectedAnswer: string,
    sourceBasis: string,
    difficulty: GeneratedPracticeQuestion["difficulty"],
    hints: string[],
  ) => {
    const k = normaliseQuestionKey(question);
    if (k && seen.has(k)) return;
    if (k) seen.set(k, 1);
    out.push({ id: createId("pq"), question, expectedAnswer, topic, difficulty, sourceBasis, hints });
  };

  const defs = pack.definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term));
  for (let i = 0; i < 4 && i < defs.length; i += 1) {
    const d = defs[i]!;
    push(`State the definition of “${d.term}”.`, d.definition.slice(0, 900), d.sourceFile ?? "definitions", "easy", ["Exam recall"]);
  }

  const forms = pack.formulas;
  for (let i = 0; i < 4 && i < forms.length; i += 1) {
    const f = forms[i]!;
    push(
      `Derive or write ${f.name}, then say when you would use it on an exam.`,
      `${f.latex}\n\n${f.whenToUse}`.slice(0, 950),
      f.sourceFile ?? "formulas",
      "medium",
      ["Symbols", "Supports"],
    );
  }

  const prfs = pack.proofs;
  for (let i = 0; i < 4 && i < prfs.length; i += 1) {
    const p = prfs[i]!;
    const steps = p.proofSteps?.length ? p.proofSteps.join("\n") : p.proofSkeleton;
    push(
      `Prove or sketch the result behind ${p.name} — main steps only.`,
      `${steps.slice(0, 900)}\n\nWatch for: ${p.commonMistake}`.slice(0, 1100),
      p.sourceFile ?? "proofs",
      "hard",
      ["Structure proof", "State assumptions"],
    );
  }

  const calcSeed: Array<[string, string, GeneratedPracticeQuestion["difficulty"]]> = [
    [
      "Prove that the Monte Carlo estimator \\(\\hat\\phi^N_{\\mathrm{MC}}\\) is unbiased for \\(\\bar\\phi=\\mathbb{E}_{p^\\star}[\\phi(X)]\\) under i.i.d. samples from \\(p^\\star\\).",
      "Use linearity: E[(1/N)∑ϕ(X_i)] = (1/N)∑E[ϕ(X_i)] = E[ϕ(X)] = \\barϕ.",
      "hard",
    ],
    [
      "Derive \\(\\operatorname{Var}_{p^\\star}(\\hat\\phi^N_{\\mathrm{MC}})=\\operatorname{Var}_{p^\\star}(\\phi(X))/N\\) for i.i.d. samples.",
      "Var( (1/N)∑ϕ_i ) = (1/N²)∑Var(ϕ_i) = Var(ϕ(X))/N by independence.",
      "hard",
    ],
    [
      "State the importance sampling estimator and say whether the displayed average is under \\(q\\) or \\(p^\\star\\).",
      "\\(\\hat\\phi^N_{\\mathrm{IS}} = \\frac{1}{N}\\sum_i w_i \\phi(X_i)\\) with \\(X_i\\sim q\\); expectations in variance formulas are under \\(q\\).",
      "medium",
    ],
    [
      "Explain briefly why naive Monte Carlo for \\(P(X>4)\\) when \\(X\\sim\\mathcal{N}(0,1)\\) can be inefficient, and what importance sampling changes.",
      "Rare-event mass is tiny under nominal sampling → huge variance; IS recentres mass using a proposal that visits the tail.",
      "hard",
    ],
    [
      "State the support condition for unbiased importance sampling.",
      "Need \\(q(x)>0\\) whenever \\(p^\\star(x)>0\\) on the region contributing to the integral.",
      "medium",
    ],
    [
      "State a finite-variance condition for the importance sampling estimator (square-integrability form).",
      "Require \\(\\mathbb{E}_q[w(X)^2\\phi(X)^2]<\\infty\\) (equivalently finite second moment of weighted integrand).",
      "medium",
    ],
    [
      "Explain why the self-normalised importance sampling estimator is biased in finite samples.",
      "Ratio of dependent random sums — Jensen/ratio bias unless \\(N\\to\\infty\\).",
      "medium",
    ],
    [
      "Compute ESS under equal normalised weights and under one dominant weight (conceptually).",
      "Equal weights ⇒ ESS=N; one weight ≈1 ⇒ ESS≈1 — interpret as loss of effective i.i.d. sample size.",
      "hard",
    ],
  ];
  for (const [q, a, diff] of calcSeed) {
    if (out.length >= total) break;
    push(q, a, "exam-style calculations", diff, ["Show intermediate steps"]);
  }

  const anchored = pack.examAnchoredExercises ?? [];
  const ex38 = anchored.find((e) => /exercise\s+3\.8/i.test(e.formalLabel));
  if (ex38) {
    push(
      `Explain why ${ex38.formalLabel} is high priority for the final exam and what skill it tests.`,
      ex38.body.slice(0, 1400),
      ex38.formalLabel,
      "hard",
      ["Link to assessment objectives"],
    );
    push(
      `Mini-drill: reproduce one core calculation pattern from ${ex38.formalLabel} under timed conditions.`,
      "Award marks for correct setup, substitution, and interpretation.",
      ex38.formalLabel,
      "hard",
      ["15-minute cap"],
    );
  }

  let fill = 0;
  while (out.length < total && fill < total * 3) {
    const f = forms[fill % Math.max(1, forms.length)]!;
    push(`Numeric recall: restate ${f.name} from memory.`, f.latex, "formula drill", "medium", ["No notes"]);
    fill += 1;
  }

  return out.slice(0, total);
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
