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
ESS_N = 1 / sum_i bar w_i^2
which measures how many i.i.d. samples carry similar information to the weighted set. This definition only concerns ESS; later sections study mixture proposals.

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

`;
