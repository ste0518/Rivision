import { inferStudyFileRole } from "@/lib/course-files";
import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import type {
  ExamOverviewSection,
  GeneratedCommonMistake,
  GeneratedCourseTopic,
  GeneratedCramSheet,
  GeneratedDefinitionItem,
  GeneratedFormulaItem,
  GeneratedMethodTemplate,
  GeneratedPastPaperPattern,
  GeneratedProofItem,
  GeneratedRevisionPack,
  GeneratedPracticeQuestion,
  TopicImportance,
} from "@/lib/student-revision-schema";
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

function inferCourseName(files: PackSourceFile[]): string | undefined {
  const names = files.map((f) => f.name.replace(/\.[^.]+$/, ""));
  const lecture = files.find((f) => f.role === "lecture_notes");
  if (lecture) {
    const base = lecture.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
    const cleaned = base.replace(/\b(lecture|notes|chapter|week|lec)\s*\d*\b/gi, "").trim();
    if (cleaned.length > 2) return cleaned.slice(0, 80);
  }
  if (names.length) return names[0].slice(0, 80);
  return undefined;
}

function combinedText(files: PackSourceFile[]) {
  return files.map((f) => f.parsedText ?? "").join("\n\n");
}

function snippetAroundKeyword(text: string, keyword: string, radius = 180): string | undefined {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx < 0) return undefined;
  const start = Math.max(0, idx - 40);
  const slice = text.slice(start, idx + radius).replace(/\s+/g, " ").trim();
  return slice.length > 320 ? `${slice.slice(0, 317)}…` : slice;
}

function extractDefinitionLikeLines(text: string, max = 12): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^(definition|theorem|lemma|proposition|remark)\b/i.test(line) && line.length < 400) out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

function guessTopicsFromFiles(files: PackSourceFile[]): GeneratedCourseTopic[] {
  const byStem = new Map<string, { files: PackSourceFile[]; roles: Set<StudyFileRole> }>();
  for (const file of files) {
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60);
    const cur = byStem.get(stem) ?? { files: [], roles: new Set() };
    cur.files.push(file);
    cur.roles.add(file.role);
    byStem.set(stem, cur);
  }
  const topics: GeneratedCourseTopic[] = [];
  for (const [title, { files: group, roles }] of byStem) {
    if (group.length === 0) continue;
    const names = group.map((f) => f.name);
    const lectureHit = roles.has("lecture_notes");
    const assessHit = ["past_paper", "problem_sheet", "solution_sheet", "mark_scheme", "exam_guidance"].some((r) => roles.has(r as StudyFileRole));
    let importance: TopicImportance = "medium";
    let evidenceReason = "Inferred from uploaded filenames.";
    if (lectureHit && assessHit) {
      importance = "high";
      evidenceReason = "Appears in lecture notes and assessment-related filenames.";
    } else if (lectureHit) {
      importance = "high";
      evidenceReason = "Covered in lecture notes filenames.";
    } else if (assessHit) {
      importance = "medium";
      evidenceReason = "Referenced in assessment-style filenames.";
    } else {
      importance = "low";
    }
    topics.push({
      id: createId("topic"),
      title: title || "Topic",
      sourceFileNames: names,
      importance,
      evidenceReason,
    });
  }
  return topics.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.importance] - order[b.importance];
  });
}

function buildMethodsFromText(text: string): GeneratedMethodTemplate[] {
  const methods: GeneratedMethodTemplate[] = [];
  const lower = text.toLowerCase();
  if (/\b(test|hypothesis|significance)\b/.test(lower)) {
    methods.push({
      id: createId("meth"),
      problemType: "Hypothesis testing setup",
      steps: ["State null and alternative hypotheses.", "Choose significance level and test statistic.", "Compute statistic and p-value / critical region.", "Compare to threshold and interpret in context."],
      triggerWords: ["test", "significant", "p-value", "reject H0"],
      relatedPracticeType: "Exam-style short answer",
    });
  }
  if (/\b(proof|show that|derive)\b/.test(lower)) {
    methods.push({
      id: createId("meth"),
      problemType: "Structured proof",
      steps: ["State what you are proving.", "Expand definitions and assumptions.", "Apply known lemmas or algebraic steps.", "Conclude clearly."],
      triggerWords: ["show that", "prove", "hence"],
      relatedPracticeType: "Proof recall",
    });
  }
  if (methods.length === 0) {
    methods.push({
      id: createId("meth"),
      problemType: "General problem-solving",
      steps: ["Identify the quantity or concept asked for.", "Recall the relevant definition or formula.", "Execute steps carefully and check units or boundary cases.", "Summarise the result."],
      triggerWords: ["find", "calculate", "determine"],
      relatedPracticeType: "Mixed exam question",
    });
  }
  return methods.slice(0, 6);
}

export function generateStudentRevisionPack(input: {
  files: PackSourceFile[];
  settings: RevisionPackGeneratorSettings;
}): GeneratedRevisionPack {
  const { files, settings } = input;
  const text = combinedText(files);
  const topics = guessTopicsFromFiles(files.length ? files : [{ id: "placeholder", name: "course_material.pdf", role: "other" }]);
  const courseName = inferCourseName(files);
  const keywordHits = text.match(KEYWORDS);
  const keywordSummary = keywordHits ? `${new Set(keywordHits.map((k) => k.toLowerCase())).size} conceptual markers detected in notes.` : "Upload more readable text to enrich keyword signals.";

  const definitionLines = extractDefinitionLikeLines(text);
  const definitions: GeneratedDefinitionItem[] = definitionLines.map((line, i) => ({
    id: createId("def"),
    term: line.split(/[.:]/)[0]?.trim().slice(0, 120) || `Key concept ${i + 1}`,
    definition: line.slice(0, 800),
    source: files[0]?.name ?? "your materials",
    importance: i < 3 ? "must_know" : "high",
  }));

  if (definitions.length < 4) {
    for (let i = definitions.length; i < 6; i += 1) {
      definitions.push({
        id: createId("def"),
        term: `Core idea ${i + 1}`,
        definition:
          text.trim().length > 80
            ? `Review the surrounding discussion in your notes about "${topics[i % Math.max(1, topics.length)]?.title ?? "this topic"}". ${snippetAroundKeyword(text, "definition") ?? "Relate the definition to how it is used in past papers."}`
            : "Add more lecture text so Rivision can anchor definitions to your course wording.",
        source: files[i % Math.max(1, files.length)]?.name ?? "your materials",
        importance: "medium",
      });
    }
  }

  const formulaPatterns = text.match(/\$[^$\n]{1,120}\$/g) ?? [];
  const formulas: GeneratedFormulaItem[] = [];
  const nFormulas = settings.revisionStyle === "flashcard_heavy" ? 8 : 6;
  const samples = formulaPatterns.slice(0, nFormulas);
  for (let i = 0; i < nFormulas; i += 1) {
    const latex = samples[i] ?? `\\( f(x) \\approx \\text{model}_{${i + 1}}(x) \\)`;
    const v = validateLatexSnippet(latex);
    formulas.push({
      id: createId("form"),
      name: samples[i] ? `Formula ${i + 1}` : `Key relationship ${i + 1}`,
      latex,
      whenToUse: "Use when the question asks for the relationship stated in your notes or past papers.",
      source: files[i % Math.max(1, files.length)]?.name ?? "your materials",
      mathStatus: mathStatusFromValidation(v),
    });
  }

  const proofs: GeneratedProofItem[] = [];
  if (/\bproof\b/i.test(text)) {
    proofs.push({
      id: createId("prf"),
      name: "Proof technique from notes",
      statement: snippetAroundKeyword(text, "proof") ?? "Key result stated in your uploaded materials.",
      proofSkeleton: "State assumptions → apply definitions → use intermediate lemmas → conclude.",
      commonMistake: "Skipping explicit justification for a non-obvious step.",
      source: files.find((f) => f.role === "lecture_notes")?.name,
    });
  }
  for (let i = proofs.length; i < 3; i += 1) {
    proofs.push({
      id: createId("prf"),
      name: `Proof template ${i + 1}`,
      statement: "Standard result you should be able to reproduce under exam pressure.",
      proofSkeleton: "Outline definitions → main logical chain → final sentence tying back to the claim.",
      commonMistake: "Ambiguous variables or missing domain conditions.",
    });
  }

  const methods = buildMethodsFromText(text);

  const hasPast = files.some((f) => f.role === "past_paper");
  const hasProblems = files.some((f) => f.role === "problem_sheet");
  const patterns: GeneratedPastPaperPattern[] = [
    {
      id: createId("pat"),
      title: hasPast ? "Repeated exam emphasis" : "Likely exam emphasis (from filenames)",
      evidence: hasPast ? "Past paper files included." : "Include past papers to sharpen pattern detection.",
      likelyExamStyle: settings.revisionStyle === "problem_heavy" ? "Multi-part calculation with interpretation" : "Short recall plus one applied part",
      suggestedPracticeQuestion: "Past paper style: state definition → apply to a small numerical setup → comment on assumptions.",
    },
    {
      id: createId("pat"),
      title: hasProblems ? "Problem sheet pacing" : "Problem practice",
      evidence: hasProblems ? "Problem sheets detected." : "Upload problem sheets to mirror weekly rhythm.",
      likelyExamStyle: "Sequential hints leading to a standard result",
      suggestedPracticeQuestion: "Redo a weekly sheet question under timed conditions, then compare to solutions.",
    },
  ];

  const mistakes: GeneratedCommonMistake[] = [
    {
      id: createId("mis"),
      mistake: "Mixing notation across chapters",
      whyItHappens: "Different source files use slightly different symbols.",
      howToAvoid: "Maintain a one-page notation map during revision.",
    },
    {
      id: createId("mis"),
      mistake: "Skipping edge cases in hypotheses",
      whyItHappens: "Exam questions often probe boundary conditions.",
      howToAvoid: "After each method template, ask “when does this fail?”",
    },
  ];

  const cram: GeneratedCramSheet = {
    definitionBullets: definitions.slice(0, 6).map((d) => `${d.term}: ${d.definition.slice(0, 120)}${d.definition.length > 120 ? "…" : ""}`),
    formulaBullets: formulas.slice(0, 6).map((f) => `${f.name}: ${f.latex}`),
    proofSkeletonBullets: proofs.map((p) => `${p.name}: ${p.proofSkeleton}`),
    trapBullets: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const priorityTopics = topics.filter((t) => t.importance === "high").map((t) => t.title).slice(0, 8);
  const overview: ExamOverviewSection = {
    courseName,
    summary: `Revision snapshot built from ${files.length} file(s). ${keywordSummary} Style: ${settings.revisionStyle.replace(/_/g, " ")}; breadth: ${settings.aiStrictness}.`,
    likelyExamStructure: hasPast
      ? "Expect a mix of short recall and longer applied questions reflecting your past papers."
      : "Likely short-book structure: definitions, methods, and one multi-step application — upload past papers to tighten this estimate.",
    highPriorityTopics: priorityTopics.length ? priorityTopics : topics.slice(0, 5).map((t) => t.title),
  };

  return {
    generatedAt: new Date().toISOString(),
    examOverview: overview,
    courseMap: topics,
    definitions,
    formulas,
    proofs,
    methods,
    pastPaperPatterns: patterns,
    commonMistakes: mistakes,
    cramSheet: cram,
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

export function generateQuickPracticeQuestions(pack: GeneratedRevisionPack, count = 5): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const defs = pack.definitions;
  const topics = pack.courseMap;
  for (let i = 0; i < count; i += 1) {
    const d = defs[i % defs.length];
    const t = topics[i % Math.max(1, topics.length)];
    out.push({
      id: createId("pq"),
      question: `Recall precisely: what is ${d.term}?`,
      expectedAnswer: d.definition.slice(0, 600),
      topic: t?.title ?? "General",
      difficulty: i % 3 === 0 ? "easy" : "medium",
      sourceBasis: d.source,
      hints: ["State definition in one sentence", "Add one exam-style consequence"],
    });
  }
  return out;
}

export function generateExamStyleQuestions(pack: GeneratedRevisionPack, count = 4): GeneratedPracticeQuestion[] {
  const out: GeneratedPracticeQuestion[] = [];
  const patterns = pack.pastPaperPatterns;
  for (let i = 0; i < count; i += 1) {
    const p = patterns[i % patterns.length];
    out.push({
      id: createId("pq"),
      question: `Exam-style (${p.title}): ${p.suggestedPracticeQuestion}`,
      expectedAnswer: "Award marks for: correct setup, main derivation/logic, interpretation, and assumptions stated.",
      topic: pack.examOverview.highPriorityTopics[i % Math.max(1, pack.examOverview.highPriorityTopics.length)] ?? "Course",
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
  const out: GeneratedPracticeQuestion[] = [];
  for (let i = 0; i < count; i += 1) {
    const title = titles[i % Math.max(1, titles.length)] ?? "Review topic";
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
