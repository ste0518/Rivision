import { APP_VERSION } from "@/lib/app-version";
import { detectSourceContamination } from "@/lib/document-profile";
import type { GenericAcceptanceTests } from "@/lib/generic-study-pack-validation";
import { computeGenericAcceptanceTests, validateGenericStudyPack } from "@/lib/generic-study-pack-validation";
import { extractExampleAndExerciseItemsForDebug, type DebugExampleExerciseItem, type LecturePackFile } from "@/lib/local-study-pack-extraction";
import { cleanUploadedStudySourceText } from "@/lib/source-text-cleanup";
import type { StudyState } from "@/lib/storage";
import type { GeneratedPracticeQuestion } from "@/lib/student-revision-schema";
import type { GeneratedCramSheet, GeneratedRevisionPack } from "@/lib/student-revision-schema";
import type { StudyFile } from "@/lib/types";
import type { RevisionItem } from "@/lib/types";

/** Full debug export shape for external reviewers (local JSON, no server). */
export type RevisionPackDebugJson = {
  metadata: {
    sourceFilename: string;
    generatedAt: string;
    appVersion: string | null;
    modelUsed: string | null;
  };
  documentProfile: unknown | null;
  chapterMap: unknown[];
  sectionBlocks: unknown[];
  rawExtraction: {
    text: string | null;
    pages: Array<{ pageNumber: number; text: string }>;
  };
  cleanedExtraction: {
    text: string | null;
    warnings: string[];
  };
  studyPack: {
    title: string;
    chapter: string | null;
    overview: string;
    definitions: unknown[];
    formulas: unknown[];
    proofs: unknown[];
    derivations?: unknown[];
    courseMapChapters?: unknown[];
    examples: unknown[];
    exercises: unknown[];
    flashcards: unknown[];
    quizQuestions: unknown[];
    cramSheet: string | null;
  };
  qualityChecks: {
    badMathTokens: string[];
    missingSections: string[];
    possibleClassificationIssues: string[];
    warnings: string[];
    sourceContamination: string[];
    duplicateQuizPrompts: string[];
    overlongBlocks: string[];
    acceptanceTests?: GenericAcceptanceTests;
    criticalQualityFailure?: boolean;
    acceptanceWarningMessage?: string | null;
    recommendations?: string[];
    generatedItemStatsByChapter?: Record<string, { definitions: number; formulas: number; proofs: number }>;
    handwritingNoisePages?: unknown[];
    pipelineDiagnostics?: unknown;
    topActionableIssues?: string[];
  };
};

const SOFT_HYPHEN = "\u00ad";
const BOM_OR_PRIVATE = /[\uFEFF\uFFFE\uFFFD]/g;

const LITERAL_BAD_TOKENS: string[] = ["p?", "p˜?", "ϕˆ", "varp?", "δXi", "\uFFFE", "\u0001", "\u0002", "\u0003"];

function toLecturePackFiles(notesFiles: StudyFile[]): LecturePackFile[] {
  return notesFiles.map((f) => ({
    id: f.id,
    name: f.name,
    role: f.role,
    parsedText: f.content || f.parsedDocument?.fullText,
    pages: f.parsedDocument?.pages?.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
  }));
}

function primarySourceFilename(notesFiles: StudyFile[]): string {
  const lecture =
    notesFiles.find((f) => f.role === "lecture_notes") ?? notesFiles.find((f) => f.role === "formula_sheet") ?? notesFiles[0];
  return lecture?.name ?? "unknown";
}

function buildRawExtraction(notesFiles: StudyFile[]) {
  const lecture = notesFiles.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const parts = lecture.map((f) => f.parsedDocument?.fullText ?? f.content ?? "").filter((t) => t.trim());
  const text = parts.length ? parts.join("\n\n\n") : null;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  for (const f of lecture) {
    const pd = f.parsedDocument;
    if (pd?.pages?.length) {
      for (const p of pd.pages) {
        pages.push({ pageNumber: p.pageNumber, text: p.text });
      }
    }
  }
  return { text, pages };
}

function buildCleanedExtraction(
  rawText: string | null,
  notesFiles: StudyFile[],
  latexWarningLines: string[],
): { text: string | null; warnings: string[] } {
  const warnings: string[] = [...latexWarningLines];
  if (rawText?.includes(SOFT_HYPHEN)) {
    warnings.push("Raw text contains soft hyphens (U+00AD); they may break search or copy-paste in places.");
  }
  for (const f of notesFiles) {
    const w = f.parsedDocument?.diagnostics?.warnings ?? [];
    for (const x of w) {
      if (!warnings.includes(x)) warnings.push(x);
    }
  }
  const cleaned = rawText ? cleanUploadedStudySourceText(rawText) : null;
  return { text: cleaned, warnings };
}

function collectExtractionErrors(notesFiles: StudyFile[]): string[] {
  const out: string[] = [];
  for (const f of notesFiles) {
    for (const e of f.parsedDocument?.diagnostics?.errors ?? []) {
      out.push(`${f.name}: ${e}`);
    }
  }
  return out;
}

function collectLatexStatusWarnings(pack: GeneratedRevisionPack): string[] {
  const w: string[] = [];
  for (const d of pack.definitions) {
    if (d.mathStatus && d.mathStatus !== "ok") w.push(`Definition “${d.term}”: mathStatus=${d.mathStatus}`);
  }
  for (const f of pack.formulas) {
    if (f.mathStatus && f.mathStatus !== "ok") w.push(`Formula “${f.name}”: mathStatus=${f.mathStatus}`);
  }
  if (pack.examOverview.reviewCardsWarning) w.push(`Overview: ${pack.examOverview.reviewCardsWarning}`);
  return w;
}

function* iterPackStrings(
  pack: GeneratedRevisionPack,
  examples: DebugExampleExerciseItem[],
  exercises: DebugExampleExerciseItem[],
  quiz?: GeneratedPracticeQuestion[],
): Generator<string> {
  yield pack.examOverview.summary;
  yield pack.examOverview.likelyExamStructure;
  yield pack.examOverview.courseName ?? "";
  for (const t of pack.examOverview.highPriorityTopics) yield t;
  for (const d of pack.definitions) {
    yield d.term;
    yield d.definition;
    yield d.sourceExcerpt ?? "";
    yield d.formalLabel ?? "";
  }
  for (const f of pack.formulas) {
    yield f.name;
    yield f.latex;
    yield f.formulaPlain ?? "";
    yield f.whenToUse;
  }
  for (const p of pack.proofs) {
    yield p.name;
    yield p.statement;
    yield p.proofSkeleton;
    yield p.commonMistake;
    for (const s of p.proofSteps ?? []) yield s;
  }
  for (const d of pack.derivations ?? []) {
    yield d.title;
    yield d.summary;
    for (const s of d.steps ?? []) yield s;
  }
  for (const d of pack.proofsAndDerivations ?? []) {
    yield d.title;
    yield d.summary;
    for (const s of d.steps ?? []) yield s;
  }
  for (const m of pack.methods) {
    yield m.problemType;
    yield m.steps.join("\n");
  }
  for (const p of pack.pastPaperPatterns) {
    yield p.title;
    yield p.evidence;
  }
  for (const m of pack.commonMistakes) {
    yield m.mistake;
    yield m.whyItHappens;
  }
  yield pack.cramSheet.definitionBullets.join("\n");
  yield pack.cramSheet.formulaBullets.join("\n");
  yield pack.cramSheet.proofSkeletonBullets.join("\n");
  yield pack.cramSheet.trapBullets.join("\n");
  for (const x of examples) {
    yield x.title;
    yield x.body;
    yield x.rawBlock;
  }
  for (const x of exercises) {
    yield x.title;
    yield x.body;
    yield x.rawBlock;
    yield x.problem ?? "";
    yield x.examTag ?? "";
    if (x.subQuestions?.length) {
      for (const sq of x.subQuestions) {
        yield sq.label;
        yield sq.text;
      }
    }
  }
  for (const q of quiz ?? []) {
    yield q.question;
    yield q.expectedAnswer ?? "";
    yield q.topic ?? "";
  }
}

function generatedPackBlob(
  pack: GeneratedRevisionPack,
  examples: DebugExampleExerciseItem[],
  exercises: DebugExampleExerciseItem[],
  quiz?: GeneratedPracticeQuestion[],
): string {
  return Array.from(iterPackStrings(pack, examples, exercises, quiz)).join("\n");
}

function collectExtendedQuality(
  pack: GeneratedRevisionPack,
  practiceQuestions: GeneratedPracticeQuestion[] | undefined,
  sourceText: string,
  examples: DebugExampleExerciseItem[],
  exercises: DebugExampleExerciseItem[],
): { sourceContamination: string[]; duplicateQuizPrompts: string[]; overlongBlocks: string[] } {
  const src = sourceText.toLowerCase();
  const lowerGen = generatedPackBlob(pack, examples, exercises, practiceQuestions).toLowerCase();
  const sourceContamination = detectSourceContamination(lowerGen, src);
  if (/\bbibliography\b/i.test(lowerGen) && !/\bbibliography\b/i.test(src)) {
    sourceContamination.push("Possible bibliography leakage in generated study pack strings.");
  }
  for (const p of pack.proofs) {
    if (/irreducibility|aperiodicity/i.test(p.commonMistake) && !/\bmarkov\b|\bchain\b/i.test(src)) {
      sourceContamination.push(`Proof “${p.name.slice(0, 80)}” uses generic Markov-chain pitfall text — check chapter fit.`);
    }
  }

  const duplicateQuizPrompts: string[] = [];
  const counts = new Map<string, number>();
  for (const q of practiceQuestions ?? []) {
    const k = (q.question ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .slice(0, 160);
    if (k.length < 10) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of counts) {
    if (n > 1) duplicateQuizPrompts.push(`Quiz prompt repeated ${n} times: ${k.slice(0, 140)}`);
  }

  const wc = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
  const overlongBlocks: string[] = [];
  for (const d of pack.definitions) {
    if (wc(d.definition ?? "") > 1200) overlongBlocks.push(`Definition “${d.term}” exceeds 1200 words.`);
    if (/\bBIBLIOGRAPHY\b/i.test(d.definition ?? "")) overlongBlocks.push(`Definition “${d.term}” contains bibliography marker.`);
  }
  for (const p of pack.proofs) {
    if (wc(p.statement ?? "") > 1200 || wc(p.proofSkeleton ?? "") > 1200) {
      overlongBlocks.push(`Proof “${p.name.slice(0, 60)}” exceeds 1200 words in statement or skeleton.`);
    }
  }
  for (const ex of examples) {
    const blob = `${ex.body}\n${ex.rawBlock}`;
    if (wc(blob) > 1200) overlongBlocks.push(`Example ${ex.formalLabel} body/raw exceeds 1200 words.`);
  }

  return { sourceContamination, duplicateQuizPrompts, overlongBlocks };
}

function findBadMathTokens(
  pack: GeneratedRevisionPack,
  examples: DebugExampleExerciseItem[],
  exercises: DebugExampleExerciseItem[],
  quiz?: GeneratedPracticeQuestion[],
): string[] {
  const found = new Set<string>();
  const check = (s: string, label: string) => {
    if (!s) return;
    for (const tok of LITERAL_BAD_TOKENS) {
      if (s.includes(tok)) found.add(`${label}: contains problematic fragment ${JSON.stringify(tok)}`);
    }
    if (s.replace(BOM_OR_PRIVATE, "") !== s) {
      found.add(`${label}: contains BOM/private-use/placeholder Unicode`);
    }
    if (s.includes(SOFT_HYPHEN)) found.add(`${label}: contains soft hyphen (U+00AD)`);
    for (const m of s.matchAll(/\$[^$]{1,800}\$/g)) {
      const inner = m[0].slice(1, -1);
      if (/\s{2,}/.test(inner)) found.add(`${label}: repeated whitespace inside $...$`);
      if (/\^\s/.test(inner) || /_\s/.test(inner)) {
        found.add(`${label}: possible broken superscript/subscript (^ or _ followed by space) inside $...$`);
      }
    }
    for (const m of s.matchAll(/\\\(([^)]{1,800})\\\)/g)) {
      const inner = m[1] ?? "";
      if (/\s{2,}/.test(inner)) found.add(`${label}: repeated whitespace inside \\(...\\)`);
      if (/\^\s/.test(inner) || /_\s/.test(inner)) {
        found.add(`${label}: possible broken superscript/subscript (^ or _ followed by space) inside \\(...\\)`);
      }
    }
  };

  let i = 0;
  for (const str of iterPackStrings(pack, examples, exercises, quiz)) {
    i += 1;
    check(str, `generated#${i}`);
  }
  return [...found];
}

function criticalFailureFromAcceptance(at: GenericAcceptanceTests, manualFailures: string[]): boolean {
  if (
    !at.noBadMathTokensInStudyPack ||
    !at.noBibliographyLeakage ||
    !at.noSourceContamination ||
    !at.noDuplicateQuizQuestions ||
    !at.noOverlongBlocks
  ) {
    return true;
  }
  if (!at.hasDefinitionsForMainTopics || !at.hasFormulasFromFormulaDenseSections) return true;
  if (manualFailures.length) return true;
  return false;
}

function missingSectionWarnings(pack: GeneratedRevisionPack, examples: unknown[], exercises: unknown[]): string[] {
  const m: string[] = [];
  if (!pack.definitions.length) m.push("definitions");
  if (!pack.formulas.length) m.push("formulas");
  if (!pack.proofs.length) m.push("proofs");
  if (!examples.length) m.push("examples");
  if (!exercises.length) m.push("exercises");
  return m;
}

function titleLooksExample(title: string) {
  return /^\s*example\b/i.test(title.trim());
}

function titleLooksExercise(title: string) {
  return /^\s*exercise\b/i.test(title.trim());
}

function classificationIssues(examples: DebugExampleExerciseItem[], exercises: DebugExampleExerciseItem[]): string[] {
  const issues: string[] = [];
  for (const ex of exercises) {
    const title = `${ex.formalLabel} ${ex.title}`.trim();
    if (titleLooksExample(ex.title) || titleLooksExample(ex.formalLabel)) {
      issues.push(`Exercise block labelled as Example-like: ${title.slice(0, 120)}`);
    }
    const blob = `${ex.title}\n${ex.body}`;
    if (/\bfinal\s+exam\b/i.test(blob) || /\bpast\s+paper\b/i.test(blob) || /\b(202[0-6]|201[0-9])\b/.test(blob)) {
      issues.push(`High-priority exam reference in exercise ${ex.formalLabel}: ${title.slice(0, 100)}`);
    }
  }
  for (const ex of examples) {
    const title = `${ex.formalLabel} ${ex.title}`.trim();
    if (titleLooksExercise(ex.title) || titleLooksExercise(ex.formalLabel)) {
      issues.push(`Example block labelled as Exercise-like: ${title.slice(0, 120)}`);
    }
  }
  return issues;
}

function cramSheetToString(c: GeneratedCramSheet): string {
  const lines: string[] = [
    "### Definitions",
    ...c.definitionBullets.map((b) => `- ${b}`),
    "",
    "### Formulas",
    ...c.formulaBullets.map((b) => `- ${b}`),
    "",
    "### Proof skeletons",
    ...c.proofSkeletonBullets.map((b) => `- ${b}`),
    "",
    "### Traps",
    ...c.trapBullets.map((b) => `- ${b}`),
  ];
  return lines.join("\n");
}

function flashcardsFromRevisionItems(items: RevisionItem[]): unknown[] {
  return items
    .filter((i) => !i.isDeleted)
    .map((i) => ({
      id: i.id,
      type: i.type,
      title: i.displayTitle ?? i.title,
      cardFront: i.cardFront,
      questionPrompt: i.questionPrompt,
      statement: i.statement,
      answer: i.answer,
      sourceFile: i.sourceFile,
      pageNumber: i.pageNumber,
    }));
}

export type RevisionPackDebugInput = Pick<StudyState, "notesFiles" | "revisionItems"> & {
  studentRevisionPack: GeneratedRevisionPack;
  practiceQuestions?: GeneratedPracticeQuestion[];
};

export function buildRevisionPackDebugJson(store: RevisionPackDebugInput): RevisionPackDebugJson {
  const pack = store.studentRevisionPack;

  const notesFiles = store.notesFiles;
  const sourceFilename = primarySourceFilename(notesFiles);
  const lectureFiles = toLecturePackFiles(notesFiles);
  const { examples: exBlocks, exercises: exeBlocks } = extractExampleAndExerciseItemsForDebug(lectureFiles);

  const raw = buildRawExtraction(notesFiles);
  const latexLines = collectLatexStatusWarnings(pack);
  const cleaned = buildCleanedExtraction(raw.text, notesFiles, latexLines);
  const extractionErrors = collectExtractionErrors(notesFiles);

  const badMath = findBadMathTokens(pack, exBlocks, exeBlocks, store.practiceQuestions);
  const missing = missingSectionWarnings(pack, exBlocks, exeBlocks);
  const classification = classificationIssues(exBlocks, exeBlocks);
  const sourceUnion = (raw.text ? cleanUploadedStudySourceText(raw.text) : "") || lectureFiles.map((f) => f.parsedText ?? "").join("\n\n");
  const extended = collectExtendedQuality(pack, store.practiceQuestions, sourceUnion, exBlocks, exeBlocks);

  const genBlob = generatedPackBlob(pack, exBlocks, exeBlocks, store.practiceQuestions);
  const manualFailures: string[] = [];
  if (!pack.documentProfile) {
    manualFailures.push("Critical failure: document profile missing — regenerate the study pack after upload.");
  }
  const pc = pack.documentProfile?.pageCount ?? 1;
  if (pc > 55 && pack.formulas.length < 6 && sourceUnion.includes("=")) {
    manualFailures.push(`Critical failure: only ${pack.formulas.length} formulas extracted from a ${pc}-page document that appears equation-heavy.`);
  }

  const validation = validateGenericStudyPack(pack, pack.documentProfile ?? null, sourceUnion);
  const actionablePool = [...manualFailures, ...validation.topActionableFailures, ...validation.recommendations];
  const acceptanceTests: GenericAcceptanceTests = computeGenericAcceptanceTests({
    pack,
    documentProfile: pack.documentProfile ?? null,
    sourceTextLower: sourceUnion.toLowerCase(),
    badMathTokenCount: badMath.length,
    duplicateQuizPrompts: extended.duplicateQuizPrompts,
    overlongBlocks: extended.overlongBlocks,
    bibliographyInPack: /\bBIBLIOGRAPHY\b/i.test(genBlob.toLowerCase()),
    contaminationLines: extended.sourceContamination,
    quiz: store.practiceQuestions,
  });

  const criticalQualityFailure =
    validation.criticalQualityFailure || criticalFailureFromAcceptance(acceptanceTests, actionablePool);
  const acceptanceWarningMessage = criticalQualityFailure ? "Generated with critical quality failures — review issues below." : null;

  const qcWarnings: string[] = [...validation.recommendations];
  for (const e of extractionErrors) qcWarnings.push(`Extraction error: ${e}`);
  if (acceptanceWarningMessage) qcWarnings.push(acceptanceWarningMessage);
  for (const m of manualFailures) {
    if (!qcWarnings.includes(m)) qcWarnings.push(m);
  }

  const overview =
    `${pack.examOverview.summary}\n\nLikely exam structure:\n${pack.examOverview.likelyExamStructure}`.trim();

  const payload: RevisionPackDebugJson = {
    metadata: {
      sourceFilename,
      generatedAt: pack.generatedAt,
      appVersion: APP_VERSION ?? null,
      modelUsed: null,
    },
    documentProfile: pack.documentProfile ?? null,
    chapterMap: pack.documentProfile?.chapterMap ?? [],
    sectionBlocks: pack.sectionBlocks ?? [],
    rawExtraction: raw,
    cleanedExtraction: cleaned,
    studyPack: {
      title: pack.examOverview.courseName ?? "Study pack",
      chapter: pack.courseMap[0]?.title ?? null,
      overview,
      definitions: pack.definitions,
      formulas: pack.formulas,
      proofs: pack.proofs,
      derivations: pack.derivations ?? [],
      courseMapChapters: pack.courseMapChapters ?? [],
      examples: exBlocks,
      exercises: exeBlocks,
      flashcards: flashcardsFromRevisionItems(store.revisionItems),
      quizQuestions: store.practiceQuestions ?? [],
      cramSheet: cramSheetToString(pack.cramSheet),
    },
    qualityChecks: {
      badMathTokens: badMath,
      missingSections: missing,
      possibleClassificationIssues: classification,
      warnings: qcWarnings,
      sourceContamination: extended.sourceContamination,
      duplicateQuizPrompts: extended.duplicateQuizPrompts,
      overlongBlocks: extended.overlongBlocks,
      acceptanceTests,
      criticalQualityFailure,
      acceptanceWarningMessage,
      recommendations: actionablePool,
      generatedItemStatsByChapter: validation.generatedItemStatsByChapter,
      handwritingNoisePages: pack.documentProfile?.handwritingNoisePages ?? [],
      pipelineDiagnostics: pack.extractionPipelineDiagnostics ?? null,
      topActionableIssues: [
        ...new Set([
          ...(pack.extractionPipelineDiagnostics?.topActionableIssues ?? []),
          ...validation.topActionableFailures,
          ...manualFailures,
        ]),
      ].slice(0, 20),
    },
  };

  return payload;
}

export function revisionPackDebugFilenameBase(sourceFilename: string): string {
  const base = sourceFilename.replace(/\.[^.]+$/, "");
  const safe = base.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "pack";
  return safe.slice(0, 120);
}

export function downloadTextFile(content: string, mimeType: string, filename: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function totalQualityWarningCount(q: RevisionPackDebugJson["qualityChecks"]): number {
  return (
    q.badMathTokens.length +
    q.missingSections.length +
    q.possibleClassificationIssues.length +
    q.warnings.length +
    q.sourceContamination.length +
    q.duplicateQuizPrompts.length +
    q.overlongBlocks.length +
    (q.criticalQualityFailure ? 1 : 0)
  );
}

function mdDefinitionBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const d = raw as { term?: string; definition?: string; formalLabel?: string };
      const head = d.formalLabel ? `${d.formalLabel} — ${d.term ?? ""}` : d.term ?? "—";
      const body = (d.definition ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
      return `- **${head}**: ${body}${(d.definition ?? "").length > 600 ? "…" : ""}`;
    })
    .join("\n");
}

function mdFormulaBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const f = raw as { name?: string; latex?: string; whenToUse?: string };
      return `- **${f.name ?? "—"}** (${f.whenToUse ?? ""}): \`${(f.latex ?? "").replace(/`/g, "'").slice(0, 400)}\``;
    })
    .join("\n");
}

function mdProofBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const p = raw as { name?: string; statement?: string };
      const st = (p.statement ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      return `- **${p.name ?? "—"}**: ${st}${(p.statement ?? "").length > 400 ? "…" : ""}`;
    })
    .join("\n");
}

function mdExampleExerciseBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const x = raw as DebugExampleExerciseItem;
      const body = x.body.replace(/\s+/g, " ").trim().slice(0, 500);
      return `- **${x.formalLabel}** (${x.sourceFile}${x.sourcePage != null ? `, p.${x.sourcePage}` : ""}): ${body}${x.body.length > 500 ? "…" : ""}`;
    })
    .join("\n");
}

function mdFlashBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const c = raw as { title?: string; cardFront?: string; statement?: string };
      const line = (c.cardFront ?? c.statement ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      return `- **${c.title ?? "—"}**: ${line}`;
    })
    .join("\n");
}

function mdQuizBullets(items: unknown[]): string {
  if (!Array.isArray(items) || !items.length) return "_None._";
  return items
    .map((raw) => {
      const q = raw as { question?: string; topic?: string; difficulty?: string };
      return `- **${q.topic ?? "—"}** (${q.difficulty ?? ""}): ${(q.question ?? "").replace(/\s+/g, " ").trim().slice(0, 400)}`;
    })
    .join("\n");
}

export function buildRevisionPackSummaryMarkdown(data: RevisionPackDebugJson): string {
  const sp = data.studyPack;
  const qc = data.qualityChecks;
  const lines: string[] = [
    `# ${sp.title}`,
    "",
    "_Exported from Rivision (local). Full JSON export contains machine-readable structure._",
    "",
    "## Overview",
    sp.overview,
    "",
    "## Definitions",
    mdDefinitionBullets(sp.definitions),
    "",
    "## Formulas",
    mdFormulaBullets(sp.formulas),
    "",
    "## Proofs",
    mdProofBullets(sp.proofs),
    "",
    "## Worked examples",
    mdExampleExerciseBullets(sp.examples),
    "",
    "## Exercises",
    mdExampleExerciseBullets(sp.exercises),
    "",
    "## Flashcards",
    mdFlashBullets(sp.flashcards),
    "",
    "## Quiz questions",
    mdQuizBullets(sp.quizQuestions),
    "",
    "## Cram sheet",
    sp.cramSheet ?? "_None._",
    "",
    "## Quality warnings",
    "### Bad math tokens",
    qc.badMathTokens.length ? qc.badMathTokens.map((x) => `- ${x}`).join("\n") : "_None._",
    "",
    "### Missing sections",
    qc.missingSections.length ? qc.missingSections.map((x) => `- Section empty or missing: **${x}**`).join("\n") : "_None._",
    "",
    "### Classification",
    qc.possibleClassificationIssues.length ? qc.possibleClassificationIssues.map((x) => `- ${x}`).join("\n") : "_None._",
    "",
    "### Other warnings",
    qc.warnings.length ? qc.warnings.map((x) => `- ${x}`).join("\n") : "_None._",
  ];
  return lines.join("\n");
}
