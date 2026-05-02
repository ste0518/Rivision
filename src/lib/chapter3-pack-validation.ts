import type { GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";

const BAD_FRAGMENTS = ["p?", "ϕˆ", "p˜?", "stdp?", "varp?", "δXi"];

const OFF_TOPIC = [
  "Simple Kriging",
  "Ordinary Kriging",
  "Markov chain",
  "irreducibility",
  "aperiodicity",
  "detailed balance",
];

export type Chapter3PackValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: {
    definitions: number;
    formulas: number;
    proofs: number;
    exampleLabels: string[];
    exerciseLabels: string[];
  };
};

function collectPackStrings(pack: GeneratedRevisionPack): string[] {
  const s: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === "string") s.push(x);
    else if (typeof x === "number") s.push(String(x));
  };
  push(pack.examOverview.summary);
  push(pack.examOverview.likelyExamStructure);
  for (const d of pack.definitions) {
    push(d.term);
    push(d.definition);
  }
  for (const f of pack.formulas) {
    push(f.name);
    push(f.latex);
    push(f.formulaPlain);
  }
  for (const p of pack.proofs) {
    push(p.name);
    push(p.statement);
    push(p.proofSkeleton);
    push(p.commonMistake);
    for (const step of p.proofSteps ?? []) push(step);
  }
  for (const m of pack.methods) {
    push(m.problemType);
    for (const z of m.steps) push(z);
  }
  return s;
}

function normaliseQuizKey(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9? ]/g, "")
    .trim()
    .slice(0, 140);
}

export type Chapter3DebugLists = {
  exampleFormalLabels: string[];
  exerciseFormalLabels: string[];
  exercise3_8?: { importance?: string; examTag?: string };
};

/**
 * Golden validation for chapter-3.pdf style Monte Carlo integration packs.
 * Pass {@link Chapter3DebugLists} when checking Example/Exercise segmentation from debug export.
 */
export function validateChapter3Pack(
  pack: GeneratedRevisionPack,
  quiz?: GeneratedPracticeQuestion[],
  debugLists?: Chapter3DebugLists,
): Chapter3PackValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const defs = pack.definitions.length;
  const forms = pack.formulas.length;
  const proofs = pack.proofs;

  if (defs < 10) errors.push(`definitions: expected >= 10, got ${defs}`);
  if (forms < 15) errors.push(`formulas: expected >= 15, got ${forms}`);

  const proofLabels = proofs.map((p) => p.sourceLabel ?? "").filter(Boolean);
  for (const lbl of ["Proposition 3.1", "Proposition 3.2", "Proposition 3.3", "Proposition 3.4", "Proposition 3.5", "Proposition 3.6"]) {
    if (!proofLabels.some((x) => x === lbl)) errors.push(`missing proof card for ${lbl}`);
  }

  const blob = collectPackStrings(pack).join("\n");
  for (const frag of BAD_FRAGMENTS) {
    if (blob.includes(frag)) errors.push(`bad fragment still present in study pack: ${JSON.stringify(frag)}`);
  }
  for (const topic of OFF_TOPIC) {
    if (blob.includes(topic)) errors.push(`unexpected off-topic phrase: ${topic}`);
  }
  if (/\bBIBLIOGRAPHY\b/i.test(blob)) errors.push("BIBLIOGRAPHY marker in generated pack strings");

  if (quiz?.length) {
    const seen = new Map<string, number>();
    for (const q of quiz) {
      const k = normaliseQuizKey(q.question ?? "");
      if (k.length < 12) continue;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, n]) => n > 1);
    if (dupes.length) errors.push(`duplicate quiz prompts: ${dupes.map(([k]) => k.slice(0, 72)).slice(0, 8).join("; ")}`);
  }

  let exampleLabels: string[] = [];
  let exerciseLabels: string[] = [];

  if (debugLists) {
    exampleLabels = debugLists.exampleFormalLabels;
    exerciseLabels = debugLists.exerciseFormalLabels;

    const expectedEx = Array.from({ length: 9 }, (_, i) => `Example 3.${i + 1}`);
    const expectedExe = Array.from({ length: 12 }, (_, i) => `Exercise 3.${i + 1}`);
    const exSet = new Set(exampleLabels);
    const exeSet = new Set(exerciseLabels);

    for (const x of expectedEx) {
      if (!exSet.has(x)) errors.push(`missing ${x}`);
    }
    for (const x of exampleLabels) {
      if (/Example\s+2\.|Example\s+4\./i.test(x)) errors.push(`reference-only / wrong-chapter example leaked: ${x}`);
    }
    for (const x of expectedExe) {
      if (!exeSet.has(x)) errors.push(`missing ${x}`);
    }

    const i38 = debugLists.exercise3_8;
    if (i38?.importance && i38.importance !== "must_know") {
      errors.push(`Exercise 3.8 importance expected must_know, got ${i38.importance}`);
    }
    if (i38?.examTag && !/final\s+exam|2024/i.test(i38.examTag)) {
      warnings.push("Exercise 3.8 examTag should mention Final Exam / 2024 when applicable");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      definitions: defs,
      formulas: forms,
      proofs: proofs.length,
      exampleLabels,
      exerciseLabels,
    },
  };
}
