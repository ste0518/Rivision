/**
 * Minimal synthetic pages for universal pipeline invariants (not course-specific syllabi).
 */

export type FixtureCase = {
  id: string;
  pages: Array<{ pageNumber: number; text: string }>;
  expectHeadingCountMin: number;
  expectChapterMapSourceNotNoneWhenMap: boolean;
  expectSectionBlocksMin?: number;
  expectFormulaCandidatesMin?: number;
  expectProofCandidatesMin?: number;
  expectWorkedExampleCandidatesMin?: number;
};

export const FIXTURE_LECTURE_CHAPTER_HEADINGS: FixtureCase = {
  id: "lecture_chapter_headings",
  pages: [
    { pageNumber: 1, text: "MATH 00000 — Spring 2026\n\nBayesian Inference Notes\n\nprof@uni.edu" },
    {
      pageNumber: 2,
      text: `Chapter 1

Setup and priors

1.1 Notation

We write p(theta) for the prior.

Chapter 2

Computation

2.1 Grid approximation

theta in R^d, integral int f(theta) d theta = 1.

Proof.
Assume finite grid. Then sum_i pi_i = 1.
`,
    },
  ],
  expectHeadingCountMin: 4,
  expectChapterMapSourceNotNoneWhenMap: true,
  expectSectionBlocksMin: 3,
  expectFormulaCandidatesMin: 1,
  expectProofCandidatesMin: 1,
};

export const FIXTURE_TOC_NO_CHAPTER_LABEL: FixtureCase = {
  id: "toc_numbered_only",
  pages: [
    {
      pageNumber: 1,
      text: `Contents

1.1 Introduction .............. 2
1.2 Models .................... 3
2.1 Estimation ................ 4
`,
    },
    { pageNumber: 2, text: "1.1 Introduction\n\nWe study estimators.\n\n1.2 Models\n\nLikelihood L(theta) = prod_i f(x_i|theta)." },
  ],
  expectHeadingCountMin: 2,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectSectionBlocksMin: 1,
  expectFormulaCandidatesMin: 1,
};

export const FIXTURE_FORMULA_HEAVY: FixtureCase = {
  id: "formula_heavy",
  pages: Array.from({ length: 12 }, (_, i) => ({
    pageNumber: i + 1,
    text: `Section ${i + 1}

E{X} = int x f(x) dx

Cov(X,Y) = E{(X-mu_X)(Y-mu_Y)}

argmin_theta sum_i loss(y_i, g(x_i,theta)) <= epsilon

det(A) = tr(log A) when defined.
`,
  })),
  expectHeadingCountMin: 0,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectFormulaCandidatesMin: 15,
};

export const FIXTURE_THEOREM_PROOF: FixtureCase = {
  id: "theorem_proof",
  pages: [
    {
      pageNumber: 1,
      text: `Theorem 1.1 (Test). For all x, f(x) >= 0.

Proof.
Let x be fixed. Then f(x) = g(x)^2 >= 0.

Lemma 1.2. Boundedness holds.

Proof.
Immediate from compactness.
`,
    },
  ],
  expectHeadingCountMin: 1,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectProofCandidatesMin: 1,
};

export const FIXTURE_WORKED_EXAMPLES: FixtureCase = {
  id: "worked_examples",
  pages: [
    {
      pageNumber: 1,
      text: `Worked example: mean of normals

Let X_i ~ N(mu,1). Then E{bar X} = mu.

Example 2.1. Compute Var(bar X).

Solution.
Using independence, Var(bar X) = 1/n.
`,
    },
  ],
  expectHeadingCountMin: 1,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectProofCandidatesMin: 0,
  expectWorkedExampleCandidatesMin: 1,
};

export const FIXTURE_PROBLEM_SHEET: FixtureCase = {
  id: "problem_sheet",
  pages: [
    {
      pageNumber: 1,
      text: `Problem Sheet 2

Problem 1. (5 marks) Show that A is positive definite.

Problem 2. (10 marks) Derive the MLE for lambda.
`,
    },
  ],
  expectHeadingCountMin: 1,
  expectChapterMapSourceNotNoneWhenMap: false,
};

export const FIXTURE_PAST_PAPER: FixtureCase = {
  id: "past_paper",
  pages: [
    {
      pageNumber: 1,
      text: `Final Examination — Time allowed 120 minutes
Total marks 100

Question 1. (20 marks) State the definition of convergence in probability.

Question 2. (30 marks) Prove the continuous mapping theorem.
`,
    },
  ],
  expectHeadingCountMin: 1,
  expectChapterMapSourceNotNoneWhenMap: false,
};

export const FIXTURE_SOLUTIONS: FixtureCase = {
  id: "solutions",
  pages: [
    {
      pageNumber: 1,
      text: `Solutions to Problem Set 4

Solution 1.
We expand (x+y)^2 = x^2 + 2xy + y^2.

Mark scheme: 2 marks for expansion, 1 mark for simplification.
`,
    },
  ],
  expectHeadingCountMin: 0,
  expectChapterMapSourceNotNoneWhenMap: false,
};

export const FIXTURE_OCR_NOISY: FixtureCase = {
  id: "ocr_noisy",
  pages: [
    {
      pageNumber: 1,
      text: `Chapter 3

Clean title line

fiiiiinto population Dopulation

Theorem 3.1. Stable result.

Proof.
Follows.
`,
    },
  ],
  expectHeadingCountMin: 2,
  expectChapterMapSourceNotNoneWhenMap: true,
};

export const FIXTURE_MIXED_NOTES_EXERCISES: FixtureCase = {
  id: "mixed_notes_exercises",
  pages: [
    {
      pageNumber: 1,
      text: `Chapter 1

Definitions

Definition 1.1. A group is a set with an operation.

Exercise 1.1. Show associativity for matrices.

2.1 Subgroups

Exercise 2.1. Prove the subgroup criterion.
`,
    },
  ],
  expectHeadingCountMin: 3,
  expectChapterMapSourceNotNoneWhenMap: true,
};

/** Standalone formula sheet (dense symbols, few sentences). */
export const FIXTURE_FORMULA_SHEET_STANDALONE: FixtureCase = {
  id: "formula_sheet_standalone",
  pages: Array.from({ length: 6 }, (_, i) => ({
    pageNumber: i + 1,
    text: `Reference sheet — page ${i + 1}

||x||_2 = sqrt(sum x_i^2)
nabla f(x) = (partial f / partial x_1, ...)
P(A|B) = P(A cap B) / P(B)
det(I + uv^T) = 1 + v^T u
`,
  })),
  expectHeadingCountMin: 0,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectFormulaCandidatesMin: 10,
};

/** Short revision guide (topic-like headings, no full lecture structure). */
export const FIXTURE_REVISION_GUIDE: FixtureCase = {
  id: "revision_guide",
  pages: [
    {
      pageNumber: 1,
      text: `Exam revision checklist — Spring 2026

Must know

Definition 1. Convergence in probability: X_n -> X if for all eps>0, P(|X_n-X|>eps) -> 0.

Worked example: CLT for means

Let bar X_n = (1/n) sum X_i with Var(X_i)=sigma^2. Then sqrt(n)(bar X_n - mu) => N(0,sigma^2).

Exercise 1. Show that Var(bar X_n) = sigma^2 / n.
`,
    },
  ],
  expectHeadingCountMin: 3,
  expectChapterMapSourceNotNoneWhenMap: false,
  expectFormulaCandidatesMin: 1,
  expectProofCandidatesMin: 0,
};

export const ALL_UNIVERSAL_FIXTURES: FixtureCase[] = [
  FIXTURE_LECTURE_CHAPTER_HEADINGS,
  FIXTURE_TOC_NO_CHAPTER_LABEL,
  FIXTURE_FORMULA_HEAVY,
  FIXTURE_THEOREM_PROOF,
  FIXTURE_WORKED_EXAMPLES,
  FIXTURE_PROBLEM_SHEET,
  FIXTURE_PAST_PAPER,
  FIXTURE_SOLUTIONS,
  FIXTURE_OCR_NOISY,
  FIXTURE_MIXED_NOTES_EXERCISES,
  FIXTURE_FORMULA_SHEET_STANDALONE,
  FIXTURE_REVISION_GUIDE,
];
