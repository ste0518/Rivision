/**
 * Extracted-text fixture for chapter-4.pdf (Markov Chain Monte Carlo).
 * Concatenates the structurally relevant slices of the parsed PDF text so we can
 * unit-test the local Study Pack extractor without re-running pdf.js.
 */

export const chapter4McmcExcerpt = `4 MARKOV CHAIN MONTE CARLO

In this chapter, we introduce Markov chains and then Markov Chain Monte Carlo (MCMC) methods.

4.1 discrete state space markov chains

A good setting for an introduction to Markov chains is the discrete space setting.

Definition 4.1 (Markov chain). A discrete-time, discrete-state Markov chain on X is a stochastic process (Xn)n≥0 with values in X such that for all n ≥ 0 and all x0, . . . , xn+1 ∈ X with P(X0 = x0, . . . , Xn = xn) > 0,
P(Xn+1 = xn+1 | X0 = x0, . . . , Xn = xn) = P(Xn+1 = xn+1 | Xn = xn).

Definition 4.2 (Transition matrix). For a discrete-time Markov chain (Xn)n≥0 on X = {1, . . . , d}, the transition matrix is the d × d matrix M with entries
Mij = P(Xn+1 = j | Xn = i), for all i, j ∈ X and all n ≥ 0.
In particular, Mij ≥ 0 for all i, j and ∑j=1 d Mij = 1 for each i.

Example 4.1 (Discrete space Markov chain). Consider the state transition diagram of a Markov chain. Write out the transition matrix of this chain.

We can also compute the n-step transition matrix.
M(n) = M n
M(m+n) = M(m)M(n)
pn = pn-1M
pn = p0Mn

4.1.4 reversibility and detailed balance
We define the detailed balance condition as
p?(i)Mij = p?(j)Mji.
This trivially implies that p? = p?M, hence the invariance of p?.

4.2 continuous state space markov chains

Definition 4.3 (K-invariance). A density p? on X is called K-invariant if, for x ∈ X,
p?(x) = ∫ K(x|x') p?(x') dx'.

Definition 4.4 (Detailed balance). A transition kernel K is said to satisfy detailed balance if
K(x'|x)p?(x) = K(x|x')p?(x').

Remark 4.1. It is also important to note the more general version of the detailed balance.

Proposition 4.1 (Detailed balance implies stationarity). If K satisfies detailed balance, then p? is the invariant distribution.
Proof. The proof is a one-liner:
∫ p?(x)K(x'|x)dx' = ∫ p?(x')K(x|x')dx',
which is just integrating both sides after writing the detailed balance condition.

Exercise 4.2. Consider the real-valued Markov kernel K(xn|xn-1) = N(xn; axn-1, 1). Show that this kernel satisfies the detailed balance condition.

4.3 metropolis-hastings algorithm

The Metropolis-Hastings (MH) algorithm allows us to define transition kernels where the detailed balance is satisfied w.r.t. any p? we wish to sample from.

Algorithm 9 Pseudocode for Metropolis Hastings method
1: Input: The number of samples N, and starting point X0.
2: for n = 1, . . . , N do
3: Propose (sample): X' ∼ q(x'|Xn-1)
4: Accept the sample X' with probability α(Xn-1, X') = min{1, p?(X')q(Xn-1|X')/[p?(Xn-1)q(X'|Xn-1)]}.
5: Otherwise reject the sample and set Xn = Xn-1.
6: end for
7: Discard first burnin samples and return the remaining samples.

We define the acceptance ratio as
r(x, x') = p?(x')q(x|x') / [p?(x)q(x'|x)].

Proposition 4.2 (Metropolis-Hastings satisfies detailed balance). The Metropolis-Hastings algorithm satisfies detailed balance w.r.t. p?, i.e.,
p?(x)K(x'|x) = p?(x')K(x|x'),
where K is the kernel defined by the MH algorithm.
Proof. We first define the kernel induced by the MH algorithm. K(x'|x) = α(x, x')q(x'|x) + (1 - a(x))δx(x'). Substituting and using min{a,b}·a swap shows the equality, completing detailed balance.

Example 4.5 (Independent Gaussian proposal). Consider a Gaussian target. Compute the acceptance ratio.

Exercise 4.4. Sample from the banana density using MH sampler.

4.4 gibbs sampling

We will now go into another major class of MCMC samplers, called Gibbs samplers.

Algorithm 11 Pseudocode for the Gibbs sampler
1: Input: The number of samples N, and starting point X0 ∈ Rd.
2: for n = 1, . . . , N do
3: Sample Xn,1 ∼ p1,?(Xn,1|Xn-1,2, . . . , Xn-1,d)
4: end for
5: Discard first burnin samples and return the remaining samples.

Proposition 4.3 (Gibbs kernel leaves the target distribution invariant). The Gibbs kernel K leaves the target distribution p? invariant.
Proof. We first show that each kernel Km satisfies the detailed balance condition:
p?(x)Km(x'|x) = p?(x')Km(x|x').
This shows that Km satisfies detailed balance, therefore Km leaves p? invariant. Application of d kernels K1, . . . , Kd will leave p? invariant.

Exercise 4.5. Consider a generic target p(x) and a proposal q(x).
Exercise 4.6. Implement the random scan Gibbs sampler.
`;
