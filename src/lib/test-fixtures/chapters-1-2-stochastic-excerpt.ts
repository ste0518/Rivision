/**
 * Synthetic parsed-PDF–style fixture for “chapters 1–2” style lecture notes
 * (stochastic simulation / random variate generation). Used to test the local
 * Study Pack pipeline without shipping the full binary PDF in the repo.
 */

export const chapters12StochasticExcerpt = `[Source file: chapters-1-2.pdf]

[Page 1]
Stochastic Simulation: From Uniform Random Numbers to Generative Models

1 INTRODUCTION

1.1 introduction

1.1.1 why is this course useful?

1.1.2 what will be covered in this course?

1.1.3 notation

1.2 The sampling problem

1.2.1 Motivating example: estimating pi

1.3 A primer on Bayesian inference

1.3.1 Bayesian inference

The unnormalised target relates to the normalised density by
p*(x) = pbar*(x) / Z.
For expectations we write (phi, p*) = E_p*[phi(X)] = int phi(x)p*(x)dx.

1.3.2 Bayes rule for conditionally independent observations

Definition 1.1. Let X, Y and Z be random variables. We say X and Y are conditionally independent given Z if p(x,y|z)=p(x|z)p(y|z).

Proposition 1.1 (Conditional Bayes rule). Under conditional independence the posterior factorises as stated in the lecture notes.
Proof. Expand p(x|y,z) using Bayes and cancel common factors.

1.3.3 Marginal likelihood

We may write p(y) = int p(y|x)p(x)dx and p(x|y) = p(y|x)p(x) / p(y).

1.4 Conclusion

2 EXACT GENERATION OF RANDOM VARIATES

2.1 Generating uniform random variates

For pseudo-random streams we use linear congruential generators with
x_{n+1} = a x_n + b mod m and u_n = x_n / m.

Definition 2.1. A sequence pseudo-random numbers is obtained by the above recursion when parameters satisfy standard conditions.

2.2 Transformation methods

2.2.1 Inverse transform

Theorem 2.1. Consider a random variable X with a CDF F_X and let U be uniform on (0,1). Then X = F_X^{-1}(U) has the desired distribution.
Proof. For all x we have P(F_X^{-1}(U) <= x) = P(U <= F_X(x)) = F_X(x).

Algorithm 1 Pseudocode for inverse transform sampling
1: Draw U ~ Uniform(0,1).
2: Return X = F_X^{-1}(U).

2.2.2 Transformation method

Algorithm 2 Pseudocode for transformation method
1: Sample auxiliary noise.
2: Apply deterministic map g.

2.2.3 Box-Müller transform

We use Z_1 = sqrt(-2log U_1)cos(2pi U_2) and Z_2 = sqrt(-2log U_1)sin(2pi U_2).

2.3 Composition

2.3.1 Sampling joint distributions

For independent parts one may use p(x,y|z) = p(x|z)p(y|z).

2.4.1 Sampling a multivariate Gaussian

Theorem 2.2 (Fundamental Theorem of Simulation). Sampling can be reduced to uniform simulation under standard assumptions.

Proposition 2.1 (Chain Rule for Sampling). Factorisations guide iterative sampling schemes.

Algorithm 4 Pseudocode for Sampling Multivariate Gaussian
1: Draw standard normal vector X.
2: Set Y = Sigma^{1/2}X + mu or equivalently x_i = mu + L v with Cholesky L.

2.5 Rejection sampling

For reference,
p_Y(y) = p_X(g^{-1}(y)) |d g^{-1}(y)/dy|
and in multiple dimensions use |det J_{g^{-1}}(y)|.

An exponential draw satisfies X = -lambda^{-1} log(1-U).
`;
