import assert from "node:assert/strict";
import { segmentRevisionCandidates } from "../src/lib/segmentation";
import { extractRevisionItems } from "../src/lib/extraction";
import { filterRevisionItemsByRelevance } from "../src/lib/relevance";
import { convertCommonMathToLatex } from "../src/lib/revision-item-utils";
import { validateAndRepairRevisionItems } from "../src/lib/validation";
import type { ParsedDocument, RevisionItem } from "../src/lib/types";

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
const latex = convertCommonMathToLatex(definitionStatement);

assert.match(latex, /\\\(X=\(X_t\)_\{t\\in T\}\\\)/);
assert.match(latex, /\\\(\\mathbb\{R\}\^d\\\)/);

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function run() {
  const extraction = await extractRevisionItems({
    notesDocuments: [parsedDocument],
    guidanceDocuments: [],
    sourceFile: "regression.txt",
  });

  const definition = extraction.items.find((item) => item.type === "definition" && item.theoremNumber === "2.1");
  assert.ok(definition, "Definition 2.1 item should be extracted.");
  assert.equal(definition.type, "definition");
  assert.equal(definition.title, "Definition 2.1. Random field");
  assert.equal(definition.statement, definitionStatement);
  assert.doesNotMatch(definition.statement, /\bRemark\b/);
  assert.doesNotMatch(definition.statement, /\bTheorem\b/);
  assert.doesNotMatch(definition.statement, /\bProof\b/);
  assert.match(definition.statementLatex ?? "", /\\\(X=\(X_t\)_\{t\\in T\}\\\)/);
  assert.match(definition.statementLatex ?? "", /\\\(\\mathbb\{R\}\^d\\\)/);
  assert.equal(definition.questionPrompt, "State Definition 2.1: random field.");

  const theorem = extraction.items.find((item) => item.type === "theorem" && item.theoremNumber === "2.2");
  assert.ok(theorem, "Theorem 2.2 item should be extracted.");
  assert.equal(theorem.statement, "Consider a finite set t1,...,tn in T.");
  assert.equal(theorem.proof, "This comes immediately from the Kolmogorov extension theorem.");
  assert.doesNotMatch(theorem.statement, /\bProof\b/);

  const invalidMergedDefinition: RevisionItem = {
    id: "bad-definition",
    type: "definition",
    title: "Definition 2.1. Random field",
    statement: "A random field is defined here. Remark. This is surrounding text. Theorem 2.2. More surrounding text.",
    sourceFile: "regression.txt",
    sourceLocation: "Definition 2.1",
    tags: ["definition"],
    importance: "unknown",
    questionPrompt: "State Definition 2.1: random field.",
    answer: "A random field is defined here.",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const validation = validateAndRepairRevisionItems([invalidMergedDefinition]);
  assert.equal(validation.validItems.length, 0);
  assert.equal(validation.invalidItems.length, 1);
  assert.match(validation.invalidItems[0].extractionWarning ?? "", /Over-merged/);

  const now = new Date().toISOString();
  const bibliographyItem: RevisionItem = {
    id: "bib",
    type: "theorem",
    title: "Theorem. [GG] Gaetan and Guyon",
    statement: "[GG] Gaetan, Carlo, and Guyon, Xavier. Theory of spatial statistics. Springer, 2010.",
    sourceFile: "references.txt",
    sourceLocation: "References",
    tags: ["theorem"],
    importance: "unknown",
    questionPrompt: "State Theorem.",
    answer: "[GG] Gaetan, Carlo, and Guyon, Xavier. Theory of spatial statistics. Springer, 2010.",
    createdAt: now,
    updatedAt: now,
  };
  const weakFormulaItem: RevisionItem = {
    id: "weak-formula",
    type: "formula",
    title: "Formula",
    statement: "F_{t1,...,tn}(x1,...,xn) = P(Xt1 <= x1, ..., Xtn <= xn)",
    sourceFile: "regression.txt",
    sourceLocation: "Theorem 2.2",
    tags: ["formula"],
    importance: "unknown",
    questionPrompt: "Write down the formula.",
    answer: "F_{t1,...,tn}(x1,...,xn) = P(Xt1 <= x1, ..., Xtn <= xn)",
    createdAt: now,
    updatedAt: now,
  };
  const relevance = filterRevisionItemsByRelevance([bibliographyItem, weakFormulaItem], []);
  assert.equal(relevance.keptItems.length, 0);
  assert.deepEqual(
    relevance.rejectedItems.map((item) => item.rejectionCategory),
    ["bibliography_or_reference", "formula_not_standalone"],
  );

  console.log("Extraction regression passed.");
}
