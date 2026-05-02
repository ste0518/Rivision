/**
 * Hand-curated text fixture mirroring structure from chapter-3.pdf (Monte Carlo
 * integration / importance sampling) for local Study Pack extraction tests.
 */

export const chapter3MonteCarloExcerpt = `3 MONTE CARLO INTEGRATION

We study Monte Carlo integration and importance sampling.

3.1 Introduction to Monte Carlo integration

3.2 Error metrics

3.3 Importance sampling

3.3.1 Basic importance sampling

3.3.2 Choosing the optimal importance sampling proposal within a family

3.3.3 Self-normalised importance sampling

3.5.2 Sampling importance resampling

3.5.3 Diagnostics for importance sampling

3.5.4 Mixture importance sampling

Proposition 3.1 (Monte Carlo estimator is unbiased). The Monte Carlo estimator is unbiased for the target expectation.
Proof. Take expectation of the sample average and use linearity.

Proposition 3.2 (Monte Carlo estimator variance). The variance of the MC estimator decays as 1/N.
Proof. Use independence of the samples.

Proposition 3.3 (Importance sampling estimator is unbiased). The IS estimator is unbiased for the same expectation when supports match.
Proof. Change variables under q.

Proposition 3.4 (Importance sampling estimator variance). The variance of the IS estimator is given by the standard IS variance formula.
Proof. Expand the square and simplify.

Proposition 3.5 (SNIS mean squared error bound). Self-normalised importance sampling admits a finite-sample MSE bound versus the ratio estimator.
Proof. Use the ratio decomposition and control the random denominator.

Proposition 3.6 (Marginal likelihood estimator unbiasedness). Under standard regularity, an unbiased estimator of the marginal likelihood exists via importance sampling.
Proof. Apply the identity trick with a normalized proposal integral.

The target mean is
bar{phi} = E_{p*}[phi(X)] = int phi(x) p*(x) dx
and the empirical measure is
p_N^*(dx) = 1/N sum_i delta_{X_i}(dx).
The MC estimator is
hat phi^N_MC = 1/N sum_{i=1}^N phi(X_i).
We have
Var(hat phi^N_MC) = Var(phi(X))/N
and
bias(hat phi^N) = E[hat phi^N] - bar phi.
Also
MSE = bias^2 + variance.

The importance weight is
w(x) = p*(x)/q(x)
and the IS estimator
hat phi^N_IS = 1/N sum_i w_i phi(X_i).
The variance obeys
Var_q(hat phi^N_IS) = 1/N (E_q[w^2(X)phi^2(X)] - bar phi^2).
For unnormalised targets, use
W(x) = bar p*(x)/q(x) and
hat phi^N_SNIS = sum_i bar w_i phi(X_i) with
bar w_i = W(X_i) / sum_j W(X_j).

Definition 3.1 (Effective Sample Size). A useful diagnostic is
ESS_N = 1 / sum_i bar w_i^2.
We always have 1 ≤ ESS_N ≤ N.

3.5.4 Mixture importance sampling

We now consider mixture importance sampling with several component proposals.

Algorithm 7 (Basic importance sampling)
1: Input: proposal q, number of samples N, test function phi.
2: for i = 1 to N do
3: sample X_i ~ q
4: set w_i = p*(X_i) / q(X_i)
5: end for
6: return hat phi^N_IS = (1/N) sum w_i phi(X_i)

Remark 3.5. In practice, normalise weights if only bar p* is known.

This is a generic Bayes-style display that should be down-ranked in a pure MC chapter:
p(x|y) = p(y|x) p(x)

Algorithm 8 (Self-normalised importance sampling)
1: Input: unnormalised target bar p*, proposal q, sample size N.
2: for i = 1 to N do
3: draw X_i ~ q; set W_i = bar p*(X_i) / q(X_i)
4: end for
5: normalise bar w_i = W_i / sum_j W_j
6: estimate hat phi^N_SNIS = sum_i bar w_i phi(X_i)

Sampling importance resampling draws multinomial resamples using normalised weights.

hat sigma_{phi,N}^2 = 1/N^2 sum_{i=1}^N (phi(X_i)-hat phi^N_MC)^2.

widehat P(X in A) = 1/N sum 1_A(X_i).

Var(hat phi^N) = E[(hat phi^N - E[hat phi^N])^2].

MSE(hat phi^N) = E[(hat phi^N - bar phi)^2].

RMSE(hat phi^N) = sqrt(MSE(hat phi^N)).

RAE(hat phi^N) = |hat phi^N - bar phi|/|bar phi|.

Finite variance condition E_q[w(X)^2 phi(X)^2] < infinity.

bar phi = int phi(x) p*(x)/q(x) q(x) dx.

Optimal proposal q*(x) ties to |phi(x)| p*(x).

Mixture proposal q_alpha(x) = sum_{k=1}^K alpha_k q_k(x).

Log-weight stabilisation widetilde log W_i = log bar p*(X_i) - log q(X_i) - max_j log W_j.

Example 3.1. Illustration of MC variance scaling with N.

Example 3.2. Tail probability for Gaussian tail event.

Example 3.3. Setting up importance sampling for a rare event.

Example 3.4. Computing and monitoring weights.

Example 3.5. Comparing two proposals on variance.

Example 3.6. Self-normalised estimates on a toy target.

Example 3.7. Effective sample size numeric illustration.

Example 3.8. Rare-event probability under extreme thresholds.

Example 3.9. Mixture proposal covering modes.

Exercise 3.1. Prove unbiasedness of the MC estimator.

Exercise 3.2. Derive the MC variance formula.

Exercise 3.3. State the IS identity and identify expectations.

Exercise 3.4. State the support condition for IS.

Exercise 3.5. Give the finite variance condition.

Exercise 3.6. Explain SNIS bias in two sentences.

Exercise 3.7. Compute ESS for equal weights.

Exercise 3.8. Final Exam Q2 2024 integrative practice.

(a) Derive a bound.

(b) Interpret ESS.

Exercise 3.9. Explain log-weight stabilisation.

Exercise 3.10. Mixture importance sampling setup.

Exercise 3.11. Diagnostics for weight degeneracy.

Exercise 3.12. Review all estimator relationships.

`;
