/**
 * Regression test for the local Study Pack extractor against a Monte Carlo /
 * importance sampling excerpt fixture (chapter-3 style).
 *
 * Run via: `npm run test:chapter3`.
 */
import assert from "node:assert/strict";
import { computeGenericAcceptanceTests } from "../src/lib/generic-study-pack-validation";
import {
  buildHeuristicStudentRevisionPack,
  extractExampleAndExerciseItemsForDebug,
  extractSectionHeadings,
} from "../src/lib/local-study-pack-extraction";
import { chapter3MonteCarloExcerpt } from "../src/lib/test-fixtures/chapter-3-monte-carlo-excerpt";

const fixtureFile = {
  id: "chapter-3",
  name: "chapter-3.pdf",
  role: "lecture_notes" as const,
  parsedText: chapter3MonteCarloExcerpt,
};

const sections = extractSectionHeadings(chapter3MonteCarloExcerpt);
const sectionNums = sections.map((s) => s.sectionNumber);
for (const num of ["3.1", "3.2", "3.3", "3.3.1", "3.3.3"]) {
  assert.ok(sectionNums.includes(num), `expected section ${num}, got ${sectionNums.join(",")}`);
}

const pack = buildHeuristicStudentRevisionPack({
  files: [fixtureFile],
  settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
  combinedLectureText: chapter3MonteCarloExcerpt,
  hasPastEvidence: false,
});

assert.ok(pack.documentProfile, "pack should include documentProfile");
assert.ok(pack.sectionBlocks?.length, "pack should include section blocks");

const courseTitles = pack.courseMap.map((t) => t.title);
for (const num of ["3.1", "3.2", "3.3", "3.3.1", "3.3.3"]) {
  assert.ok(
    courseTitles.some((t) => t.startsWith(`${num} `)),
    `course map missing ${num}; got: ${courseTitles.join(" | ")}`,
  );
}
assert.ok(!courseTitles.some((t) => /^chapter\s*3$/i.test(t.trim())), "course map should not be only the filename stem");

const defTerms = pack.definitions.map((d) => d.term.toLowerCase()).join(" | ");
assert.ok(defTerms.includes("effective sample size"), `definitions should mention ESS; got ${defTerms}`);
const essDef = pack.definitions.find((d) => d.term.toLowerCase().includes("effective sample"));
assert.ok(essDef && !/mixture\s+importance/i.test(essDef.definition.slice(0, 800)), "ESS definition should not absorb mixture section");

assert.ok(pack.formulas.length >= 10, `expected ≥10 formulas, got ${pack.formulas.length}`);
const formulaBlob = pack.formulas.map((f) => `${f.name} ${f.latex}`).join(" | ").toLowerCase();
assert.ok(/monte carlo estimator|mc estimator|\^n_\{?\\mathrm\{mc\}\}?/.test(formulaBlob), "expected MC estimator formula");
assert.ok(/importance sampling estimator|\_\{?\\mathrm\{is\}\}?/.test(formulaBlob), "expected IS estimator formula");
assert.ok(/snis|self-normal|normalised importance/.test(formulaBlob), "expected SNIS-related formula");
assert.ok(/ess|effective sample/.test(formulaBlob), "expected ESS formula");

const proofLabels = pack.proofs.map((p) => p.sourceLabel ?? "");
for (const lbl of ["Proposition 3.1", "Proposition 3.2", "Proposition 3.3", "Proposition 3.4", "Proposition 3.5", "Proposition 3.6"]) {
  assert.ok(proofLabels.includes(lbl), `proofs missing ${lbl}; got: ${proofLabels.join(", ")}`);
}

assert.ok(pack.definitions.length >= 10, `expected ≥10 definitions, got ${pack.definitions.length}`);
assert.ok(pack.formulas.length >= 15, `expected ≥15 formulas, got ${pack.formulas.length}`);

const lists = extractExampleAndExerciseItemsForDebug([fixtureFile]);
const ex38 = lists.exercises.find((e) => /^Exercise\s+3\.8\b/i.test(e.formalLabel));
if (ex38?.highPriority) {
  assert.ok(/\b(final\s+exam|exam\s+\d{4})\b/i.test(`${ex38.body}\n${ex38.formalLabel}`), "high-priority exercise should cite exam context");
}

const lowerFixture = chapter3MonteCarloExcerpt.toLowerCase();
const acceptance = computeGenericAcceptanceTests({
  pack,
  documentProfile: pack.documentProfile ?? null,
  sourceTextLower: lowerFixture,
  badMathTokenCount: 0,
  duplicateQuizPrompts: [],
  overlongBlocks: [],
  bibliographyInPack: false,
  contaminationLines: [],
  quiz: [],
});
assert.ok(acceptance.hasDocumentProfile, "generic acceptance should see document profile");
assert.ok(acceptance.noSourceContamination, "fixture pack should not flag source contamination");

const methodTitles = pack.methods.map((m) => m.problemType).join(" | ");
assert.ok(/Algorithm\s*7/i.test(methodTitles), `expected Algorithm 7 method; got ${methodTitles}`);
assert.ok(/Algorithm\s*8/i.test(methodTitles), `expected Algorithm 8 method; got ${methodTitles}`);

const cramFormulas = pack.cramSheet.formulaBullets.join("\n").toLowerCase();
assert.ok(!/^\s*1:\s*input/i.test(cramFormulas) && !cramFormulas.includes("for i = 1 to n"), "cram formulas should not contain raw algorithm steps");
assert.ok(!cramFormulas.includes("pseudocode"), "cram formulas should not look like pseudocode blocks");

const overviewText = `${pack.examOverview.likelyExamStructure} ${pack.examOverview.summary}`.toLowerCase();
assert.ok(!overviewText.includes("balance conditions"), `overview should not mention balance conditions; got ${overviewText}`);

console.log("chapter-3 extraction regression test passed.");
console.log(`  sections=${sectionNums.join(",")}`);
console.log(`  formulas=${pack.formulas.length}`);
console.log(`  proofs=${proofLabels.join(", ")}`);
