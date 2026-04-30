export const definitionBoundaryRegressionFixture = {
  input:
    "Definition 2.1. [VL] A random field is a family X=(X_t)_{t in T} of random variables X_t that are defined on the same probability space and indexed by t in a subset T of R^d. Remark. A random field is therefore a generalisation...",
  expected: {
    itemCountAtLeast: 1,
    definition: {
      type: "definition",
      title: "Definition 2.1. Random field",
      cardFront: "Random field",
      statement:
        "A random field is a family X=(X_t)_{t in T} of random variables X_t that are defined on the same probability space and indexed by t in a subset T of R^d.",
      excludedText: "Remark. A random field is therefore a generalisation",
      questionPrompt: "State Definition 2.1: random field.",
      statementLatexIncludes: ["\\(X=(X_t)_{t\\in T}\\)", "\\(T\\subset\\mathbb{R}^d\\)"],
    },
  },
};

export const theoremProofRegressionFixture = {
  input: "Theorem 2.2. If the stated conditions hold, the conclusion follows. Proof. Apply the assumptions and simplify. ∎",
  expected: {
    theorem: {
      type: "theorem",
      theoremNumber: "2.2",
      statement: "If the stated conditions hold, the conclusion follows.",
      proof: "Apply the assumptions and simplify. ∎",
      questionPromptWhenProofRequired: "Prove Theorem 2.2.",
      questionPromptWhenProofNotRequired: "State Theorem 2.2. The proof is not required.",
    },
  },
};
