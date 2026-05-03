/**
 * Bundled smoke tests for local Study Pack extraction (no uploads).
 */

import { generateStudentRevisionPack } from "@/lib/revision-pack-generator";
import { validateGenericStudyPack } from "@/lib/generic-study-pack-validation";
import { cleanUploadedStudySourceText } from "@/lib/source-text-cleanup";
import { chapter3MonteCarloExcerpt } from "@/lib/test-fixtures/chapter-3-monte-carlo-excerpt";
import { timeSeriesFixtureDocument } from "@/lib/test-fixtures/time-series-notes-excerpt";
import type { StudyFileRole } from "@/lib/types";

const GEOMETRY_NOTES = `[Page 1]
Differential Geometry — Course Notes

Definition 1.1 A regular curve is a smooth map $\\gamma: I \\to \\mathbb{R}^3$ with $\\gamma'(t) \\neq 0$.

Theorem 2.1 In arc-length parametrisation, curvature satisfies $\\kappa(t) = |\\gamma''(t)|$.

Proof. Differentiate the unit tangent vector with respect to arc length.

Exercise 1. Show that the curvature of a circle of radius $R$ is $1/R$.
`;

const PAST_PAPER_STYLE = `[Page 1]
Geometry Module — Past Paper

Question 1. (10 marks) Define geodesic curvature and give one example.

Question 2. (15 marks) Derive the Frenet–Serret formulas for a curve in $\\mathbb{R}^3$.
`;

const PROBLEM_SHEET_STYLE = `[Page 1]
Problem Sheet 4 — Curves

Problem 1. Let $\\gamma(t)=(\\cos t,\\sin t,0)$. Compute $\\kappa(t)$.

Problem 2. Show that arc length is invariant under reparametrisation; hence conclude speed $|\\gamma'(t)|$ enters the integral.
`;

export type SmokeCase = {
  id: string;
  label: string;
  role: StudyFileRole;
  text: string;
};

export const SMOKE_CASES: SmokeCase[] = [
  { id: "geometry_notes", label: "Geometry-style notes", role: "lecture_notes", text: GEOMETRY_NOTES },
  { id: "time_series", label: "Time series notes", role: "lecture_notes", text: timeSeriesFixtureDocument.fullText },
  { id: "monte_carlo", label: "Monte Carlo notes", role: "lecture_notes", text: chapter3MonteCarloExcerpt },
  { id: "past_paper", label: "Past paper style", role: "past_paper", text: PAST_PAPER_STYLE },
  { id: "problem_sheet", label: "Problem sheet style", role: "problem_sheet", text: PROBLEM_SHEET_STYLE },
];

export type SmokeTestRun = {
  case: SmokeCase;
  nonEmpty: boolean;
  staleSpatialLeak: boolean;
  counts: { definitions: number; formulas: number; proofs: number; sectionBlocks: number };
  validationOk: boolean;
  criticalFailure: boolean;
};

export function runSmokeTest(caseId: string): SmokeTestRun {
  const c = SMOKE_CASES.find((x) => x.id === caseId);
  if (!c) throw new Error(`Unknown smoke case: ${caseId}`);
  const pack = generateStudentRevisionPack({
    files: [{ id: "fixture", name: "fixture.txt", role: c.role, parsedText: c.text }],
    settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
  });
  const source = cleanUploadedStudySourceText(c.text);
  const validation = validateGenericStudyPack(pack, pack.documentProfile ?? null, source);
  const blob = [
    ...pack.definitions.map((d) => `${d.term} ${d.definition}`),
    ...pack.formulas.map((f) => `${f.name} ${f.latex}`),
    ...pack.proofs.map((p) => `${p.name} ${p.statement}`),
  ]
    .join(" ")
    .toLowerCase();
  const staleSpatialLeak =
    /\b(semivariogram|ordinary kriging|simple kriging|kriging predictor)\b/.test(blob) &&
    !/\b(semivariogram|kriging)\b/.test(source.toLowerCase());
  const counts = {
    definitions: pack.definitions.length,
    formulas: pack.formulas.length,
    proofs: pack.proofs.length,
    sectionBlocks: pack.sectionBlocks?.length ?? 0,
  };
  const nonEmpty = counts.definitions + counts.formulas + counts.proofs > 0;
  return {
    case: c,
    nonEmpty,
    staleSpatialLeak,
    counts,
    validationOk: validation.ok,
    criticalFailure: validation.criticalQualityFailure,
  };
}

export function runAllSmokeTests(): SmokeTestRun[] {
  return SMOKE_CASES.map((x) => runSmokeTest(x.id));
}
