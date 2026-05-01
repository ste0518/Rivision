import assert from "node:assert/strict";
import { segmentRevisionCandidates } from "../src/lib/segmentation";
import { extractRevisionItems } from "../src/lib/extraction";
import { normalizeCuratedRevisionResult, normalizeRevisionItem } from "../src/lib/normalization";
import { filterRevisionItemsByRelevance } from "../src/lib/relevance";
import { convertCommonMathToLatex } from "../src/lib/revision-item-utils";
import { spatialStatisticsFixtureDocument, spatialStatisticsGuidanceDocument } from "../src/lib/test-fixtures/spatial-statistics-ch2-excerpt";
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
assert.match(latex, /\\\(T\\subset\\mathbb\{R\}\^d\\\)/);

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
  assert.match(definition.statementLatex ?? "", /\\\(T\\subset\\mathbb\{R\}\^d\\\)/);
  assert.equal(definition.cardFront, "Random field");
  assert.equal(definition.questionPrompt, "State Definition 2.1: random field.");

  const theorem = extraction.items.find((item) => item.type === "theorem" && item.theoremNumber === "2.2");
  assert.ok(theorem, "Theorem 2.2 item should be extracted.");
  assert.equal(theorem.statement, "Consider a finite set t1,...,tn in T.");
  assert.equal(theorem.proof, "This comes immediately from the Kolmogorov extension theorem.");
  assert.doesNotMatch(theorem.statement, /\bProof\b/);

  const vectorInput =
    "Definition 2.3. [VL] A random vector (X1,...,Xn)' has a multivariate normal distribution with mean vector m=(EX1,...,EXn)' in R^n, and n x n covariance matrix Sigma with entries Sigma_ij=Cov(Xi,Xj), if any linear combination a'X=sum_i=1^n aiXi, a in R^n, is normally distributed.";
  const vectorExtraction = await extractRevisionItems({
    notesDocuments: [{
      sourceFile: "vector.txt",
      fileType: "txt",
      fullText: vectorInput,
      diagnostics: { success: true, charCount: vectorInput.length, warnings: [], errors: [], extractionQuality: "high" },
    }],
    guidanceDocuments: [],
    sourceFile: "vector.txt",
  });
  const vectorDefinition = vectorExtraction.items.find((item) => item.theoremNumber === "2.3");
  assert.ok(vectorDefinition, "Definition 2.3 item should be extracted.");
  assert.equal(vectorDefinition.cardFront, "Random vector");
  assert.equal(vectorDefinition.displayTitle, "Definition 2.3. Random vector");
  assert.match(vectorDefinition.statement, /^A random vector/);
  assert.doesNotMatch(vectorDefinition.statement, /^(\.\.\.|[,.)\]]|Xn\))/);
  assert.match(vectorDefinition.statementLatex ?? "", /\\\(X=\(X_1,\\ldots,X_n\)'\\\)/);
  assert.match(vectorDefinition.statementLatex ?? "", /\\\(\\Sigma_\{ij\}=\\operatorname\{Cov\}\(X_i,X_j\)\\\)/);
  assert.match(vectorDefinition.statementLatex ?? "", /\\\(a'X=\\sum_\{i=1\}\^n a_iX_i\\\)/);

  const invalidMergedDefinition: RevisionItem = {
    id: "bad-definition",
    type: "definition",
    title: "Definition 2.1. Random field",
    conceptName: "Random field",
    displayTitle: "Definition 2.1. Random field",
    cardFront: "Random field",
    taskPrompt: "Recall the exact definition.",
    cardPurpose: "definition_recall",
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
    conceptName: "Theorem",
    displayTitle: "Theorem",
    cardFront: "Theorem",
    taskPrompt: "State the theorem and its conditions.",
    cardPurpose: "theorem_statement",
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
    conceptName: "Formula",
    displayTitle: "Formula",
    cardFront: "Formula",
    taskPrompt: "Write down the formula and explain each term.",
    cardPurpose: "formula_recall",
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

  const fixtureCandidates = segmentRevisionCandidates([spatialStatisticsFixtureDocument]);
  const firstFixtureLabels = fixtureCandidates.slice(0, 11).map((candidate) => `${candidate.label} ${candidate.number ?? ""}`.trim());
  assert.deepEqual(firstFixtureLabels, [
    "Definition 2.1",
    "Remark",
    "Theorem 2.2",
    "Proof",
    "Remark",
    "Definition 2.3",
    "Definition 2.4",
    "Remark",
    "Theorem 2.5",
    "Remark",
    "Proof",
  ]);
  const theorem22Candidate = fixtureCandidates.find((candidate) => candidate.label === "Theorem" && candidate.number === "2.2");
  assert.ok(theorem22Candidate, "Theorem 2.2 should be segmented.");
  assert.match(theorem22Candidate.rawText, /joint cumulative distribution/);
  assert.doesNotMatch(theorem22Candidate.rawText, /\bProof\b/);
  assert.ok(fixtureCandidates.some((candidate) => candidate.label === "Proof" && /not examinable/.test(candidate.rawText)), "Theorem 2.2 proof should remain a separate candidate before curation.");

  const fixtureExtraction = await extractRevisionItems({
    notesDocuments: [spatialStatisticsFixtureDocument],
    guidanceDocuments: [spatialStatisticsGuidanceDocument],
    sourceFile: spatialStatisticsFixtureDocument.sourceFile,
  });
  const fixtureItems = fixtureExtraction.items;

  const randomField = findByNumber(fixtureItems, "2.1");
  assert.equal(randomField.conceptName, "Random field");
  assert.equal(randomField.cardFront, "Random field");
  assert.equal(randomField.displayTitle, "Definition 2.1. Random field");
  assert.equal(randomField.cardPurpose, "definition_recall");
  assert.doesNotMatch(randomField.statement, /\bTheorem 2\.2\b/);

  const gaussianRandomField = findByNumber(fixtureItems, "2.4");
  assert.equal(gaussianRandomField.conceptName, "Gaussian random field");
  assert.equal(gaussianRandomField.cardFront, "Gaussian random field");
  assert.notEqual(gaussianRandomField.cardFront, "Definition");

  const theorem22 = findByNumber(fixtureItems, "2.2");
  assert.equal(theorem22.type, "theorem");
  assert.equal(theorem22.cardPurpose, "theorem_statement");
  assert.equal(theorem22.proofRequired, false);
  assert.match(theorem22.statement, /joint cumulative distribution/);
  assert.match(theorem22.proof ?? "", /not examinable/);
  assert.ok(!fixtureItems.some((item) => item.type === "proof" && item.parentItemId === theorem22.id), "Theorem 2.2 proof should not become an active proof card.");
  assert.ok(!fixtureItems.some((item) => item.type === "formula" && /Ft1|joint cumulative distribution|cumulative distribution function/i.test(item.statement)), "Theorem 2.2 joint CDF should not become a standalone formula card.");

  const covarianceValidity = findByNumber(fixtureItems, "2.5");
  assert.equal(covarianceValidity.conceptName, "Covariance function validity");
  assert.equal(covarianceValidity.cardFront, "Covariance function validity");
  assert.equal(covarianceValidity.taskPrompt, "State the positive semi-definiteness condition.");
  assert.match(covarianceValidity.statement, /positive semi-?definite/);

  const semiVariogram = findByNumber(fixtureItems, "2.13");
  assert.equal(semiVariogram.conceptName, "Semi-variogram");
  assert.equal(semiVariogram.cardFront, "Semi-variogram");

  const simpleKriging = findByNumber(fixtureItems, "3.2");
  assert.equal(simpleKriging.conceptName, "Simple Kriging");
  assert.equal(simpleKriging.cardFront, "Simple Kriging");
  assert.equal(simpleKriging.taskPrompt, "State the BLUP predictor and mean squared prediction error.");

  const bochner = findByNumber(fixtureItems, "2.11");
  assert.equal(bochner.proofRequired, false);
  assert.equal(bochner.cardPurpose, "theorem_statement");

  assert.ok(!fixtureItems.some((item) => /normal.*density|sigma sqrt|probability density function/i.test(item.cardFront + item.statement) && item.type === "formula"), "Normal density background formula should not be kept as standalone.");

  assert.match(convertCommonMathToLatex("X = (Xt)t∈T"), /\\\(X=\(X_t\)_\{t\\in T\}\\\)/);
  assert.match(convertCommonMathToLatex("T ⊆ R d"), /\\\(T\\subseteq\\mathbb\{R\}\^d\\\)/);
  assert.match(convertCommonMathToLatex("(X1, . . . , Xn)'"), /\\\(\(X_1,\\ldots,X_n\)'\\\)/);
  assert.match(convertCommonMathToLatex("Σi,j = Cov(Xi, Xj)"), /\\\(\\Sigma_\{ij\}=\\operatorname\{Cov\}\(X_i,X_j\)\\\)/);
  assert.match(convertCommonMathToLatex("a′X = Pn i=1 aiXi"), /\\\(a'X=\\sum_\{i=1\}\^n a_iX_i\\\)/);
  assert.match(convertCommonMathToLatex("ρ : T × T → R"), /\\\(\\rho:T\\times T\\to\\mathbb\{R\}\\\)/);
  assert.match(convertCommonMathToLatex("ρ(ti,tj)"), /\\\(\\rho\(t_i,t_j\)\\\)/);
  assert.match(convertCommonMathToLatex("γ : R d → R+"), /\\\(\\gamma:\\mathbb\{R\}\^d\\to\\mathbb\{R\}_\+\\\)/);
  assert.match(convertCommonMathToLatex("Xˆ t0 = m(t0) + K′Σ−1(Z−M)"), /\\\(\\hat X_\{t_0\}=m\(t_0\)\+K'\\Sigma\^\{-1\}\(Z-M\)\\\)/);

  const migrated = normalizeRevisionItem({
    title: "Old card",
    statement: "A random field is useful.",
    answer: "A random field is useful.",
  });
  assert.equal(migrated.cardPurpose, "background_context");
  assert.equal(Array.isArray(migrated.tags), true);
  const normalizedDeck = normalizeCuratedRevisionResult({ keptItems: [migrated], curationReport: {} });
  assert.equal(normalizedDeck.keptItems.length, 1);

  console.log("Extraction regression passed.");
}

function findByNumber(items: RevisionItem[], number: string) {
  const item = items.find((candidate) => candidate.theoremNumber === number);
  assert.ok(item, `${number} should be extracted.`);
  return item;
}
