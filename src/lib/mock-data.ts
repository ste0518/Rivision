import { createId } from "@/lib/utils";
import type { RevisionItem } from "@/lib/types";

const now = () => new Date().toISOString();

export function createMockRevisionItems(): RevisionItem[] {
  const timestamp = now();
  const sourceFile = "Mock spatial statistics notes";
  return [
    {
      id: createId("card"), type: "definition", title: "Weak stationarity",
      conceptName: "Weak stationarity", displayTitle: "Weak stationarity", cardFront: "Weak stationarity", taskPrompt: "Recall the exact definition.",
      statement: "A random field Z(s) is weakly stationary if E[Z(s)] = m is constant and Cov(Z(s), Z(s + h)) = C(h) depends only on the lag h, not on the absolute location s.",
      sourceFile, sourceLocation: "Section 2.1", section: "2.1 Stationarity", tags: ["stationarity", "covariance"], importance: "must_know",
      guidanceReason: "Definitions of weak, strict, and intrinsic stationarity are examinable.", questionPrompt: "State the definition of weak stationarity.",
      answer: "A random field Z(s) is weakly stationary if E[Z(s)] = m is constant and Cov(Z(s), Z(s + h)) = C(h) depends only on the lag h, not on the absolute location s.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
    {
      id: createId("card"), type: "definition", title: "Strict stationarity",
      conceptName: "Strict stationarity", displayTitle: "Strict stationarity", cardFront: "Strict stationarity", taskPrompt: "Recall the exact definition.",
      statement: "A random field is strictly stationary if every finite-dimensional distribution is invariant under translation of all spatial locations by the same vector.",
      sourceFile, sourceLocation: "Section 2.1", section: "2.1 Stationarity", tags: ["stationarity"], importance: "must_know",
      guidanceReason: "Definitions of weak, strict, and intrinsic stationarity are examinable.", questionPrompt: "State the definition of strict stationarity.", answer: "A random field is strictly stationary if every finite-dimensional distribution is invariant under translation of all spatial locations by the same vector.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
    {
      id: createId("card"), type: "definition", title: "Intrinsic stationarity",
      conceptName: "Intrinsic stationarity", displayTitle: "Intrinsic stationarity", cardFront: "Intrinsic stationarity", taskPrompt: "Recall the exact definition.",
      statement: "A random field Z(s) is intrinsically stationary if E[Z(s + h) - Z(s)] = 0 and Var(Z(s + h) - Z(s)) = 2 gamma(h) depends only on h.",
      sourceFile, sourceLocation: "Section 2.2", section: "2.2 Variograms", tags: ["stationarity", "variogram"], importance: "must_know",
      guidanceReason: "Definitions of weak, strict, and intrinsic stationarity are examinable.", questionPrompt: "State the definition of intrinsic stationarity.", answer: "A random field Z(s) is intrinsically stationary if E[Z(s + h) - Z(s)] = 0 and Var(Z(s + h) - Z(s)) = 2 gamma(h) depends only on h.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
    {
      id: createId("card"), type: "theorem", title: "Covariance function validity",
      conceptName: "Covariance function validity", displayTitle: "Covariance function validity", cardFront: "Covariance function validity", taskPrompt: "State the theorem and its conditions.",
      statement: "A function C(h) is a valid covariance function if it is positive semi-definite: for any locations s1, ..., sn and real coefficients a1, ..., an, sum_i sum_j ai aj C(si - sj) >= 0.",
      sourceFile, sourceLocation: "Theorem 3.4", section: "3. Covariance models", tags: ["covariance", "positive semi-definite"], importance: "partial",
      guidanceReason: "Only know the statement of covariance validity; proof is not required.", questionPrompt: "State the covariance function validity condition and explain when it applies.", answer: "C(h) is valid when it is positive semi-definite: for any finite set of locations and real coefficients, sum_i sum_j ai aj C(si - sj) >= 0. This ensures covariance matrices built from C are non-negative definite.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
    {
      id: createId("card"), type: "formula", title: "Semivariogram", statement: "gamma(h) = 1/2 Var(Z(s + h) - Z(s)).",
      conceptName: "Semivariogram", displayTitle: "Semivariogram", cardFront: "Semivariogram", taskPrompt: "Write down the formula and explain each term.",
      sourceFile, sourceLocation: "Section 2.2", section: "2.2 Variograms", tags: ["formula", "variogram"], importance: "must_know",
      guidanceReason: "Formulae in the variogram section are must know.", questionPrompt: "Write down the formula for the semivariogram and explain each term.", answer: "gamma(h) = 1/2 Var(Z(s + h) - Z(s)), where h is the spatial lag and Z(s + h) - Z(s) is the increment of the random field over that lag.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
    {
      id: createId("card"), type: "theorem", title: "Simple kriging BLUP statement",
      conceptName: "Simple kriging BLUP statement", displayTitle: "Simple kriging BLUP statement", cardFront: "Simple kriging BLUP statement", taskPrompt: "State the theorem and its conditions.",
      statement: "Under a known mean and covariance model, the simple kriging predictor is the best linear unbiased predictor obtained by weighting observed values to minimise prediction variance subject to unbiasedness.",
      sourceFile, sourceLocation: "Section 5.1", section: "5. Kriging", tags: ["kriging", "BLUP"], importance: "must_know",
      guidanceReason: "Simple kriging statement is examinable; derivation is optional.", questionPrompt: "State the simple kriging BLUP result.", answer: "With known mean and covariance, simple kriging gives the best linear unbiased predictor by choosing weights on observed values that minimise prediction variance while preserving unbiasedness.", createdAt: timestamp, updatedAt: timestamp, reviewCount: 0,
    },
  ];
}
