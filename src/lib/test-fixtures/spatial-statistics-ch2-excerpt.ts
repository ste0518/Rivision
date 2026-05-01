import type { ParsedDocument } from "@/lib/types";

export const spatialStatisticsFixtureSource = "spatial-statistics-ch2-excerpt.txt";

export const spatialStatisticsGuidanceText = `
Build a concise exam revision deck from the labelled definitions and theorem statements in Chapters 2 and 3.
Proofs for Theorem 2.2 and Bochner's theorem are not examinable unless explicitly stated.
Keep core definitions, stationarity concepts, covariance validity, spectral density, semi-variogram concepts, anisotropy, and Kriging theorem statements.
Reject bibliography, figure captions, ordinary explanatory paragraphs, background normal density formulae, and intermediate proof algebra.
`;

export const spatialStatisticsFixtureText = `
[Page 5]
2 Random Fields
Random fields are the most common way to statistically model geostatistical data.
Definition 2.1. [VL] A random field is a family X = (Xt)t∈T of random variables Xt that are defined on the same probability space and indexed by t in a subset T of Rd.
Remark. A random field is therefore a generalisation of a stochastic process where the underlying index t need no longer be real or integer valued time but can instead take values that are multidimensional vectors in d-dimensional space where d ∈ N.
Theorem 2.2. [VL] Consider a finite set t1, . . . , tn ∈ T of index values. Then if X is a random field then the random vector (Xt1, . . . , Xtn)' has a well-defined probability distribution that is completely determined by its joint cumulative distribution Ft1,...,tn(x1, . . . , xn) = P(Xt1 ≤ x1; . . . ; Xtn ≤ xn), where xi ∈ R for i = 1, . . . , n. The ensemble of all such joint cumulative distribution functions with n ∈ N and t1, . . . , tn ∈ T uniquely define the probability distribution of X.
Proof. This comes immediately from the Kolmogorov extension theorem (not given here, and not examinable), see [VL] for details.
Remark. To define a random field model we must therefore specify the joint distribution of (Xt1, . . . , Xtn)' for all choices of n and t1, . . . , tn. In Section 2.1 we study the case where these joint distributions are multivariate Gaussian thus producing Gaussian random fields, which are fully specified by their mean and covariance functions.
2.1 Gaussian Random Fields and Covariance Functions
Recall that a random variable is Gaussian or normally distributed with mean mu and variance sigma^2 if it has probability density function given by f(x) = 1/(sigma sqrt(2pi)) exp[-1/2((x-mu)/sigma)^2], x ∈ R, with sigma^2 > 0. We now extend this definition to random vectors.
Definition 2.3. [VL] A random vector (X1, . . . , Xn)' has a multivariate normal distribution with mean vector m = (EX1, . . . , EXn)' ∈ Rn, and n x n covariance matrix Σ with entries Σi,j = Cov(Xi, Xj), if any linear combination a′X = sum_i=1^n aiXi, a ∈ Rn, is normally distributed.
[Page 6]
This definition allows us to define a Gaussian random field.
Definition 2.4. [VL] The family X = (Xt)t∈T indexed by T ⊆ Rd is a Gaussian random field if for any finite set t1, . . . , tn of indices the random vector (Xt1, . . . , Xtn)' has a multivariate normal distribution.
Remark. It follows from Definition 2.3 that an equivalent definition is that any linear combination of the finite random vector sum_i=1^n aiXti is normally distributed.
Definitions 2.3 and 2.4 therefore tell us that a Gaussian random field is specified by two parameters: the mean vector and the covariance matrix, which we define using the two functions: m : T -> R; m(t) = EXt, and ρ : T × T → R; ρ(s,t) = Cov(Xs, Xt), which we will henceforth refer to as the mean and covariance functions respectively.
Theorem 2.5. [VL] The function ρ : T × T → R, T ⊆ Rd is the covariance function of a Gaussian random field if and only if ρ is positive semi-definite, that is, for any finite set t1, . . . , tn ∈ T, n ∈ N, the matrix (ρ(ti,tj))n_i,j=1 is positive semi-definite.
Remark. Recall that for the matrix (ρ(ti,tj))n_i,j=1 to be positive semi-definite then it should be symmetric (ρ(ti,tj) = ρ(tj,ti)) and satisfy sum_i=1^n sum_j=1^n ai ρ(ti,tj) aj ≥ 0 for any a ∈ Rn.
Proof. The forward direction comes immediately from the result that all valid covariance matrices must be positive semi-definite. The reverse direction comes from the Kolmogorov extension theorem (not given here, and not examinable), see [VL] for details.

[Page 10]
2.2 Stationary Random Fields
For the rest of this chapter the index set will be T = Rd.
Definition 2.6. [VL] A random field X = (Xt)t∈Rd is strictly stationary if for all finite sets t1, . . . , tn ∈ Rd, n ∈ N, all k1, . . . , kn ∈ R, and all s ∈ Rd, P(Xt1+s ≤ k1; . . . ; Xtn+s ≤ kn) = P(Xt1 ≤ k1; . . . ; Xtn ≤ kn).
Remark. If X is strictly stationary with finite second moments then the mean function is constant and the covariance function is a function of the spatial lag only.
Definition 2.7. [VL] A random field X = (Xt)t∈Rd is weakly stationary if EXt^2 < ∞ for all t ∈ Rd; EXt ≡ m is constant; and Cov(Xt1, Xt2) = ρ(t2 − t1) for some ρ : Rd → R.
Remark. With finite second moments strict stationarity implies weak stationarity but the reverse implication is not in general true. If the random field is Gaussian, however, weak stationarity does imply strict stationarity.

[Page 11]
Proposition 2.8. [VL] If ρ : Rd → R is the covariance function of a weakly or covariance stationary random field, the following properties must hold: ρ(0) ≥ 0; ρ(t) = ρ(−t) for all t ∈ Rd; and |ρ(t)| ≤ ρ(0) for all t ∈ Rd.
Proof. These properties follow from variance non-negativity, covariance symmetry, and the Cauchy-Schwartz inequality.
Definition 2.9. [VL] A random field X = (Xt)t∈Rd is intrinsically stationary if EXt^2 < ∞ for all t ∈ Rd; EXt ≡ m is constant; and Var(Xt2 − Xt1) = f(t2 − t1) for some f : Rd → R.

[Page 13]
2.3 The Spectral Density Function
Definition 2.10. If ρ : Rd → R is the covariance function of a weakly stationary random field and f : Rd → R+ = [0, ∞) is its spectral density function then ρ(t) = integral over Rd exp(i<w,t>) f(w) dw, where by the inverse Fourier formula f(w) = (1/2pi)^d integral over Rd exp(-i<w,t>) ρ(t) dt, where f is symmetric, integrable and non-negative.
Theorem 2.11 (Bochner's theorem). [VL]+[GG] A continuous function ρ : Rd → R is a covariance function of a Gaussian stationary random field if and only if there exists a finite, symmetric and non-negative measure F such that ρ(t) = integral over Rd exp(i<w,t>) dF(w), where F is called the spectral measure of the random field. If ρ is integrable then F is absolutely continuous and admits a density f : Rd → R+ which is called the spectral density function of the random field.
Proof. The full proof of Bochner's theorem is non-examinable. We will only prove the if direction here and omit the only-if direction.

[Page 14]
Remark. Spectral density functions are popular because specifying second-order properties through a spectral density only requires symmetry, integrability and non-negativity, in contrast to positive semi-definiteness of covariance functions.
Definition 2.12. The Matérn Gaussian random field has a spectral density given by f(w) = sigma^2 C(alpha, nu) / (1 + alpha^2 ||w||^2)^(nu+d/2), w ∈ Rd, where sigma^2, alpha, nu > 0 and C(alpha,nu) ensures the variance is sigma^2.

[Page 17]
2.4 The Semi-Variogram
Definition 2.13. [VL] Let X = (Xt)t∈Rd be intrinsically stationary. Then the semi-variogram γ : Rd → R+ is defined by γ(t) = 1/2 Var(Xt − X0), t ∈ Rd, where 2γ(t) is commonly referred to as the variogram.
Remark. Observe that the semi-variogram at 0 is γ(0) = 0.
Definition 2.14. If X is weakly stationary and lim ||t|| -> infinity ρ(t) = 0 then it follows that lim ||t|| -> infinity γ(t) = ρ(0) and this is called the sill. The range is the distance at which the semi-variogram reaches its sill, and the practical range is the distance at which it reaches 95% of the sill.

[Page 18]
2.4.1 The nugget effect
Definition 2.15. [VL] We define the nugget effect of observed random fields as lim ||t|| -> 0 γ(t). The difference between the sill and the nugget effect is called the partial sill defined as lim ||t|| -> infinity γ(t) − lim ||t|| -> 0 γ(t).

[Page 19]
2.5 Isotropy and Anisotropy
Definition 2.16. [GG] A random field X = (Xt)t∈Rd has an isotropic covariance if for each t1, t2 ∈ Rd, Cov(Xt1, Xt2) depends only on ||t2 − t1||; specifically, there exists ρ0 : R+ → R such that for all t1, t2 ∈ Rd, ρ(t1,t2) = ρ0(||t2 − t1||) = ρ(t2 − t1).
Definition 2.17. A random field X = (Xt)t∈Rd has an isotropic spectral density function if there exists f0 : R+ → R+ such that for all w ∈ Rd, f0(||w||) = f(w).
Definition 2.18. A random field X = (Xt)t∈Rd has an isotropic semi-variogram if there exists γ0 : R+ → R+ such that for all t ∈ Rd, γ0(||t||) = γ(t).
Definition 2.19. [GG] The semi-variogram exhibits geometric anisotropy if it results from a linear deformation of an isotropic semi-variogram γ0 such that γ(h) = γ0(||Ah||), where A = DR is the product of a diagonal matrix D and a rotation matrix R.

[Page 20]
Definition 2.20. [GG] The semi-variogram exhibits stratified or zonal anisotropy if it is the sum of k components with geometric anisotropy, for example γ(h) = γ0_1(||A1h||) + ... + γ0_k(||Akh||), where Aj = Dj Rj and at least one diagonal entry of one of the Dj matrices is zero.

[Page 22]
3 Prediction from Geostatistical Data
Definition 3.1. [VL] The smoothed Matheron estimator of the semi-variogram is defined by gamma_hat(t) = 1/(2|N(t)|) sum over (ti,tj) in N(t) of (Xtj − Xti)^2, where the t-neighbourhood N(t) is defined by N(t) = {(ti,tj) : tj − ti ∈ B(t, epsilon)}, where B(t, epsilon) is the closed ball of radius epsilon centred at t and |.| denotes cardinality.

[Page 23]
3.2.1 Simple Kriging
Theorem 3.2. [VL] Let Z = [Xt1, . . . , Xtn]' be a length-n column vector of samples from a random field (Xt)t∈Rd with known mean function m : Rd → R and known covariance function ρ : Rd × Rd → R. Define Σ as the n x n covariance matrix with i,jth entry Σi,j = ρ(ti,tj), K as the length-n column vector with entries Ki = ρ(ti,t0), and M as the length-n column vector with entries Mi = m(ti). Then simple Kriging yields the following predictor of Xt0, t0 ∈ Rd: Xˆ t0 = m(t0) + K′Σ−1(Z−M). Equation (28) is the best linear unbiased predictor (BLUP) of Xt0 in terms of mean squared error. The mean squared prediction error is given by ρ(t0,t0) − K′Σ−1K.
Theorem 3.3. [VL] Let Z = [Xt1, . . . , Xtn]' be a length-n column vector of samples from a random field (Xt)t∈Rd with unknown constant mean and known covariance function ρ : Rd × Rd → R. Then ordinary Kriging yields the BLUP predictor and mean squared prediction error with the additional uncertainty term for the unknown mean.
`;

export const spatialStatisticsFixtureDocument: ParsedDocument = {
  sourceFile: spatialStatisticsFixtureSource,
  fileType: "txt",
  fullText: spatialStatisticsFixtureText.trim(),
  pages: buildPages(spatialStatisticsFixtureText),
  diagnostics: {
    success: true,
    charCount: spatialStatisticsFixtureText.trim().length,
    pageCount: 12,
    warnings: [],
    errors: [],
    likelyScannedPdf: false,
    extractionQuality: "high",
  },
};

export const spatialStatisticsGuidanceDocument: ParsedDocument = {
  sourceFile: "spatial-statistics-guidance.txt",
  fileType: "txt",
  fullText: spatialStatisticsGuidanceText.trim(),
  pages: [{ pageNumber: 1, text: spatialStatisticsGuidanceText.trim(), charCount: spatialStatisticsGuidanceText.trim().length }],
  diagnostics: {
    success: true,
    charCount: spatialStatisticsGuidanceText.trim().length,
    pageCount: 1,
    warnings: [],
    errors: [],
    likelyScannedPdf: false,
    extractionQuality: "high",
  },
};

function buildPages(text: string) {
  const pages: Array<{ pageNumber: number; text: string; charCount: number }> = [];
  for (const match of text.matchAll(/\[Page\s+(\d+)\]([\s\S]*?)(?=\n\[Page\s+\d+\]|\s*$)/g)) {
    const pageNumber = Number(match[1]);
    const pageText = match[2].trim();
    pages.push({ pageNumber, text: pageText, charCount: pageText.length });
  }
  return pages;
}
