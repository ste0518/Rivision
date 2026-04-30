import assert from "node:assert/strict";
import { segmentRevisionCandidates } from "../src/lib/segmentation";
import { toLatexText } from "../src/lib/revision-item-utils";
import type { ParsedDocument } from "../src/lib/types";

const input =
  "Definition 2.1. [VL] A random field is a family X = (X_t)_{t in T} of random variables X_t that are defined on the same probability space and indexed by t in a subset T of R^d. Remark. A random field is therefore a generalisation of a stochastic process. Theorem 2.2. [VL] Consider a finite set t1,...,tn in T. Proof. This comes immediately from the Kolmogorov extension theorem.";

const parsedDocument: ParsedDocument = {
  sourceFile: "regression.txt",
  fileType: "txt",
  fullText: input,
  diagnostics: {
    success: true,
    charCount: input.length,
    warnings: [],
    errors: [],
    extractionQuality: "high",
  },
};

const candidates = segmentRevisionCandidates([parsedDocument]);

assert.equal(candidates.length, 4);
assert.deepEqual(candidates.map((candidate) => candidate.label), ["Definition", "Remark", "Theorem", "Proof"]);
assert.equal(candidates[0].number, "2.1");
assert.equal(
  candidates[0].rawText,
  "Definition 2.1. [VL] A random field is a family X = (X_t)_{t in T} of random variables X_t that are defined on the same probability space and indexed by t in a subset T of R^d.",
);
assert.equal(candidates[1].rawText, "Remark. A random field is therefore a generalisation of a stochastic process.");
assert.equal(candidates[2].number, "2.2");
assert.equal(candidates[2].rawText, "Theorem 2.2. [VL] Consider a finite set t1,...,tn in T.");
assert.equal(candidates[3].rawText, "Proof. This comes immediately from the Kolmogorov extension theorem.");

const definitionStatement =
  "A random field is a family X = (X_t)_{t in T} of random variables X_t that are defined on the same probability space and indexed by t in a subset T of R^d.";
const latex = toLatexText(definitionStatement);

assert.match(latex, /\\\(X=\(X_t\)_\{t\\in T\}\\\)/);
assert.match(latex, /\\\(T\\subset \\mathbb\{R\}\^d\\\)/);

console.log("Extraction regression passed.");
