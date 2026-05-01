import type { ParsedDocument, StudyFileRole } from "@/lib/types";

export const coursePackFixtures = {
  lectureNotes: makeDocument("fixture-lecture-notes.txt", "lecture_notes", `
2 Random fields

Definition 2.1 A random field is a collection X=(Xt)t in T of random variables indexed by t in a subset T of R d.

Definition 2.3 A random vector X=(X1,...,Xn)' is Gaussian if every linear combination a'X = Pn i=1 aiXi is normally distributed. This definition allows us to define a Gaussian random field.

Definition 2.4 The family X=(Xt)t in T is a Gaussian random field if every finite-dimensional random vector (Xt1,...,Xtn)' has a multivariate normal distribution.

Definition 2.6 A random field is strictly stationary if its finite-dimensional distributions are invariant under translation.

Definition 2.16 X has an isotropic covariance if Cov(Xt, Xs) depends only on ||t-s||.

Theorem 2.5 A function rho : T x T -> R is a valid covariance function if and only if it is symmetric and positive semi-definite.

3 Kriging

Formula The simple kriging predictor is Xˆ t0 = m(t0)+K′Σ−1(Z-M).
`),
  guidance: makeDocument("fixture-exam-guidance.txt", "exam_guidance", `
Exam format: students must know definitions of stationarity, isotropy, covariance validity, and Gaussian random fields.
You may be asked to state the covariance validity theorem and set up simple or ordinary kriging calculations.
Proofs are required only when a question explicitly says prove or show that.
`),
  pastPaper: makeDocument("fixture-past-paper.txt", "past_paper", `
Question 1. Define weak stationarity and strict stationarity. Explain the difference.
Question 2. Show whether a proposed covariance function is valid.
Question 3. Use the kriging equations to compute the predictor at t0.
Question 4. Interpret isotropy and anisotropy for a semi-variogram.
`),
  problemSheet: makeDocument("fixture-problem-sheet.txt", "problem_sheet", `
Problem 1. Check whether Sigma is positive semi-definite for a covariance matrix.
Problem 2. Calculate the simple kriging predictor using rho(t0,t0), K′Σ−1 and observed values.
Problem 3. Compare geometric anisotropy and zonal anisotropy.
`),
  solutions: makeDocument("fixture-solutions.txt", "solution_sheet", `
Solution outline: assemble Σij = Cov(Xi, Xj), solve the kriging linear system, then compute the prediction variance.
For covariance validity, test a′Σa >= 0 for all a in R n.
`),
};

function makeDocument(sourceFile: string, role: StudyFileRole, fullText: string): ParsedDocument {
  const text = fullText.trim();
  return {
    sourceFile,
    fileType: "txt",
    role,
    fullText: text,
    diagnostics: {
      success: true,
      charCount: text.length,
      warnings: [],
      errors: [],
      extractionQuality: "high",
    },
  };
}
